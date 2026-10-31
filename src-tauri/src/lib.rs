// VA SID Studio backend: SID emulation (VA SID Core), .sid register dump, the VMA build of the player, file saving.
mod c64;
mod hvsc;
mod mos6510;
mod sid_core;
mod sid_file;

use base64::Engine;
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidPreviewPayload {
    sample_rate: u32,
    model: String,
    #[serde(default)]
    session_id: Option<String>,
    frames: Vec<Vec<u8>>,
}

static SID_PREVIEW_SESSIONS: OnceLock<Mutex<HashMap<String, (sid_core::SidCore, [u8; 3], Instant)>>> = OnceLock::new();

/// Writes one SID Editor register frame in the player's order: per voice
/// AD / SR, frequency and pulse width before the control register (a restarted
/// note first gets its gate cleared), then the filter and volume.
fn write_preview_frame(sid: &mut sid_core::SidCore, registers: &[u8], last_ctl: &mut [u8; 3]) {
    let restart = registers.get(0x19).copied().unwrap_or(0);
    for voice in 0..3 {
        let base = voice * 7;
        if restart & (1 << voice) != 0 {
            sid.write((base + 4) as u8, last_ctl[voice] & 0xfe);
        }
        for offset in [5, 6, 0, 1, 2, 3, 4] {
            sid.write((base + offset) as u8, registers[base + offset]);
        }
        last_ctl[voice] = registers[base + 4];
    }
    for address in 0x15..0x19 {
        sid.write(address as u8, registers[address]);
    }
}

/// Offline renderer for the SID Editor's original Rust core.  Audio is
/// rendered in short frame batches on the backend, then scheduled by Web Audio
/// in the frontend; keeping the audio device in the WebView avoids native
/// device/driver differences across Windows, macOS and Linux.
#[tauri::command]
async fn render_sid_preview(payload: SidPreviewPayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || render_sid_preview_blocking(payload))
        .await
        .map_err(|error| format!("SID preview worker failed: {error}"))?
}

fn render_sid_preview_blocking(payload: SidPreviewPayload) -> Result<String, String> {
    const MAX_FRAMES: usize = 3_000; // one minute at PAL 50 Hz
    if payload.frames.is_empty() || payload.frames.len() > MAX_FRAMES {
        return Err("Invalid SID preview length.".to_string());
    }
    // The SID Editor sends the 25 implemented registers ($D400-$D418), and
    // optionally a 26th byte: bits 0-2 = voices whose note restarted in this
    // frame (the player clears the gate and sets it again within the frame,
    // which the final register values alone do not show).
    if payload.frames.iter().any(|frame| frame.len() != 0x19 && frame.len() != 0x1a) {
        return Err("Invalid SID register frame: expected 25 registers ($D400-$D418).".to_string());
    }

    let sample_rate = payload.sample_rate.clamp(8_000, 96_000);
    let model = if payload.model.eq_ignore_ascii_case("6581") {
        sid_core::SidModel::Mos6581
    } else {
        sid_core::SidModel::Mos8580
    };
    let render_frames = |sid: &mut sid_core::SidCore, last_ctl: &mut [u8; 3]| {
        let mut pcm = Vec::<i16>::with_capacity((payload.frames.len() * sample_rate as usize) / 50 + 2);
        let mut rendered = 0usize;
        for (frame_index, registers) in payload.frames.iter().enumerate() {
            write_preview_frame(sid, registers, last_ctl);
            let target = ((frame_index + 1) * sample_rate as usize) / 50;
            let mut chunk = vec![0i16; target.saturating_sub(rendered)];
            sid.render(&mut chunk);
            rendered += chunk.len();
            pcm.extend_from_slice(&chunk);
        }
        pcm
    };
    let pcm = if let Some(session_id) = payload.session_id.as_deref() {
        if session_id.is_empty() || session_id.len() > 80 {
            return Err("Invalid SID preview session.".to_string());
        }
        let sessions = SID_PREVIEW_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()));
        let mut sessions = sessions.lock().map_err(|_| "SID preview state is unavailable.")?;
        sessions.retain(|_, (_, _, last_used)| last_used.elapsed() < Duration::from_secs(180));
        if !sessions.contains_key(session_id) && sessions.len() >= 16 {
            return Err("Too many active SID previews.".to_string());
        }
        let (sid, last_ctl, last_used) = sessions.entry(session_id.to_string()).or_insert_with(|| {
            (sid_core::SidCore::new(sample_rate, model), [0; 3], Instant::now())
        });
        *last_used = Instant::now();
        render_frames(sid, last_ctl)
    } else {
        render_frames(&mut sid_core::SidCore::new(sample_rate, model), &mut [0; 3])
    };

    let bytes: Vec<u8> = pcm.iter().flat_map(|sample| sample.to_le_bytes()).collect();
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn release_sid_preview(session_id: String) {
    if let Some(sessions) = SID_PREVIEW_SESSIONS.get() {
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&session_id);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidFilePayload {
    session_id: String,
    sample_rate: u32,
    model: String,
    frames: usize,
    file_bytes: Option<Vec<u8>>,
    #[serde(default)]
    skip_ms: u32,
    /// 1-based subtune; 0 = the header's start song. Only used with file_bytes.
    #[serde(default)]
    song: u16,
}

// Each session has its own lock: the map is locked only to look a session up,
// so a long render or seek never blocks the other sessions, nor the
// synchronous info / release commands that run on the main thread.
type SidFileSession = Arc<Mutex<sid_file::SidFilePlayer>>;
static SID_FILE_SESSIONS: OnceLock<Mutex<HashMap<String, (SidFileSession, Instant)>>> =
    OnceLock::new();

fn sid_file_sessions() -> Result<std::sync::MutexGuard<'static, HashMap<String, (SidFileSession, Instant)>>, String> {
    SID_FILE_SESSIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "SID file playback state is unavailable.".to_string())
}

