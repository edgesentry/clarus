/// clarus-validate — profile format validator.
///
/// Usage:
///   clarus-validate --profile <dir>
///   clarus-validate --profile <dir>/rules.json
///
/// Exit code 0 = valid, 1 = one or more errors found.
use std::collections::HashSet;
use std::path::Path;
use std::{env, fs, process};

// ── colour output ─────────────────────────────────────────────────────────────

const GREEN: &str = "\x1b[0;32m";
const YELLOW: &str = "\x1b[1;33m";
const RED: &str = "\x1b[0;31m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const NC: &str = "\x1b[0m";

fn pass(msg: &str) { println!("{GREEN}  ✓ {msg}{NC}"); }
fn warn(msg: &str) { println!("{YELLOW}  ⚠ {msg}{NC}"); }
fn fail(msg: &str) { println!("{RED}  ✗ {msg}{NC}"); }
fn info(msg: &str) { println!("{DIM}    {msg}{NC}"); }
fn header(msg: &str) { println!("\n{BOLD}── {msg} ──────────────────────────────────────{NC}"); }

// ── validation results ────────────────────────────────────────────────────────

#[derive(Default)]
struct Report {
    errors: usize,
    warnings: usize,
}

impl Report {
    fn error(&mut self, msg: &str) { fail(msg); self.errors += 1; }
    fn warn(&mut self, msg: &str)  { warn(msg); self.warnings += 1; }
    fn pass(&mut self, msg: &str)  { pass(msg); }
}

// ── main ──────────────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = env::args().collect();
    let profile_arg = args.windows(2)
        .find(|w| w[0] == "--profile")
        .map(|w| w[1].clone())
        .unwrap_or_else(|| {
            eprintln!("Usage: clarus-validate --profile <profile-dir>");
            eprintln!("       clarus-validate --profile <profile-dir>/rules.json");
            process::exit(1);
        });

    // Accept either a directory or a direct path to rules.json.
    let profile_dir = {
        let p = Path::new(&profile_arg);
        if p.is_file() {
            p.parent().unwrap_or(p).to_path_buf()
        } else {
            p.to_path_buf()
        }
    };

    println!("{BOLD}clarus profile validator{NC}");
    println!("  profile : {}", profile_dir.display());

    let mut report = Report::default();
    let rules = validate_rules_json(&profile_dir, &mut report);
    validate_kb(&profile_dir, &rules, &mut report);

    // ── summary ───────────────────────────────────────────────────────────────
    println!();
    if report.errors == 0 && report.warnings == 0 {
        println!("{GREEN}{BOLD}  Profile is valid.{NC}");
    } else if report.errors == 0 {
        println!("{YELLOW}{BOLD}  Profile is valid with {} warning(s).{NC}", report.warnings);
    } else {
        println!("{RED}{BOLD}  {} error(s), {} warning(s). Profile is invalid.{NC}",
            report.errors, report.warnings);
        process::exit(1);
    }
}

// ── rules.json validation ─────────────────────────────────────────────────────

/// Returns the list of rule_ids parsed from rules.json (empty on failure).
fn validate_rules_json(profile_dir: &Path, report: &mut Report) -> Vec<String> {
    header("rules.json");

    let rules_path = profile_dir.join("rules.json");

    // 1. File exists
    if !rules_path.exists() {
        report.error(&format!("rules.json not found at {}", rules_path.display()));
        info("Create a rules.json file in the profile directory.");
        info("See README.md for the required format.");
        return vec![];
    }
    report.pass("rules.json exists");

    // 2. Valid JSON
    let content = fs::read_to_string(&rules_path).unwrap_or_else(|e| {
        fail(&format!("Cannot read rules.json: {e}"));
        process::exit(1);
    });
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            report.error(&format!("rules.json is not valid JSON: {e}"));
            return vec![];
        }
    };
    report.pass("rules.json is valid JSON");

    // 3. Top-level is an array
    let rules = match json.as_array() {
        Some(r) => r,
        None => {
            report.error("rules.json must be a JSON array at the top level");
            info("Expected: [ { \"rule_id\": \"...\", ... }, ... ]");
            return vec![];
        }
    };

    if rules.is_empty() {
        report.error("rules.json contains no rules");
        return vec![];
    }
    report.pass(&format!("{} rule(s) found", rules.len()));

    // 4. Validate each rule
    let mut rule_ids: Vec<String> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for (i, rule) in rules.iter().enumerate() {
        let idx = i + 1;
        validate_rule(rule, idx, &mut rule_ids, &mut seen_ids, report);
    }

    rule_ids
}

