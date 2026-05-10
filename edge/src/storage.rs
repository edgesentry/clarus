/// S3-compatible storage abstraction — three backends:
///
///   STORAGE_BACKEND=wrangler  Use `wrangler r2 object put` (default — no extra credentials needed)
///   STORAGE_BACKEND=s3        Direct S3-compatible API (needs S3_* env vars)
///   STORAGE_BACKEND=minio     Local MinIO via S3 API (needs Docker + MINIO_* env vars)
///
/// S3_ENDPOINT examples:
///   Cloudflare R2 — https://<account-id>.r2.cloudflarestorage.com
///   AWS S3        — https://s3.<region>.amazonaws.com  (or leave empty for default)
///   MinIO         — set STORAGE_BACKEND=minio instead
///
/// Buckets:
///   audit — clarus-dev-public-audit:  full signed AuditRecords (PoC: public; production: private + Object Lock)
///   raw   — clarus-dev-public-raw:    heartbeats + alert summaries for /live Operations Monitor
use std::process::Command;
use std::sync::Arc;

use anyhow::{Context, Result};
use bytes::Bytes;
use object_store::{aws::AmazonS3Builder, path::Path, ObjectStore};

use crate::config::Config;

pub struct Storage {
    backend:      String,
    audit_bucket: String,
    raw_bucket:   String,
    // Only used for s3 / minio backends
    s3_audit:     Option<Arc<dyn ObjectStore>>,
    s3_analytics: Option<Arc<dyn ObjectStore>>,
}

impl Storage {
    pub fn new(config: &Config) -> Result<Self> {
        match config.storage_backend.as_str() {
            "s3" | "minio" => {
                Ok(Self {
                    backend:      config.storage_backend.clone(),
                    audit_bucket: config.audit_bucket.clone(),
                    raw_bucket:   config.raw_bucket.clone(),
                    s3_audit:     Some(build_s3_store(&config.audit_bucket, config)?),
                    s3_analytics: Some(build_s3_store(&config.raw_bucket, config)?),
                })
            }
            _ => {
                // wrangler backend — no S3 client needed
                Ok(Self {
                    backend:      "wrangler".into(),
                    audit_bucket: config.audit_bucket.clone(),
                    raw_bucket:   config.raw_bucket.clone(),
                    s3_audit:     None,
                    s3_analytics: None,
                })
            }
        }
    }

    /// Upload to the WORM audit bucket (authoritative signed chain).
    pub async fn put_audit(&self, key: &str, data: Bytes) -> Result<()> {
        self.put(&self.audit_bucket.clone(), key, data).await
    }

    /// Upload to the raw bucket (heartbeats + alert summaries).
    pub async fn put_raw(&self, key: &str, data: Bytes) -> Result<()> {
        self.put(&self.raw_bucket.clone(), key, data).await
    }

    async fn put(&self, bucket: &str, key: &str, data: Bytes) -> Result<()> {
        match self.backend.as_str() {
            "s3" | "minio" => {
                let store = if bucket == self.audit_bucket {
                    self.s3_audit.as_ref().unwrap()
                } else {
                    self.s3_analytics.as_ref().unwrap()
                };
                store.put(&Path::from(key), data.into())
                    .await
                    .with_context(|| format!("S3 put failed for {bucket}/{key}"))?;
            }
            _ => {
                // wrangler backend: write to temp file and invoke wrangler
                wrangler_put(bucket, key, &data)?;
            }
        }
        Ok(())
    }
}

/// Upload bytes via `wrangler r2 object put` — uses existing wrangler login, no extra credentials.
fn wrangler_put(bucket: &str, key: &str, data: &[u8]) -> Result<()> {
    let tmp = std::env::temp_dir().join(format!(
        "clarus_upload_{}.bin",
        key.replace('/', "_")
    ));
    std::fs::write(&tmp, data)?;

    let output = Command::new("wrangler")
        .args([
            "r2", "object", "put",
            &format!("{bucket}/{key}"),
            "--file", tmp.to_str().unwrap(),
            "--content-type", "application/octet-stream",
            "--remote",
        ])
        .stdout(std::process::Stdio::null())
        .output()
        .context("wrangler not found — install with: npm i -g wrangler")?;

    std::fs::remove_file(&tmp).ok();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("wrangler put failed for {bucket}/{key}: {stderr}");
    }
    Ok(())
}

fn build_s3_store(bucket: &str, config: &Config) -> Result<Arc<dyn ObjectStore>> {
    let store: Arc<dyn ObjectStore> = match config.storage_backend.as_str() {
        "s3" => Arc::new(
            AmazonS3Builder::new()
                .with_bucket_name(bucket)
                .with_region(&config.s3_region)
                .with_endpoint(&config.s3_endpoint)
                .with_access_key_id(&config.s3_access_key_id)
                .with_secret_access_key(&config.s3_secret_access_key)
                .build()
                .context("S3 store build failed")?,
        ),
        _ => Arc::new(
            AmazonS3Builder::new()
                .with_bucket_name(bucket)
                .with_region("us-east-1")
                .with_endpoint(&config.minio_endpoint)
                .with_access_key_id(&config.minio_access_key)
                .with_secret_access_key(&config.minio_secret_key)
                .with_allow_http(true)
                .build()
                .context("MinIO store build failed")?,
        ),
    };
    Ok(store)
}