// The emulation runs on a blocking thread: seeking can take seconds in a
// debug build and must not occupy the async runtime's workers.
#[tauri::command]
async fn render_sid_file(payload: SidFilePayload) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || render_sid_file_blocking(payload))
        .await
        .map_err(|e| format!("SID file playback failed: {e}"))?
}

fn render_sid_file_blocking(payload: SidFilePayload) -> Result<String, String> {
    if payload.session_id.is_empty()
        || payload.session_id.len() > 80
        || !(1..=20).contains(&payload.frames)
    {
        return Err("Invalid SID file playback request.".into());
    }
    if payload.file_bytes.as_ref().is_some_and(|bytes| bytes.len() > 1_048_576) {
        return Err("SID file is too large.".into());
    }
    let sample_rate = payload.sample_rate.clamp(8_000, 96_000);
    let model = if payload.model.eq_ignore_ascii_case("6581") {
        sid_core::SidModel::Mos6581
    } else {
        sid_core::SidModel::Mos8580
    };
    let session = if let Some(bytes) = payload.file_bytes.as_deref() {
        {
            let mut sessions = sid_file_sessions()?;
            sessions.retain(|_, (_, last_used)| last_used.elapsed() < Duration::from_secs(180));
            // Only one external tune plays at a time, so at the limit the least
            // recently used session is stale (e.g. its release is still on the way).
            while !sessions.contains_key(&payload.session_id) && sessions.len() >= 8 {
                let oldest = sessions
                    .iter()
                    .min_by_key(|(_, (_, last_used))| *last_used)
                    .map(|(id, _)| id.clone());
                match oldest {
                    Some(id) => sessions.remove(&id),
                    None => break,
                };
            }
        }
        // built outside the map lock: the init routine may run for a while
        let player = sid_file::SidFilePlayer::with_song(bytes, sample_rate, model, payload.song)?;
        let session = Arc::new(Mutex::new(player));
        sid_file_sessions()?.insert(payload.session_id.clone(), (session.clone(), Instant::now()));
        session
    } else {
        let mut sessions = sid_file_sessions()?;
        let (session, last_used) = sessions
            .get_mut(&payload.session_id)
            .ok_or("SID file playback session has expired.")?;
        *last_used = Instant::now();
        session.clone()
    };
    let mut player = session
        .lock()
        .map_err(|_| "SID file playback session failed.".to_string())?;
    // A tune has no seek of its own: seeking runs the skipped frames silently.
    let skip_samples = u64::from(payload.skip_ms.min(3_600_000)) * u64::from(sample_rate) / 1000;
    if skip_samples > 0 {
        let frame_samples = player.skip_frames(1)?.max(1) as u64;
        player.skip_frames((skip_samples.saturating_sub(frame_samples) / frame_samples) as usize)?;
    }
    let pcm = player.render_frames(payload.frames)?;
    let bytes: Vec<u8> = pcm.iter().flat_map(|sample| sample.to_le_bytes()).collect();
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn sid_file_info(session_id: String) -> Result<serde_json::Value, String> {
    let session = sid_file_sessions()?
        .get(&session_id)
        .map(|(session, _)| session.clone())
        .ok_or("SID file playback session has expired.")?;
    // try_lock: this runs on the main thread, never wait for a render here
    let player = session
        .try_lock()
        .map_err(|_| "SID file playback session is busy.".to_string())?;
    Ok(serde_json::json!({ "songs": player.songs(), "song": player.song() }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidDumpPayload {
    file_bytes: Vec<u8>,
    /// 1-based subtune; 0 = the header's start song.
    #[serde(default)]
    song: u16,
    seconds: u32,
}

/// Runs a .sid tune silently and returns its SID register writes frame by
/// frame (the SID Editor's .sid import converts them into patterns).
#[tauri::command]
async fn sid_register_dump(app: AppHandle, payload: SidDumpPayload) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || sid_register_dump_blocking(&app, payload))
        .await
        .map_err(|e| format!("SID register dump failed: {e}"))?
}

fn sid_register_dump_blocking(app: &AppHandle, payload: SidDumpPayload) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    if payload.file_bytes.len() > 1_048_576 {
        return Err("SID file is too large.".into());
    }
    let mut player =
        sid_file::SidFilePlayer::with_song(&payload.file_bytes, 44_100, sid_core::SidModel::Mos8580, payload.song)?;
    let frames = (f64::from(payload.seconds.clamp(1, 900)) * player.frame_rate()).round() as usize;
    // about one progress event per percent
    let step = (frames / 100).max(1);
    let regs = player.dump_registers(frames, |done| {
        if done % step == 0 || done == frames {
            let _ = app.emit("sid-dump-progress", serde_json::json!({ "done": done, "total": frames }));
        }
    });
    let (name, author) = sid_file::header_strings(&payload.file_bytes);
    Ok(serde_json::json!({
        "songs": player.songs(),
        "song": player.song(),
        "frameRate": player.frame_rate(),
        "frameBytes": sid_file::DUMP_FRAME_BYTES,
        "name": name,
        "author": author,
        "regs": base64::engine::general_purpose::STANDARD.encode(regs),
    }))
}

#[tauri::command]
fn release_sid_file(session_id: String) {
    // a render still in flight keeps its Arc and finishes on its own
    if let Ok(mut sessions) = sid_file_sessions() {
        sessions.remove(&session_id);
    }
}

#[tauri::command]
fn open_external(url: String, app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            render_sid_preview,
            release_sid_preview,
            render_sid_file,
            release_sid_file,
            sid_file_info,
            sid_register_dump,
            open_external,
            hvsc::hvsc_status,
            hvsc::hvsc_catalog,
            hvsc::hvsc_fetch,
            hvsc::hvsc_choose_folder,
            hvsc::hvsc_clear_folder,
            hvsc::hvsc_download_all,
            hvsc::hvsc_cancel_download,
            vma_build_raw,
            save_bin,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod sid_file_session_tests {
    use super::*;

    fn payload(id: &str, file: Option<&[u8]>, skip_ms: u32) -> SidFilePayload {
        SidFilePayload {
            session_id: id.into(),
            sample_rate: 44_100,
            model: "8580".into(),
            frames: 1,
            file_bytes: file.map(|bytes| bytes.to_vec()),
            skip_ms,
            song: 0,
        }
    }

    // A long seek in one session must not stall the main-thread commands
    // (info / release) or another session: that froze the app on track switches.
    #[test]
    fn a_long_seek_does_not_block_other_sessions_or_release() {
        let tune: &[u8] = include_bytes!("../../samples/Ikari_Intro.sid");
        render_sid_file_blocking(payload("seek", Some(tune), 0)).unwrap();
        render_sid_file_blocking(payload("other", Some(tune), 0)).unwrap();
        let seeking = std::thread::spawn(|| render_sid_file_blocking(payload("seek", None, 20_000)));
        while !seeking.is_finished() && !SID_FILE_SESSIONS.get().unwrap().lock().unwrap()["seek"].0.try_lock().is_err() {
            std::thread::yield_now();
        }
        let started = Instant::now();
        sid_file_info("other".into()).unwrap();
        render_sid_file_blocking(payload("other", None, 0)).unwrap();
        release_sid_file("other".into());
        release_sid_file("seek".into());
        assert!(started.elapsed() < Duration::from_secs(5), "blocked for {:?}", started.elapsed());
        seeking.join().unwrap().unwrap();
    }

    // Quick track switches can open sessions faster than the releases arrive:
    // the oldest one is dropped instead of failing with "Too many active SID files".
    #[test]
    fn unreleased_sessions_are_evicted_not_refused() {
        let tune: &[u8] = include_bytes!("../../samples/Ikari_Intro.sid");
        for n in 0..12 {
            render_sid_file_blocking(payload(&format!("switch-{n}"), Some(tune), 0)).unwrap();
        }
        let sessions = sid_file_sessions().unwrap();
        assert!(sessions.len() <= 8);
        assert!(sessions.contains_key("switch-11"));
        assert!(!sessions.contains_key("switch-0"));
    }
}

#[cfg(test)]
mod sid_preview_tests {
    use super::*;

    /// Voice 3 envelope after a few frames where the note is restarted under a
    /// held gate (the SID Editor engine's note on), with and without the flag.
    fn env_after_restart(flag: bool) -> u8 {
        let mut sid = sid_core::SidCore::new(44_100, sid_core::SidModel::Mos8580);
        let mut last = [0u8; 3];
        let mut frame = vec![0u8; 0x1a];
        frame[14] = 0x00;
        frame[15] = 0x10; // frequency
        frame[18] = 0x21; // saw + gate
        frame[19] = 0x00; // attack 0, decay 0
        frame[20] = 0x00; // sustain 0
        frame[0x18] = 0x0f;
        let mut pcm = vec![0i16; 882];
        for k in 0..10 {
            frame[0x19] = if k == 6 && flag { 4 } else { 0 };
            write_preview_frame(&mut sid, &frame, &mut last);
            sid.render(&mut pcm[..if k == 6 { 20 } else { 882 }]);
            if k == 6 {
                return sid.read(0x1c);
            }
        }
        unreachable!()
    }

    #[test]
    fn restart_flag_retriggers_the_envelope_under_a_held_gate() {
        assert_eq!(env_after_restart(false), 0, "sustain 0: the envelope has died out");
        assert!(env_after_restart(true) > 0, "the restart gives a new attack");
    }
}
