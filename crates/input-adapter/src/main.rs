use std::env;
use std::fs;
use std::process;

use clarus_engine::rules::{evaluate, load_rules};

mod file_replay;
mod unity_udp;

use file_replay::FileReplayAdapter;
use unity_udp::UnityUdpAdapter;

const USAGE: &str = "Usage: clarus --input <source> --profile <dir>

  --input udp://HOST:PORT     receive live entity stream from Unity via UDP
  --input file://PATH.csv     replay entities from a CSV fixture file

  --profile DIR               path to a profile directory containing rules.json

Examples:
  clarus --input udp://127.0.0.1:9000 --profile profiles/sg-port-safety
  clarus --input file://fixtures/forklift_approach.csv --profile profiles/sg-port-safety
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

    if let Some(addr) = input.strip_prefix("udp://") {
        run_udp(addr, &rules);
    } else if let Some(path) = input.strip_prefix("file://") {
        run_file(path, &rules);
    } else {
        eprintln!("Unknown input scheme: {input}");
        eprintln!("{USAGE}");
        process::exit(1);
    }
}

fn run_udp(addr: &str, rules: &[clarus_engine::rules::Rule]) {
    let adapter = UnityUdpAdapter::bind(addr).unwrap_or_else(|e| {
        eprintln!("Cannot bind UDP socket {addr}: {e}");
        process::exit(1);
    });
    println!("Listening on udp://{addr} …");
    loop {
        match adapter.recv_entities() {
            Ok(entities) => process_frame(entities, rules),
            Err(e) => eprintln!("recv error: {e}"),
        }
    }
}

fn run_file(path: &str, rules: &[clarus_engine::rules::Rule]) {
    let content = fs::read_to_string(path).unwrap_or_else(|e| {
        eprintln!("Cannot read {path}: {e}");
        process::exit(1);
    });
    let mut adapter = FileReplayAdapter::from_csv(&content).unwrap_or_else(|e| {
        eprintln!("Failed to parse CSV {path}: {e}");
        process::exit(1);
    });
    println!("Replaying {} frames from {path}", adapter.frame_count());
    while let Some(entities) = adapter.next_frame() {
        process_frame(entities, rules);
    }
    println!("Replay complete.");
}

fn process_frame(entities: Vec<clarus_engine::entity::Entity>, rules: &[clarus_engine::rules::Rule]) {
    let ts = entities.first().map(|e| e.timestamp_ms).unwrap_or(0);
    let events = evaluate(rules, &entities, ts);
    if events.is_empty() {
        println!("[t={ts}ms] {} entities — no risk events", entities.len());
    } else {
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
        }
    }
}

fn flag<'a>(args: &'a [String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|w| w[0] == name)
        .map(|w| w[1].clone())
}
