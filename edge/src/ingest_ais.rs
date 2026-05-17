//! Live AIS NMEA UDP ingest for clarus-edge (clarus#138).
//!
//! Binds `edgesentry-ingest::AisAdapter` on a background thread and delivers
//! entity batches to the main loop as `sim::Frame` values.

use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use edgesentry_ingest::ais_nmea::{AisAdapter, load_port_ref};
use edgesentry_types::EntityClass;

use crate::config::Config;
use crate::sim::Frame;

/// Blocking receiver fed by a dedicated UDP reader thread.
pub struct AisIngest {
    rx: mpsc::Receiver<Vec<edgesentry_types::Entity>>,
}

impl AisIngest {
    pub fn open(bind_addr: &str, profile_dir: &Path) -> Result<Self> {
        let params_path = profile_dir.join("params.toml");
        let params_str = std::fs::read_to_string(&params_path)
            .with_context(|| format!("read {}", params_path.display()))?;
        let port_ref = load_port_ref(&params_str)
            .map_err(|e| anyhow::anyhow!("params.toml: {e}"))?;

        let (tx, rx) = mpsc::channel();
        let addr = bind_addr.to_string();

        std::thread::Builder::new()
            .name("ais-udp-ingest".into())
            .spawn(move || {
                let mut adapter = match AisAdapter::bind(&addr, port_ref) {
                    Ok(a) => a,
                    Err(e) => {
                        tracing::error!(%addr, "AIS UDP bind failed: {e}");
                        return;
                    }
                };
                tracing::info!(%addr, "AIS UDP listener ready");
                loop {
                    match adapter.recv_entities() {
                        Ok(entities) if !entities.is_empty() => {
                            if tx.send(entities).is_err() {
                                break;
                            }
                        }
                        Ok(_) => {}
                        Err(e) => tracing::warn!("AIS recv error: {e}"),
                    }
                }
            })
            .context("spawn ais-udp-ingest thread")?;

        Ok(Self { rx })
    }

    /// Drain UDP batches until `deadline` (one `Frame` per recv batch).
    pub fn collect_until(&self, deadline: Instant) -> Vec<Frame> {
        let mut frames = Vec::new();
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let wait = remaining.min(Duration::from_millis(100));
            match self.rx.recv_timeout(wait) {
                Ok(entities) => {
                    let timestamp_ms = entities
                        .iter()
                        .find(|e| e.class != EntityClass::AisGap)
                        .map(|e| e.timestamp_ms)
                        .unwrap_or_else(now_millis);
                    frames.push(Frame {
                        timestamp_ms,
                        entities,
                    });
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        frames
    }
}

/// Resolve AIS bind address from `SOURCE` / `AIS_UDP_ADDR`. `None` → use sim.
pub fn ais_bind_addr(config: &Config) -> Option<String> {
    if let Some(ref addr) = config.ais_udp_addr {
        let addr = addr.trim();
        if !addr.is_empty() {
            return Some(addr.to_string());
        }
    }
    let src = config.source.trim();
    if let Some(rest) = src.strip_prefix("ais://") {
        if !rest.is_empty() {
            return Some(rest.to_string());
        }
    }
    if src.eq_ignore_ascii_case("ais") {
        return Some("0.0.0.0:9100".to_string());
    }
    None
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;
    use std::net::UdpSocket;
    use std::path::PathBuf;

    fn maritime_profile_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../profiles/sg-maritime-security")
    }

    fn fixture_nmea_line() -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../edgesentry-rs/demo/sg-strait-15min.nmea");
        let content = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        content
            .lines()
            .find(|l| l.trim().starts_with("!AIVDM"))
            .map(|l| l.trim().to_string())
            .expect("fixture must contain AIVDM sentence")
    }

    #[test]
    fn ais_bind_addr_from_env_fields() {
        let mut cfg = Config::parse_from(["clarus-edge"]);
        assert!(ais_bind_addr(&cfg).is_none());

        cfg.source = "ais://127.0.0.1:9101".into();
        assert_eq!(ais_bind_addr(&cfg).as_deref(), Some("127.0.0.1:9101"));

        cfg.source = "sim".into();
        cfg.ais_udp_addr = Some("127.0.0.1:9200".into());
        assert_eq!(ais_bind_addr(&cfg).as_deref(), Some("127.0.0.1:9200"));
    }

    #[test]
    fn ais_ingest_receives_encoded_sentence() {
        let profile_dir = maritime_profile_dir();
        let ingest = AisIngest::open("127.0.0.1:19123", &profile_dir).expect("open ingest");
        let sender = UdpSocket::bind("127.0.0.1:0").unwrap();
        let sentence = fixture_nmea_line();
        sender
            .send_to(sentence.as_bytes(), "127.0.0.1:19123")
            .unwrap();
        std::thread::sleep(Duration::from_millis(50));
        let frames = ingest.collect_until(Instant::now() + Duration::from_secs(1));
        assert!(!frames.is_empty(), "expected at least one AIS frame");
        assert!(frames[0].entities.iter().any(|e| e.id == "563012345"));
    }
}