fn validate_rule(
    rule: &serde_json::Value,
    idx: usize,
    rule_ids: &mut Vec<String>,
    seen_ids: &mut HashSet<String>,
    report: &mut Report,
) {
    let obj = match rule.as_object() {
        Some(o) => o,
        None => {
            report.error(&format!("Rule {idx}: must be a JSON object"));
            return;
        }
    };

    // rule_id
    let rule_id = match obj.get("rule_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            report.error(&format!("Rule {idx}: missing required field \"rule_id\" (string)"));
            return;
        }
    };

    if rule_id.is_empty() {
        report.error(&format!("Rule {idx}: \"rule_id\" must not be empty"));
        return;
    }
    if rule_id.contains(' ') {
        report.error(&format!("Rule {idx} ({rule_id}): \"rule_id\" must not contain spaces"));
        info("Use SCREAMING_SNAKE_CASE, e.g. \"MIN_CLEARANCE_5M\"");
    }
    if rule_id != rule_id.to_uppercase() {
        report.warn(&format!("Rule {idx} ({rule_id}): \"rule_id\" should be SCREAMING_SNAKE_CASE"));
    }
    if seen_ids.contains(&rule_id) {
        report.error(&format!("Rule {idx}: duplicate rule_id \"{rule_id}\""));
    } else {
        seen_ids.insert(rule_id.clone());
        rule_ids.push(rule_id.clone());
    }

    // condition
    match obj.get("condition").and_then(|v| v.as_str()) {
        None => {
            report.error(&format!("Rule {idx} ({rule_id}): missing required field \"condition\" (string)"));
            info("Supported: \"distance < N\", \"ttc < N\", \"zone_member\"");
        }
        Some(cond) => validate_condition(cond, obj, &rule_id, idx, report),
    }

    // severity
    match obj.get("severity").and_then(|v| v.as_str()) {
        None => {
            report.error(&format!("Rule {idx} ({rule_id}): missing required field \"severity\""));
            info("Allowed values: LOW, MEDIUM, HIGH, CRITICAL");
        }
        Some(sev) => match sev {
            "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" => {}
            _ => {
                report.error(&format!(
                    "Rule {idx} ({rule_id}): invalid severity \"{sev}\""
                ));
                info("Allowed values: LOW, MEDIUM, HIGH, CRITICAL");
            }
        },
    }

    // regulation
    match obj.get("regulation").and_then(|v| v.as_str()) {
        None => {
            report.error(&format!(
                "Rule {idx} ({rule_id}): missing required field \"regulation\" (string)"
            ));
            info("Example: \"My Safety Code §3.1\"");
        }
        Some(reg) if reg.trim().is_empty() => {
            report.error(&format!(
                "Rule {idx} ({rule_id}): \"regulation\" must not be empty"
            ));
        }
        Some(_) => {}
    }
}

