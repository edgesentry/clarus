use std::env;
use std::fs;
use std::process;

use clarus_engine::rules::{evaluate, load_rules};
use clarus_explanation::{Explainer, KnowledgeBase, LlmClient};

mod file_replay;
mod sealer;
mod unity_udp;

use file_replay::FileReplayAdapter;
use sealer::ClarusSealer;
use unity_udp::UnityUdpAdapter;

const USAGE: &str = "Usage: clarus --input <source> --profile <dir> [options]

  --input udp://HOST:PORT     receive live entity stream from Unity via UDP
  --input file://PATH.csv     replay entities from a CSV fixture file

  --profile DIR               path to a profile directory containing rules.json

  --explain                   generate plain-language explanation for each RiskEvent via local LLM
  --llm-url URL               LLM server base URL (default: http://localhost:8080)
  --model MODEL               model name (default: llama3.2)

  --audit-key HEX             Ed25519 private key (32 bytes, 64 hex chars); enables AuditRecord output
  --device-id ID              device identifier written into each AuditRecord (default: clarus-dev)

Examples:
  clarus --input file://fixtures/forklift_approach.csv --profile profiles/demo
  clarus --input udp://127.0.0.1:9000 --profile profiles/demo --explain
  clarus --input file://fixtures/forklift_approach.csv --profile profiles/demo --explain --audit-key <HEX>
";

fn main() {
    let args: Vec<String> = env::args().collect();
    let input = flag(&args, "--input").unwrap_or_else(|| {
        eprintln!("{USAGE}");
        process::exit(1);
    });
    let profile_dir = flag(&args, "--profile").unwrap_or_else(|| {
        eprintln!("{USAGE}");
        process::exit(1);
    });
    let explain = args.contains(&"--explain".to_string());
    let ollama_url = flag(&args, "--llm-url")
        .or_else(|| flag(&args, "--ollama-url"))  // backward-compat alias
        .unwrap_or_else(|| "http://localhost:8080".to_string());
    let model = flag(&args, "--model"); // None → auto-discover from /v1/models
    let audit_key = flag(&args, "--audit-key");
    let device_id = flag(&args, "--device-id").unwrap_or_else(|| "clarus-dev".to_string());

    let rules_path = format!("{profile_dir}/rules.json");
    let rules_json = fs::read_to_string(&rules_path).unwrap_or_else(|e| {
        eprintln!("Cannot read {rules_path}: {e}");
        process::exit(1);
    });
    let rules = load_rules(&rules_json).unwrap_or_else(|e| {
        eprintln!("Failed to parse rules: {e}");
        process::exit(1);
    });
    println!("Loaded {} rules from {rules_path}", rules.len());

    let explainer = if explain {
        let kb = KnowledgeBase::load(&profile_dir).unwrap_or_else(|e| {
            eprintln!("Cannot load KB from {profile_dir}/kb/: {e}");
            process::exit(1);
        });
        let llm = match model {
            Some(m) => LlmClient::new(ollama_url, m),
            None    => LlmClient::new_autodiscover(ollama_url),
        };
        println!("Explanation enabled (llama-server)");
        Some(Explainer::new(kb, llm))
    } else {
        None
    };

    let mut sealer = audit_key.map(|key| {
        println!("Audit sealing enabled (device_id={device_id})");
        ClarusSealer::new(device_id, key)
    });

    if let Some(addr) = input.strip_prefix("udp://") {
        run_udp(addr, &rules, explainer.as_ref(), sealer.as_mut());
    } else if let Some(path) = input.strip_prefix("file://") {
        run_file(path, &rules, explainer.as_ref(), sealer.as_mut());
    } else {
        eprintln!("Unknown input scheme: {input}");
        eprintln!("{USAGE}");
        process::exit(1);
    }
}

fn run_udp(
    addr: &str,
    rules: &[clarus_engine::rules::Rule],
    explainer: Option<&Explainer>,
    sealer: Option<&mut ClarusSealer>,
) {
    let adapter = UnityUdpAdapter::bind(addr).unwrap_or_else(|e| {
        eprintln!("Cannot bind UDP socket {addr}: {e}");
        process::exit(1);
    });
    println!("Listening on udp://{addr} …");
    // UDP is long-running so we can't thread sealer as &mut through a loop easily;
    // wrap in a local reborrow pattern.
    let mut sealer = sealer;
    loop {
        match adapter.recv_entities() {
            Ok(entities) => process_frame(entities, rules, explainer, sealer.as_deref_mut()),
            Err(e) => eprintln!("recv error: {e}"),
        }
    }
}

fn run_file(
    path: &str,
    rules: &[clarus_engine::rules::Rule],
    explainer: Option<&Explainer>,
    sealer: Option<&mut ClarusSealer>,
) {
    let content = fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("Cannot read {path}: {e}");
        process::exit(1);
    });
    let mut adapter = FileReplayAdapter::from_csv(&content).unwrap_or_else(|e| {
        eprintln!("Failed to parse CSV {path}: {e}");
        process::exit(1);
    });
    println!("Replaying {} frames from {path}", adapter.frame_count());
    let mut sealer = sealer;
    while let Some(entities) = adapter.next_frame() {
        process_frame(entities, rules, explainer, sealer.as_deref_mut());
    }
    println!("Replay complete.");
}

fn process_frame(
    entities: Vec<clarus_engine::entity::Entity>,
    rules: &[clarus_engine::rules::Rule],
    explainer: Option<&Explainer>,
    mut sealer: Option<&mut ClarusSealer>,
) {
    let ts = entities.first().map(|e| e.timestamp_ms).unwrap_or(0);
    let events = evaluate(rules, &entities, ts);
    if events.is_empty() {
        println!("[t={ts}ms] {} entities — no risk events", entities.len());
        return;
    }
    for ev in &events {
        println!(
            "[t={ts}ms] RISK {:?} rule={} entities={:?} value={:.2} threshold={:.2} reg={}",
            ev.severity,
            ev.rule_id,
            ev.entity_ids,
            ev.measured_value,
            ev.threshold,
            ev.regulation
        );

        let explanation = if let Some(exp) = explainer {
            match exp.explain(ev) {
                Ok(explanation) => {
                    let grounded_marker = if explanation.grounded { "✓" } else { "⚠ ungrounded" };
                    println!("  [EXPLANATION {grounded_marker}] {}", explanation.text);
                    Some(explanation)
                }
                Err(e) => {
                    eprintln!("  [EXPLANATION ERROR] {e}");
                    None
                }
            }
        } else {
            None
        };

        if let Some(ref mut s) = sealer {
            match s.seal(ev, explanation.as_ref()) {
                Ok(record) => {
                    let json = serde_json::to_string(&record)
                        .unwrap_or_else(|_| "<serialization error>".to_string());
                    println!("  [AUDIT] {json}");
                }
                Err(e) => eprintln!("  [AUDIT ERROR] {e}"),
            }
        }
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|w| w[0] == name)
        .map(|w| w[1].clone())
}
