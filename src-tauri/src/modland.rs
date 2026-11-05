// Modland (https://ftp.modland.com/) for the SID Player: the Amiga and tracker
// modules, the way hvsc.rs serves the SID tunes.
//
// The catalog is allmods.zip → allmods.txt: "size<TAB>Format/Author/…/file" for
// every file of the collection (~516 000 lines, 339 formats). Only the formats
// libopenmpt plays are kept (PLAYABLE, checked one by one against libopenmpt
// 0.8.10), the rest (console rips, SID, AdLib…) would not play. Modules are
// fetched one by one from pub/modules/ and cached under the app cache dir, so a
// module played once also plays offline.

use std::fs;
use std::io::Read;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use super::update_http_client;

const CATALOG_URL: &str = "https://ftp.modland.com/allmods.zip";
const FILES_URL: &str = "https://ftp.modland.com/pub/modules/";
const CATALOG_ENTRY: &str = "allmods.txt";
const MAX_CATALOG_ZIP: usize = 64 * 1024 * 1024;
const MAX_CATALOG_TEXT: usize = 256 * 1024 * 1024;
const MAX_MODULE_BYTES: usize = 48 * 1024 * 1024;

/// The Modland format folders libopenmpt opens and plays. Left out after the
/// test: Beaver Sweeper, Deflemask, Digital Sound Interface Kit, Digitrekker,
/// FAC SoundTracker, FamiTracker, MVS Tracker, Music Editor, Pollytracker,
/// Stereo Sidplayer (not opened) and Startrekker AM (silent: its instruments
/// are in a separate .nt file).
pub const PLAYABLE: &[&str] = &[
    "Astroidea XMF", "Asylum", "CBA", "Chiptracker", "Composer 667", "Composer 669",
    "Composer 670 (CDFM)", "DSMI Compact", "Digibooster", "Digibooster Pro",
    "Digital Sound And Music Interface", "Digital Sound Interface Kit RIFF", "Digital Symphony",
    "Digital Tracker DTM", "Digital Tracker MOD", "Digitrakker", "Disorder Tracker 2",
    "Dynamic Studio Professional", "EasyTrax", "Epic Megagames MASI", "Extreme Tracker",
    "FM Tracker", "Face The Music", "Farandole Composer", "Fasttracker", "Fasttracker 2",
    "Future Composer 1.3", "Future Composer 1.4", "Game Music Creator", "General DigiMusic",
    "Graoumf Tracker", "Graoumf Tracker 2", "His Master's Noise", "Images Music System",
    "Imago Orpheus", "Impulsetracker", "MO3", "Mad Tracker 2", "MultiMedia Sound", "Multitracker",
    "OctaMED MMD0", "OctaMED MMD1", "OctaMED MMD2", "OctaMED MMD3", "Octalyser", "Oktalyzer",
    "OpenMPT MPTM", "Polytracker", "Protracker", "Protracker IFF", "Pumatracker", "Real Tracker",
    "Screamtracker 2", "Screamtracker 3", "SoundFX", "Soundtracker", "Soundtracker 2.6",
    "Soundtracker Pro II", "Startrekker FLT8", "Symphonie", "TCB Tracker", "Ultratracker",
    "Unis 669", "Velvet Studio", "X-Tracker",
];

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_cache_dir().map(|d| d.join("modland")).map_err(|e| e.to_string())
}

/// A Modland path ("Protracker/Lizardking/1942.mod") split into its segments;
/// only the playable formats, and nothing that could leave the cache folder.
fn module_segments(path: &str) -> Option<Vec<&str>> {
    let segments: Vec<&str> = path.split('/').collect();
    if segments.len() < 2 || !PLAYABLE.contains(&segments[0]) {
        return None;
    }
    let ok = segments.iter().all(|s| {
        !s.is_empty() && *s != "." && *s != ".." && !s.ends_with('.')
            && !s.chars().any(|c| c.is_control() || matches!(c, '\\' | ':' | '?' | '*' | '"' | '<' | '>' | '|'))
    });
    ok.then_some(segments)
}

/// The lines of allmods.txt in a playable format, as "size<TAB>path" again.
fn playable_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len() / 2);
    for line in text.lines() {
        let Some((size, path)) = line.split_once('\t') else { continue };
        let format = path.split('/').next().unwrap_or("");
        if size.bytes().all(|b| b.is_ascii_digit()) && PLAYABLE.contains(&format) && module_segments(path).is_some() {
            out.push_str(size);
            out.push('\t');
            out.push_str(path);
            out.push('\n');
        }
    }
    out
}

fn le16(b: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?) as usize)
}

fn le32(b: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?) as usize)
}