fn validate_condition(
    cond: &str,
    obj: &serde_json::Map<String, serde_json::Value>,
    rule_id: &str,
    idx: usize,
    report: &mut Report,
) {
    let cond = cond.trim();

    if let Some(rest) = cond.strip_prefix("distance < ") {
        match rest.trim().parse::<f64>() {
            Ok(n) if n > 0.0 => {}
            Ok(_) => report.error(&format!(
                "Rule {idx} ({rule_id}): distance threshold must be > 0"
            )),
            Err(_) => report.error(&format!(
                "Rule {idx} ({rule_id}): invalid number in condition \"{cond}\""
            )),
        }
    } else if let Some(rest) = cond.strip_prefix("ttc < ") {
        match rest.trim().parse::<f64>() {
            Ok(n) if n > 0.0 => {}
            Ok(_) => report.error(&format!(
                "Rule {idx} ({rule_id}): ttc threshold must be > 0"
            )),
            Err(_) => report.error(&format!(
                "Rule {idx} ({rule_id}): invalid number in condition \"{cond}\""
            )),
        }
    } else if cond == "zone_member" {
        match obj.get("zone") {
            None => {
                report.error(&format!(
                    "Rule {idx} ({rule_id}): condition \"zone_member\" requires a \"zone\" field"
                ));
                info("\"zone\" must be an array of [x, y] pairs with ≥ 3 vertices");
                info("Example: \"zone\": [[0,0],[10,0],[10,10],[0,10]]");
            }
            Some(zone) => validate_zone(zone, rule_id, idx, report),
        }
    } else {
        report.error(&format!(
            "Rule {idx} ({rule_id}): unknown condition \"{cond}\""
        ));
        info("Supported conditions:");
        info("  \"distance < N\"   — fires when two entities are within N metres");
        info("  \"ttc < N\"        — fires when time-to-collision drops below N seconds");
        info("  \"zone_member\"    — fires when an entity enters the defined zone polygon");
    }
}

fn validate_zone(
    zone: &serde_json::Value,
    rule_id: &str,
    idx: usize,
    report: &mut Report,
) {
    let arr = match zone.as_array() {
        Some(a) => a,
        None => {
            report.error(&format!(
                "Rule {idx} ({rule_id}): \"zone\" must be an array of [x, y] pairs"
            ));
            return;
        }
    };

    if arr.len() < 3 {
        report.error(&format!(
            "Rule {idx} ({rule_id}): \"zone\" polygon must have at least 3 vertices, got {}",
            arr.len()
        ));
        return;
    }

    for (vi, vertex) in arr.iter().enumerate() {
        let pair = match vertex.as_array() {
            Some(p) if p.len() == 2 => p,
            _ => {
                report.error(&format!(
                    "Rule {idx} ({rule_id}): zone vertex {vi} must be [x, y]"
                ));
                return;
            }
        };
        for coord in pair {
            if !coord.is_number() {
                report.error(&format!(
                    "Rule {idx} ({rule_id}): zone vertex {vi} coordinates must be numbers"
                ));
                return;
            }
        }
    }
}

// ── kb/ validation ────────────────────────────────────────────────────────────

fn validate_kb(profile_dir: &Path, rule_ids: &[String], report: &mut Report) {
    header("kb/ (knowledge base)");

    let kb_dir = profile_dir.join("kb");

    if !kb_dir.exists() {
        report.warn("kb/ directory not found — LLM explanations will fall back to \"No KB entry\"");
        info("Create kb/<RULE_ID>.txt for each rule to enable grounded LLM explanations.");
        return;
    }
    report.pass("kb/ directory exists");

    // Collect existing KB files
    let kb_files: HashSet<String> = fs::read_dir(&kb_dir)
        .unwrap_or_else(|e| { fail(&format!("Cannot read kb/: {e}")); process::exit(1); })
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("txt"))
        .filter_map(|e| e.path().file_stem()?.to_str().map(str::to_string))
        .collect();

    // Each rule should have a KB file
    for rule_id in rule_ids {
        if kb_files.contains(rule_id) {
            let path = kb_dir.join(format!("{rule_id}.txt"));
            let content = fs::read_to_string(&path).unwrap_or_default();
            if content.trim().is_empty() {
                report.warn(&format!("kb/{rule_id}.txt exists but is empty"));
            } else {
                report.pass(&format!("kb/{rule_id}.txt — {} chars", content.trim().len()));
            }
        } else {
            report.warn(&format!(
                "kb/{rule_id}.txt not found — LLM explanation for {rule_id} will be ungrounded"
            ));
            info(&format!("Create kb/{rule_id}.txt with the relevant regulation text."));
        }
    }

    // Warn about orphaned KB files (no matching rule)
    let rule_set: HashSet<&str> = rule_ids.iter().map(String::as_str).collect();
    for kb_id in &kb_files {
        if !rule_set.contains(kb_id.as_str()) {
            report.warn(&format!(
                "kb/{kb_id}.txt has no matching rule in rules.json (orphaned)"
            ));
        }
    }
}

// ── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_profile(dir: &Path, rules: &str, kb: &[(&str, &str)]) {
        fs::write(dir.join("rules.json"), rules).unwrap();
        let kb_dir = dir.join("kb");
        fs::create_dir_all(&kb_dir).unwrap();
        for (name, content) in kb {
            fs::write(kb_dir.join(format!("{name}.txt")), content).unwrap();
        }
    }

    fn run(dir: &Path) -> Report {
        let mut report = Report::default();
        let rule_ids = validate_rules_json(dir, &mut report);
        validate_kb(dir, &rule_ids, &mut report);
        report
    }

    #[test]
    fn valid_profile_passes() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"MIN_CLEARANCE","condition":"distance < 5.0",
             "severity":"HIGH","regulation":"Safety Code §3.1"}
        ]"#, &[("MIN_CLEARANCE", "Keep 5 m clearance.")]);
        let r = run(tmp.path());
        assert_eq!(r.errors, 0);
        assert_eq!(r.warnings, 0);
    }

    #[test]
    fn missing_rules_json_is_error() {
        let tmp = TempDir::new().unwrap();
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn invalid_json_is_error() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("rules.json"), "not json").unwrap();
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn empty_array_is_error() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("rules.json"), "[]").unwrap();
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn duplicate_rule_ids_are_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"R1","condition":"distance < 5.0","severity":"HIGH","regulation":"X §1"},
            {"rule_id":"R1","condition":"ttc < 3.0","severity":"LOW","regulation":"X §2"}
        ]"#, &[]);
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn invalid_severity_is_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"R1","condition":"distance < 5.0","severity":"URGENT","regulation":"X §1"}
        ]"#, &[]);
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn unknown_condition_is_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"R1","condition":"speed > 10","severity":"HIGH","regulation":"X §1"}
        ]"#, &[]);
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn zone_member_without_zone_is_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"ZONE","condition":"zone_member","severity":"CRITICAL","regulation":"X §2"}
        ]"#, &[]);
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn zone_member_with_valid_polygon_passes() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"ZONE","condition":"zone_member","severity":"CRITICAL",
             "regulation":"X §2","zone":[[0,0],[10,0],[10,10],[0,10]]}
        ]"#, &[("ZONE", "Exclusion zone.")]);
        let r = run(tmp.path());
        assert_eq!(r.errors, 0);
    }

    #[test]
    fn zone_with_fewer_than_3_vertices_is_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"ZONE","condition":"zone_member","severity":"CRITICAL",
             "regulation":"X §2","zone":[[0,0],[10,0]]}
        ]"#, &[]);
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn missing_kb_file_is_warning_not_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"R1","condition":"distance < 5.0","severity":"HIGH","regulation":"X §1"}
        ]"#, &[]); // no KB files
        let r = run(tmp.path());
        assert_eq!(r.errors, 0);
        assert!(r.warnings > 0);
    }

    #[test]
    fn orphaned_kb_file_is_warning() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"R1","condition":"distance < 5.0","severity":"HIGH","regulation":"X §1"}
        ]"#, &[
            ("R1", "Relevant regulation text."),
            ("R2_ORPHAN", "This has no matching rule."),
        ]);
        let r = run(tmp.path());
        assert_eq!(r.errors, 0);
        assert!(r.warnings > 0);
    }

    #[test]
    fn missing_regulation_field_is_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"R1","condition":"distance < 5.0","severity":"HIGH"}
        ]"#, &[]);
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }

    #[test]
    fn rule_id_with_spaces_is_error() {
        let tmp = TempDir::new().unwrap();
        write_profile(tmp.path(), r#"[
            {"rule_id":"bad id","condition":"distance < 5.0","severity":"HIGH","regulation":"X §1"}
        ]"#, &[]);
        let r = run(tmp.path());
        assert!(r.errors > 0);
    }
}
