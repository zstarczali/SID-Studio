// VA SID Studio backend: SID emulation (VA SID Core), .sid register dump, the VMA build of the player, file saving.
mod hvsc;
mod modland;
mod midi_permission;
mod updater;

use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

fn config_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap().join("config.json")
}

fn read_config(app: &AppHandle) -> serde_json::Value {
    let path = config_path(app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}))
}

fn write_config(app: &AppHandle, cfg: &serde_json::Value) {
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(cfg).unwrap());
}

fn update_http_client(app: &AppHandle, timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent(format!("VASidStudio/{}", app.package_info().version))
        .build()
        .map_err(|e| e.to_string())
}

// The SID Editor previews and the .sid playback sessions live in the shared va-sid
// crate (C64 Visual Assembler uses the same one); the blocking ones run on spawn_blocking.
#[tauri::command]
async fn render_sid_preview(payload: va_sid::session::SidPreviewPayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || va_sid::session::render_sid_preview(payload))
        .await
        .map_err(|error| format!("SID preview worker failed: {error}"))?
}

#[tauri::command]
fn release_sid_preview(session_id: String) {
    va_sid::session::release_sid_preview(&session_id);
}

#[tauri::command]
async fn render_sid_file(payload: va_sid::session::SidFilePayload) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || va_sid::session::render_sid_file(payload))
        .await
        .map_err(|e| format!("SID file playback failed: {e}"))?
}

#[tauri::command]
fn sid_file_info(session_id: String) -> Result<serde_json::Value, String> {
    va_sid::session::sid_file_info(&session_id)
}

/// Runs a .sid tune silently and returns its SID register writes frame by
/// frame (the SID Editor's .sid import converts them into patterns).
#[tauri::command]
async fn sid_register_dump(app: AppHandle, payload: va_sid::session::SidDumpPayload) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    tauri::async_runtime::spawn_blocking(move || {
        va_sid::session::sid_register_dump(payload, |done, total| {
            let _ = app.emit("sid-dump-progress", serde_json::json!({ "done": done, "total": total }));
        })
    })
    .await
    .map_err(|e| format!("SID register dump failed: {e}"))?
}

#[tauri::command]
fn release_sid_file(session_id: String) {
    va_sid::session::release_sid_file(&session_id);
}

#[tauri::command]
fn open_external(url: String, app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_manual(app: AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .resolve("docs/VA SID Studio Manual.pdf", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err(format!("{} not found", path.display()));
    }
    app.opener()
        .open_path(path.to_string_lossy().as_ref(), None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_vma_version() -> &'static str {
    env!("VMA_VERSION")
}

/// The va-sid crate's version (from Cargo.lock, build.rs).
#[tauri::command]
fn get_va_sid_version() -> &'static str {
    env!("VA_SID_VERSION")
}

/// Assembles the exported 6502 player; the image alone, as the SID Editor's .sid export cuts it.
#[tauri::command]
fn vma_build_raw(source: String) -> serde_json::Value {
    match vma::build_raw(&source, &vma::NoFiles) {
        Ok(built) => serde_json::json!({ "ok": true, "prg": built.prg }),
        Err(e) => vma::error_json(&e),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBinPayload {
    bytes: Vec<u8>,
    file_name: Option<String>,
}

#[tauri::command]
async fn save_bin(app: AppHandle, payload: SaveBinPayload) -> serde_json::Value {
    // the suggested name's extension is the first filter (e.g. .sid)
    let ext = payload
        .file_name
        .as_deref()
        .and_then(|n| Path::new(n).extension())
        .map(|e| e.to_string_lossy().to_lowercase())
        .filter(|e| e != "bin");
    let mut dialog = app.dialog().file();
    if let Some(ext) = ext.as_deref() {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext]);
    }
    dialog = dialog.add_filter("Binary", &["bin"]).add_filter("All files", &["*"]);
    if let Some(name) = payload.file_name.as_deref().filter(|n| !n.is_empty()) {
        dialog = dialog.set_file_name(name);
    }
    match dialog.blocking_save_file() {
        Some(path) => {
            let path_str = path.to_string();
            match std::fs::write(&path_str, &payload.bytes) {
                Ok(_) => serde_json::json!({ "ok": true, "filePath": path_str }),
                Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
            }
        }
        None => serde_json::json!({ "canceled": true }),
    }
}

// Playlist files the app was opened with (double click, "Open with", command line),
// waiting for the page to take them.
static OPENED_FILES: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

// The .sidpl paths among the command-line arguments (the first one is the program).
fn opened_paths<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|p| {
            p.extension()
                .map(|e| e.to_string_lossy().eq_ignore_ascii_case("sidpl"))
                .unwrap_or(false)
        })
        .map(|p| if p.is_absolute() { p } else { cwd.join(p) })
        .collect()
}

fn queue_opened_files(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = OPENED_FILES.lock() {
        pending.extend(paths);
    }
    use tauri::Emitter;
    let _ = app.emit("files-opened", ());
}

#[tauri::command]
fn take_opened_files() -> Vec<serde_json::Value> {
    let paths: Vec<PathBuf> = OPENED_FILES
        .lock()
        .map(|mut pending| pending.drain(..).collect())
        .unwrap_or_default();
    paths
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            match fs::read_to_string(&path) {
                Ok(text) => serde_json::json!({ "name": name, "text": text }),
                Err(e) => serde_json::json!({ "name": name, "error": e.to_string() }),
            }
        })
        .collect()
}

