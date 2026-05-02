/// S3-compatible storage abstraction — Cloudflare R2 or local MinIO.
///
/// Both backends use the same S3-compatible API via `object_store`.
/// Switch by setting STORAGE_BACKEND=r2 or STORAGE_BACKEND=minio.
///
/// Buckets:
///   audit     — WORM (clarus-audit):   full signed audit chain, disaster recovery
///   analytics — standard (clarus-public): heartbeats + alerts for analytics app
use std::sync::Arc;

use anyhow::{Context, Result};
use bytes::Bytes;
use object_store::{aws::AmazonS3Builder, path::Path, ObjectStore};

use crate::config::Config;

pub struct Storage {
    audit:     Arc<dyn ObjectStore>,
    analytics: Arc<dyn ObjectStore>,
}

impl Storage {
    pub fn new(config: &Config) -> Result<Self> {
        Ok(Self {
            audit:     build_store(&config.audit_bucket, config)
                .context("failed to build audit store")?,
            analytics: build_store(&config.analytics_bucket, config)
                .context("failed to build analytics store")?,
        })
    }

    /// Upload to the WORM audit bucket (authoritative signed chain).
    pub async fn put_audit(&self, key: &str, data: Bytes) -> Result<()> {
        self.audit
            .put(&Path::from(key), data.into())
            .await
            .context("audit put failed")?;
        Ok(())
    }

    /// Upload to the analytics bucket (heartbeats + alert summaries).
    pub async fn put_analytics(&self, key: &str, data: Bytes) -> Result<()> {
        self.analytics
            .put(&Path::from(key), data.into())
            .await
            .context("analytics put failed")?;
        Ok(())
    }
}

fn build_store(bucket: &str, config: &Config) -> Result<Arc<dyn ObjectStore>> {
    let store: Arc<dyn ObjectStore> = match config.storage_backend.as_str() {
        "r2" => {
            let endpoint = format!(
                "https://{}.r2.cloudflarestorage.com",
                config.r2_account_id
            );
            Arc::new(
                AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .with_region("auto")
                    .with_endpoint(&endpoint)
                    .with_access_key_id(&config.r2_access_key_id)
                    .with_secret_access_key(&config.r2_secret_access_key)
                    .build()
                    .context("R2 store build failed")?,
            )
        }
        _ => {
            // MinIO (default) — allow HTTP for local deployments
            Arc::new(
                AmazonS3Builder::new()
                    .with_bucket_name(bucket)
                    .with_region("us-east-1")
                    .with_endpoint(&config.minio_endpoint)
                    .with_access_key_id(&config.minio_access_key)
                    .with_secret_access_key(&config.minio_secret_key)
                    .with_allow_http(true)
                    .build()
                    .context("MinIO store build failed")?,
            )
        }
    };
    Ok(store)
}
