pub mod audit;
pub mod explain;
pub mod replay;
pub mod report;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            replay::run_replay,
            explain::explain_event,
            report::generate_pdf_report,
            audit::verify_chain,
        ])
        .run(tauri::generate_context!())
        .expect("error running clarus demo");
}