/// What is remembered of the main window: everything but the visibility.
fn main_window_state_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE
}

static MAIN_WINDOW_SHOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Shows the main window (created hidden, `visible: false` in tauri.conf.json)
/// at its saved size and place. Only the first call counts.
fn show_main_window(app: &tauri::AppHandle) {
    let Some(main) = app.get_webview_window("main") else { return };
    if MAIN_WINDOW_SHOWN.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let _ = main.show();
    // Windows moves a window created hidden when it is first shown: put it back
    // where it was saved (size, position, maximized).
    {
        use tauri_plugin_window_state::WindowExt;
        let _ = main.restore_state(main_window_state_flags());
    }
    let _ = main.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // a second launch (double click on a .sidpl while the app runs) hands its files
    // to the running window instead of opening another one
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            queue_opened_files(app, opened_paths(argv, Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Remembers the main window's size, position and maximized state, but not
        // its visibility: the window starts hidden and is shown only once the page
        // has loaded, so no empty default-size window flashes up before it.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(main_window_state_flags())
                .build(),
        )
        .on_page_load(|webview, payload| {
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished {
                show_main_window(webview.app_handle());
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                midi_permission::allow_without_prompt(&window);
            }
            // in case the page never reports that it has loaded
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(5));
                let main = handle.clone();
                let _ = handle.run_on_main_thread(move || show_main_window(&main));
            });
            let cwd = std::env::current_dir().unwrap_or_default();
            if let Ok(mut pending) = OPENED_FILES.lock() {
                pending.extend(opened_paths(std::env::args(), &cwd));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            updater::check_for_update,
            updater::download_and_install_update,
            updater::get_update_server,
            updater::set_update_server,
            render_sid_preview,
            release_sid_preview,
            render_sid_file,
            release_sid_file,
            sid_file_info,
            sid_register_dump,
            open_external,
            open_manual,
            get_vma_version,
            get_va_sid_version,
            hvsc::hvsc_status,
            hvsc::hvsc_catalog,
            hvsc::hvsc_fetch,
            hvsc::hvsc_choose_folder,
            hvsc::hvsc_clear_folder,
            hvsc::hvsc_download_all,
            hvsc::hvsc_cancel_download,
            modland::modland_catalog,
            modland::modland_fetch,
            vma_build_raw,
            save_bin,
            take_opened_files,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_app, _event| {
        // macOS hands the opened files over as an event, not as arguments
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned());
            let cwd = std::env::current_dir().unwrap_or_default();
            queue_opened_files(_app, opened_paths(std::iter::once(String::new()).chain(paths), &cwd));
        }
    });
}

/// Manual check of a SID Editor export: `SID_ASM_IN=<exported .asm> cargo test --lib exported_player -- --ignored --nocapture`
/// assembles it with VMA and plays it as a PSID v3 with the second SID its header comment names.
#[cfg(test)]
mod sid_export_check {
    use super::*;

    #[test]
    #[ignore]
    fn exported_player_assembles_and_plays() {
        let Ok(input) = std::env::var("SID_ASM_IN") else { return };
        let source = fs::read_to_string(input).unwrap();
        let (_, address) = source.split_once("second SID at $").unwrap();
        let address = u16::from_str_radix(&address[..4], 16).unwrap();
        let built = vma_build_raw(source);
        assert_eq!(built["ok"], true, "{built}");
        let prg: Vec<u8> = built["prg"].as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect();
        let mut file = vec![0u8; 0x7c];
        file[..4].copy_from_slice(b"PSID");
        file[5] = 3;
        file[7] = 0x7c;
        file[0x0a] = 0xc0; // init $C000, play through the IRQ the player installs
        file[0x0f] = 1;
        file[0x11] = 1;
        file[0x7a] = ((address - 0xd000) >> 4) as u8;
        file.extend_from_slice(&prg);
        let mut player = va_sid::sid_file::SidFilePlayer::with_song(&file, 44_100, va_sid::sid_core::SidModel::Mos8580, 1).unwrap();
        assert_eq!(player.channels(), 2);
        let pcm = player.render_frames(150).unwrap();
        let peak = |channel: usize| pcm.chunks(2).map(|pair| i32::from(pair[channel]).abs()).max().unwrap();
        println!("second SID ${address:04X}, {} prg bytes, peak left {} right {}", prg.len(), peak(0), peak(1));
        assert!(peak(0) > 500 && peak(1) > 500);
    }
}

#[cfg(test)]
mod opened_files_tests {
    use super::*;

    #[test]
    fn only_sidpl_arguments_are_taken_and_made_absolute() {
        let cwd = std::env::temp_dir();
        let args = ["app.exe", "vegyes.SIDPL", "tune.sid", "--flag"].map(String::from);
        let paths = opened_paths(args, &cwd);
        assert_eq!(paths, vec![cwd.join("vegyes.SIDPL")]);
    }

    #[test]
    fn the_program_itself_is_skipped() {
        let paths = opened_paths(["x.sidpl".to_string()], Path::new("."));
        assert!(paths.is_empty());
    }
}
