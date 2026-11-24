/// The first launch argument with this extension (double-clicking a file in Explorer passes it as an argument).
fn launch_arg(ext: &str) -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && a.to_lowercase().ends_with(ext))
}

/// The file the app was launched with: a .bd page, or a .screenboard file (which opens in board mode).
#[tauri::command]
fn opened_file() -> Option<String> {
    launch_arg(".bd").or_else(|| launch_arg(".screenboard"))
}

/// Board mode asks for the .screenboard file the app was launched with: its name and contents.
/// Only that one file can be read this way, never a path the page chooses.
#[tauri::command]
fn opened_board() -> Option<(String, String)> {
    let path = launch_arg(".screenboard")?;
    let name = std::path::Path::new(&path).file_name()?.to_string_lossy().into_owned();
    let meta = std::fs::metadata(&path).ok()?;
    if meta.len() > 200 * 1024 * 1024 {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    Some((name, text))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![opened_file, opened_board])
        .run(tauri::generate_context!())
        .expect("error while running LaTeX Modeler");
}