/// One entry of a zip file, found through the central directory (stored or deflated).
fn zip_entry(zip: &[u8], name: &str) -> Result<Vec<u8>, String> {
    // the end-of-central-directory record is in the last 64 KiB + 22 bytes
    let from = zip.len().saturating_sub(0xFFFF + 22);
    let eocd = (from..zip.len().saturating_sub(21)).rev()
        .find(|&i| zip[i..].starts_with(b"PK\x05\x06"))
        .ok_or("not a zip file")?;
    let count = le16(zip, eocd + 10).ok_or("bad zip")?;
    let mut at = le32(zip, eocd + 16).ok_or("bad zip")?;
    for _ in 0..count {
        if !zip.get(at..).is_some_and(|b| b.starts_with(b"PK\x01\x02")) {
            return Err("bad zip central directory".into());
        }
        let method = le16(zip, at + 10).ok_or("bad zip")?;
        let packed = le32(zip, at + 20).ok_or("bad zip")?;
        let size = le32(zip, at + 24).ok_or("bad zip")?;
        let name_len = le16(zip, at + 28).ok_or("bad zip")?;
        let extra_len = le16(zip, at + 30).ok_or("bad zip")?;
        let comment_len = le16(zip, at + 32).ok_or("bad zip")?;
        let local = le32(zip, at + 42).ok_or("bad zip")?;
        let entry_name = zip.get(at + 46..at + 46 + name_len).ok_or("bad zip")?;
        if entry_name.eq_ignore_ascii_case(name.as_bytes()) {
            if size > MAX_CATALOG_TEXT {
                return Err(format!("{name}: too large"));
            }
            if !zip.get(local..).is_some_and(|b| b.starts_with(b"PK\x03\x04")) {
                return Err("bad zip local header".into());
            }
            let data_at = local + 30 + le16(zip, local + 26).ok_or("bad zip")? + le16(zip, local + 28).ok_or("bad zip")?;
            let data = zip.get(data_at..data_at + packed).ok_or("truncated zip")?;
            return match method {
                0 => Ok(data.to_vec()),
                8 => {
                    let mut out = Vec::with_capacity(size);
                    flate2::read::DeflateDecoder::new(data).take(MAX_CATALOG_TEXT as u64 + 1)
                        .read_to_end(&mut out).map_err(|e| e.to_string())?;
                    if out.len() != size {
                        return Err(format!("{name}: {} bytes unpacked, {size} expected", out.len()));
                    }
                    Ok(out)
                }
                m => Err(format!("{name}: unsupported zip method {m}")),
            };
        }
        at += 46 + name_len + extra_len + comment_len;
    }
    Err(format!("{name} is missing from the zip file"))
}

async fn download(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let resp = client.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{url}: HTTP {}", resp.status().as_u16()));
    }
    if resp.content_length().is_some_and(|n| n as usize > limit) {
        return Err(format!("{url}: too large"));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("{url}: {e}"))?;
    if bytes.len() > limit {
        return Err(format!("{url}: too large"));
    }
    Ok(bytes.to_vec())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The playable part of the catalog ("size<TAB>path" lines) and when it was fetched.
/// The cached copy is used unless `refresh`.
#[tauri::command]
pub async fn modland_catalog(app: AppHandle, refresh: bool) -> Result<serde_json::Value, String> {
    let dir = cache_dir(&app)?;
    let file = dir.join("playable.txt");
    let meta = dir.join("catalog.json");
    if !refresh {
        if let Ok(text) = fs::read_to_string(&file) {
            let fetched = fs::read_to_string(&meta).ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v["fetched"].as_u64());
            return Ok(serde_json::json!({ "source": "cache", "fetched": fetched, "text": text }));
        }
    }
    let client = update_http_client(&app, 300)?;
    let zip = download(&client, CATALOG_URL, MAX_CATALOG_ZIP).await?;
    let text = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let raw = zip_entry(&zip, CATALOG_ENTRY)?;
        Ok(playable_lines(&String::from_utf8_lossy(&raw)))
    })
    .await
    .map_err(|e| e.to_string())??;
    if text.is_empty() {
        return Err("allmods.txt: no playable module".into());
    }
    let fetched = unix_now();
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(&file, &text);
    let _ = fs::write(&meta, serde_json::json!({ "fetched": fetched }).to_string());
    Ok(serde_json::json!({ "source": "online", "fetched": fetched, "text": text }))
}

/// One module's bytes (raw, not a JSON number list: modules run to megabytes):
/// from the cache, or from Modland (then cached).
#[tauri::command]
pub async fn modland_fetch(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    fetch_module(&app, &path).await.map(tauri::ipc::Response::new)
}

