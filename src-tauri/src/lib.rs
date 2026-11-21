/// The .bd file the app was launched with (double-clicking a file in Explorer passes it as an argument).
#[tauri::command]
fn opened_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && a.to_lowercase().ends_with(".bd"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![opened_file])
        .run(tauri::generate_context!())
        .expect("error while running LaTeX Modeler");
}
