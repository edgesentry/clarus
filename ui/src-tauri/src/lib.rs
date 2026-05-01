pub mod audit;
pub mod explain;
pub mod replay;
pub mod report;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            replay::run_replay,
            replay::run_replay_with_rules,
            explain::explain_event,
            report::generate_pdf_report,
            audit::verify_chain,
            audit::seal_events,
            explain::generate_executive_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error running clarus demo");
}
