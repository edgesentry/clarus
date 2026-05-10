use clap::Parser;

#[derive(Parser, Debug, Clone)]
#[command(about = "EdgeSentry clarus edge daemon — CV stream → physics → sign → DuckDB + S3")]
pub struct Config {
    /// Site identifier written into every AuditRecord and S3 path.
    #[arg(long, env = "SITE_ID", default_value = "site_dev_001")]
    pub site_id: String,

    /// Profile name under PROFILES_DIR (e.g. sg-maritime-security).
    #[arg(long, env = "PROFILE", default_value = "sg-maritime-security")]
    pub profile: String,

    /// Directory containing profile subdirectories.
    #[arg(long, env = "PROFILES_DIR", default_value = "../profiles")]
    pub profiles_dir: String,

    // ── Storage backend ───────────────────────────────────────────────────

    /// "wrangler" (default), "s3" for any S3-compatible endpoint, "minio" for local MinIO.
    #[arg(long, env = "STORAGE_BACKEND", default_value = "wrangler")]
    pub storage_backend: String,

    // MinIO
    #[arg(long, env = "MINIO_ENDPOINT", default_value = "http://localhost:9000")]
    pub minio_endpoint: String,
    #[arg(long, env = "MINIO_ACCESS_KEY", default_value = "minioadmin")]
    pub minio_access_key: String,
    #[arg(long, env = "MINIO_SECRET_KEY", default_value = "minioadmin")]
    pub minio_secret_key: String,

    // S3-compatible (Cloudflare R2, AWS S3, etc.)
    /// S3 endpoint URL (e.g. https://<account>.r2.cloudflarestorage.com or https://s3.amazonaws.com).
    #[arg(long, env = "S3_ENDPOINT", default_value = "")]
    pub s3_endpoint: String,
    #[arg(long, env = "S3_REGION", default_value = "auto")]
    pub s3_region: String,
    #[arg(long, env = "S3_ACCESS_KEY_ID", default_value = "")]
    pub s3_access_key_id: String,
    #[arg(long, env = "S3_SECRET_ACCESS_KEY", default_value = "")]
    pub s3_secret_access_key: String,

    // ── Buckets ───────────────────────────────────────────────────────────

    /// Device output bucket — heartbeats + alerts (read by /live Operations Monitor).
    #[arg(long, env = "RAW_BUCKET", default_value = "clarus-dev-public-raw")]
    pub raw_bucket: String,

    /// Audit chain bucket — full signed AuditRecords (PoC: public, production: private + Object Lock).
    #[arg(long, env = "AUDIT_BUCKET", default_value = "clarus-dev-public-audit")]
    pub audit_bucket: String,

    // ── Local state ───────────────────────────────────────────────────────

    /// Path for the local DuckDB database (operational cache + audit log).
    #[arg(long, env = "DB_PATH", default_value = "./clarus_edge.db")]
    pub db_path: String,

    /// Ed25519 private key hex (32 bytes). Generated fresh if empty.
    #[arg(long, env = "PRIVATE_KEY_HEX", default_value = "")]
    pub private_key_hex: String,

    // ── Timing ────────────────────────────────────────────────────────────

    /// Seconds between sim cycles (each cycle = 10 entity frames).
    #[arg(long, env = "CYCLE_INTERVAL", default_value = "2")]
    pub cycle_interval_secs: u64,

    /// Seconds between heartbeat uploads to the analytics bucket.
    #[arg(long, env = "HEARTBEAT_INTERVAL", default_value = "30")]
    pub heartbeat_interval_secs: u64,
}