async fn fetch_module(app: &AppHandle, path: &str) -> Result<Vec<u8>, String> {
    let segments = module_segments(path).ok_or_else(|| format!("invalid Modland path: {path}"))?;
    let cached = segments.iter().fold(cache_dir(app)?.join("modules"), |p, s| p.join(s));
    if let Ok(bytes) = fs::read(&cached) {
        return Ok(bytes);
    }
    let rel = segments.iter().map(|s| urlencoding::encode(s).into_owned()).collect::<Vec<_>>().join("/");
    let client = update_http_client(app, 60)?;
    let bytes = download(&client, &format!("{FILES_URL}{rel}"), MAX_MODULE_BYTES).await?;
    // a missing file comes back as an HTML error page with status 200 on some mirrors
    if bytes.is_empty() || bytes.starts_with(b"<html") || bytes.starts_with(b"<!DOCTYPE") {
        return Err(format!("{path}: not a module"));
    }
    if let Some(parent) = cached.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&cached, &bytes);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_paths_stay_inside_the_collection() {
        assert_eq!(module_segments("Protracker/Lizardking/1942.mod"), Some(vec!["Protracker", "Lizardking", "1942.mod"]));
        assert!(module_segments("Fasttracker 2/Jugi/Game/onward.xm").is_some());
        assert!(module_segments("Protracker/../../etc/passwd").is_none());
        assert!(module_segments("Protracker//x.mod").is_none());
        assert!(module_segments("Protracker/C:/x.mod").is_none());
        assert!(module_segments("Protracker/a\\b.mod").is_none());
        assert!(module_segments("Protracker/x.mod.").is_none());
        assert!(module_segments("HVSC/MUSICIANS/x.sid").is_none(), "not a playable format");
        assert!(module_segments("Protracker").is_none());
    }

    #[test]
    fn the_catalog_keeps_the_playable_formats() {
        let text = "59364\tProtracker/Lizardking/1942.mod\r\n1618\tStereo Sidplayer/X/a.mus\n12402\tFuture Composer 1.4/Jesper Kyd/x.fc\nbad line\n5\tProtracker/../x.mod\n";
        assert_eq!(playable_lines(text), "59364\tProtracker/Lizardking/1942.mod\n12402\tFuture Composer 1.4/Jesper Kyd/x.fc\n");
    }

    fn zip_of(name: &str, data: &[u8], deflate: bool) -> Vec<u8> {
        let packed = if deflate {
            let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
            std::io::Write::write_all(&mut enc, data).unwrap();
            enc.finish().unwrap()
        } else {
            data.to_vec()
        };
        let method: u16 = if deflate { 8 } else { 0 };
        let mut z = Vec::new();
        z.extend_from_slice(b"PK\x03\x04");
        z.extend_from_slice(&[20, 0, 0, 0]);
        z.extend_from_slice(&method.to_le_bytes());
        z.extend_from_slice(&[0; 8]);
        z.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        z.extend_from_slice(&(data.len() as u32).to_le_bytes());
        z.extend_from_slice(&(name.len() as u16).to_le_bytes());
        z.extend_from_slice(&[0, 0]);
        z.extend_from_slice(name.as_bytes());
        z.extend_from_slice(&packed);
        let central = z.len();
        z.extend_from_slice(b"PK\x01\x02");
        z.extend_from_slice(&[20, 0, 20, 0, 0, 0]);
        z.extend_from_slice(&method.to_le_bytes());
        z.extend_from_slice(&[0; 8]);
        z.extend_from_slice(&(packed.len() as u32).to_le_bytes());
        z.extend_from_slice(&(data.len() as u32).to_le_bytes());
        z.extend_from_slice(&(name.len() as u16).to_le_bytes());
        z.extend_from_slice(&[0; 12]);
        z.extend_from_slice(&0u32.to_le_bytes());
        z.extend_from_slice(name.as_bytes());
        let size = z.len() - central;
        z.extend_from_slice(b"PK\x05\x06");
        z.extend_from_slice(&[0, 0, 0, 0, 1, 0, 1, 0]);
        z.extend_from_slice(&(size as u32).to_le_bytes());
        z.extend_from_slice(&(central as u32).to_le_bytes());
        z.extend_from_slice(&[0, 0]);
        z
    }

    #[test]
    fn a_zip_entry_unpacks_stored_or_deflated() {
        let text = b"59364\tProtracker/Lizardking/1942.mod\n".repeat(50);
        assert_eq!(zip_entry(&zip_of("allmods.txt", &text, true), "allmods.txt").unwrap(), text);
        assert_eq!(zip_entry(&zip_of("allmods.txt", &text, false), "allmods.txt").unwrap(), text);
        assert!(zip_entry(&zip_of("other.txt", &text, true), "allmods.txt").is_err());
        assert!(zip_entry(b"not a zip", "allmods.txt").is_err());
    }

    // The real catalog: MODLAND_ZIP=…/allmods.zip cargo test --lib real_modland -- --ignored
    #[test]
    #[ignore]
    fn real_modland_catalog_unpacks() {
        let Ok(path) = std::env::var("MODLAND_ZIP") else { return };
        let raw = zip_entry(&fs::read(path).unwrap(), CATALOG_ENTRY).unwrap();
        let lines = playable_lines(&String::from_utf8_lossy(&raw));
        let count = lines.lines().count();
        assert!(count > 150_000, "{count} playable modules");
        assert!(lines.contains("\tProtracker/"));
        assert!(!lines.contains("\tHVSC/"));
    }
}
