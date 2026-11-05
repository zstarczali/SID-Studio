// Self-update, the same way as C64 Visual Assembler. The installers are on the VA server in downloads/SIDS/;
// its index.php lists them, up to the version released on the dashboard (register/release-studio.php),
// and the newest version is read from the file names. There is no manifest.

use crate::{read_config, update_http_client, write_config};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const UPDATE_SERVER_DEFAULT: &str = "https://www.c64va.pro/";
const UPDATE_DOWNLOADS: &str = "downloads/SIDS/";

/// The server's address checked, ending in `/`: https, or http for localhost only (local tests);
/// no user name, query or fragment. Empty = the default server.
fn normalize_update_server(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(UPDATE_SERVER_DEFAULT.to_string());
    }
    let url = reqwest::Url::parse(raw).map_err(|_| format!("Invalid update server address: {raw}"))?;
    let host = url.host_str().unwrap_or("");
    let local = matches!(host, "localhost" | "127.0.0.1" | "[::1]");
    let scheme_ok = url.scheme() == "https" || (url.scheme() == "http" && local);
    if !scheme_ok
        || host.is_empty()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(format!("Invalid update server address (https:// required): {raw}"));
    }
    let mut s = url.to_string();
    if !s.ends_with('/') {
        s.push('/');
    }
    Ok(s)
}

fn update_server(app: &AppHandle) -> String {
    let cfg = read_config(app);
    normalize_update_server(cfg["updateServer"].as_str().unwrap_or(""))
        .unwrap_or_else(|_| UPDATE_SERVER_DEFAULT.to_string())
}

#[tauri::command]
pub fn get_update_server(app: AppHandle) -> serde_json::Value {
    let cfg = read_config(&app);
    serde_json::json!({
        "updateServer": cfg["updateServer"].as_str().unwrap_or(""),
        "effective": update_server(&app),
        "default": UPDATE_SERVER_DEFAULT,
    })
}

#[tauri::command]
pub fn set_update_server(app: AppHandle, url: String) -> Result<serde_json::Value, String> {
    let normalized = normalize_update_server(&url)?;
    let mut cfg = read_config(&app);
    if normalized == UPDATE_SERVER_DEFAULT {
        if let Some(map) = cfg.as_object_mut() {
            map.remove("updateServer");
        }
    } else {
        cfg["updateServer"] = serde_json::json!(normalized);
    }
    write_config(&app, &cfg);
    Ok(get_update_server(app))
}

fn parse_version_triplet(s: &str) -> Option<(u32, u32, u32)> {
    let mut parts = s.trim().trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// The running platform's installer: prefix + version + suffix (the names Tauri's bundler gives).
fn update_asset_pattern() -> Option<(&'static str, &'static str)> {
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return Some(("VA SID Studio_", "_arm64-setup.exe"));
    #[cfg(all(target_os = "windows", not(target_arch = "aarch64")))]
    return Some(("VA SID Studio_", "_x64-setup.exe"));
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some(("VA SID Studio_", "_aarch64.dmg"));
    #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
    return Some(("VA SID Studio_", "_x64.dmg"));
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        if std::env::var_os("APPIMAGE").is_some() {
            return Some(("VA SID Studio_", "_amd64.AppImage"));
        }
        let rpm_based = Path::new("/etc/redhat-release").exists()
            || Path::new("/etc/fedora-release").exists()
            || (!Path::new("/usr/bin/dpkg").exists() && Path::new("/usr/bin/rpm").exists());
        return if rpm_based {
            Some(("VA SID Studio-", "-1.x86_64.rpm"))
        } else {
            Some(("VA SID Studio_", "_amd64.deb"))
        };
    }
    #[allow(unreachable_code)]
    None
}

fn update_asset_name(version: &str) -> Option<String> {
    let (prefix, suffix) = update_asset_pattern()?;
    Some(format!("{prefix}{version}{suffix}"))
}

/// The highest `prefix<version>suffix` in the list.
fn find_latest_asset_version(html: &str, prefix: &str, suffix: &str) -> Option<(u32, u32, u32)> {
    let text = html.replace("%20", " ");
    let mut best: Option<(u32, u32, u32)> = None;
    let mut rest = text.as_str();
    while let Some(pos) = rest.find(prefix) {
        rest = &rest[pos + prefix.len()..];
        let ver_len = rest
            .find(|c: char| !(c.is_ascii_digit() || c == '.'))
            .unwrap_or(rest.len());
        let (ver, tail) = rest.split_at(ver_len);
        if !tail.starts_with(suffix) {
            continue;
        }
        if let Some(v) = parse_version_triplet(ver) {
            if best.map_or(true, |b| v > b) {
                best = Some(v);
            }
        }
    }
    best
}

/// The list's hotfix mark: `<meta name="va-hotfix" content="1.4.0 2">` = the installers of a released
/// version were uploaded again, this is hotfix 2 (HOTFIX on the dashboard). 0 if there is none.
fn find_hotfix_level(html: &str, version: (u32, u32, u32)) -> u32 {
    let mut level = 0;
    let mut rest = html;
    while let Some(pos) = rest.find("name=\"va-hotfix\"") {
        rest = &rest[pos + 16..];
        let Some(c) = rest.find("content=\"") else { break };
        let body = &rest[c + 9..];
        let end = body.find('"').unwrap_or(body.len());
        let mut parts = body[..end].split_whitespace();
        if let (Some(v), Some(n)) = (parts.next(), parts.next()) {
            if parse_version_triplet(v) == Some(version) {
                level = level.max(n.parse().unwrap_or(0));
            }
        }
        rest = &body[end..];
    }
    level
}

/// The installed hotfix (config `hotfixInstalled`): valid for the running version only.
fn installed_hotfix_level(cfg: &serde_json::Value, current: &str) -> u32 {
    let h = &cfg["hotfixInstalled"];
    if h["version"].as_str() == Some(current) {
        h["level"].as_u64().unwrap_or(0) as u32
    } else {
        0
    }
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<serde_json::Value, String> {
    let current = app.package_info().version.to_string();
    let Some((prefix, suffix)) = update_asset_pattern() else {
        return Ok(serde_json::json!({ "supported": false, "currentVersion": current }));
    };
    let client = update_http_client(&app, 15)?;
    let server = update_server(&app);
    let download_base = format!("{server}{UPDATE_DOWNLOADS}");
    let html = client
        .get(&download_base)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let (ma, mi, pa) = find_latest_asset_version(&html, prefix, suffix)
        .ok_or("No download found for this platform.")?;
    let latest = format!("{ma}.{mi}.{pa}");
    let current_v = parse_version_triplet(&current).unwrap_or((0, 0, 0));
    // the same version again: a hotfix this app has not installed yet
    let mut hotfix = 0;
    if (ma, mi, pa) == current_v {
        let level = find_hotfix_level(&html, current_v);
        if level > installed_hotfix_level(&read_config(&app), &current) {
            hotfix = level;
        }
    }
    let file_name = update_asset_name(&latest).unwrap_or_default();
    Ok(serde_json::json!({
        "supported": true,
        "currentVersion": current,
        "latestVersion": latest,
        "updateAvailable": (ma, mi, pa) > current_v || hotfix > 0,
        "hotfix": hotfix,
        "fileName": file_name,
        "url": format!("{download_base}{}", urlencoding::encode(&file_name)),
        "server": server,
    }))
}

#[cfg(not(target_os = "windows"))]
fn spawn_update_script(script: &str, args: &[&str]) -> Result<(), String> {
    let dir = std::env::temp_dir().join("va-sid-studio").join("update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let script_path = dir.join("apply-update.sh");
    fs::write(&script_path, script).map_err(|e| e.to_string())?;
    // under an AppImage these can point into a mount that goes away on exit:
    // the helper, pkexec / apt-get and the restarted app must not inherit them
    Command::new("/bin/sh")
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("LD_PRELOAD")
        .arg(&script_path)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn dir_writable(dir: &Path) -> bool {
    let probe = dir.join(".vastudio-write-test");
    let ok = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

#[cfg(target_os = "windows")]
fn windows_powershell_path() -> String {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
    let full = Path::new(&root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    if full.exists() {
        full.to_string_lossy().to_string()
    } else {
        "powershell".to_string()
    }
}

/// Starts the downloaded installer. `Ok(true)` = the app exits and the helper restarts it,
/// `Ok(false)` = the installer is only opened, the user finishes by hand.
fn launch_update_installer(file: &Path) -> Result<bool, String> {
    let file_str = file.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        // Start-Process goes through ShellExecuteEx, which handles UAC elevation.
        // Tauri NSIS: /P = passive (progress only), /R = restart the app afterwards.
        let ps_cmd = format!(
            "Start-Process -FilePath '{}' -ArgumentList '/P','/R'",
            file_str.replace('\'', "''")
        );
        let out = Command::new(windows_powershell_path())
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_cmd])
            .stdin(std::process::Stdio::null())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        let pid = std::process::id().to_string();
        let bundle = std::env::current_exe().ok().and_then(|exe| {
            exe.ancestors()
                .find(|p| p.extension().map_or(false, |e| e == "app"))
                .map(Path::to_path_buf)
        });
        let Some(bundle) = bundle.filter(|b| b.parent().map_or(false, dir_writable)) else {
            Command::new("open").arg(&file_str).spawn().map_err(|e| e.to_string())?;
            return Ok(false);
        };
        let script = r#"PID="$1"; DMG="$2"; TARGET="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
MNT=$(mktemp -d /tmp/vastudio-update.XXXXXX)
if ! hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$DMG"; then open "$DMG"; exit 1; fi
SRC=$(ls -d "$MNT"/*.app 2>/dev/null | head -n 1)
if [ -n "$SRC" ] && rm -rf "$TARGET.new" && ditto "$SRC" "$TARGET.new"; then
  rm -rf "$TARGET.old"; mv "$TARGET" "$TARGET.old" && mv "$TARGET.new" "$TARGET" && rm -rf "$TARGET.old"
  hdiutil detach -quiet "$MNT"
  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
  open "$TARGET"
else
  hdiutil detach -quiet "$MNT"; open "$DMG"
fi
"#;
        spawn_update_script(script, &[&pid, &file_str, &bundle.to_string_lossy()])?;
        return Ok(true);
    }

    #[cfg(target_os = "linux")]
    {
        let pid = std::process::id().to_string();
        if let Some(appimage) = std::env::var_os("APPIMAGE").map(std::path::PathBuf::from) {
            if !appimage.parent().map_or(false, dir_writable) {
                return Err(format!("Not writable: {}", appimage.display()));
            }
            let script = r#"PID="$1"; NEW="$2"; TARGET="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
chmod +x "$NEW" && cp -f "$NEW" "$TARGET.new" && mv -f "$TARGET.new" "$TARGET" && rm -f "$NEW"
exec "$TARGET"
"#;
            spawn_update_script(script, &[&pid, &file_str, &appimage.to_string_lossy()])?;
            return Ok(true);
        }
        if !Path::new("/usr/bin/pkexec").exists() {
            Command::new("xdg-open").arg(&file_str).spawn().map_err(|e| e.to_string())?;
            return Ok(false);
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let script = r#"PID="$1"; PKG="$2"; EXE="$3"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
case "$PKG" in
  *.deb) if command -v apt-get >/dev/null; then pkexec apt-get install -y "$PKG"; else pkexec dpkg -i "$PKG"; fi ;;
  *.rpm) if command -v dnf >/dev/null; then pkexec dnf install -y "$PKG"; else pkexec rpm -U "$PKG"; fi ;;
esac
if [ $? -ne 0 ]; then xdg-open "$PKG"; fi
exec "$EXE"
"#;
        spawn_update_script(script, &[&pid, &file_str, &exe.to_string_lossy()])?;
        return Ok(true);
    }

    #[allow(unreachable_code)]
    {
        let _ = file_str;
        Err("Self-update is not supported on this platform.".into())
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    version: String,
    hotfix: Option<u32>,
) -> Result<serde_json::Value, String> {
    // Only a version comes from the JS, the URL is built here: no arbitrary file can be downloaded and run.
    if parse_version_triplet(&version).is_none() {
        return Err(format!("Invalid version: {version}"));
    }
    let file_name = update_asset_name(&version).ok_or("Self-update is not supported on this platform.")?;
    let url = format!(
        "{}{UPDATE_DOWNLOADS}{}",
        update_server(&app),
        urlencoding::encode(&file_name)
    );

    let dir = std::env::temp_dir().join("va-sid-studio").join("update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(&file_name);
    let partial = dir.join(format!("{file_name}.part"));

    let client = update_http_client(&app, 600)?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut out = fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_pct: i64 = -1;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        out.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        let pct = if total > 0 { (received * 100 / total) as i64 } else { -1 };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit(
                "update-download-progress",
                serde_json::json!({ "received": received, "total": total }),
            );
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);

    if (total > 0 && received != total) || received < 1024 * 1024 {
        let _ = fs::remove_file(&partial);
        return Err(format!("Incomplete download ({received} / {total} bytes)."));
    }
    let _ = fs::remove_file(&target);
    fs::rename(&partial, &target).map_err(|e| e.to_string())?;

    let restarting = launch_update_installer(&target)?;
    // a hotfix of the running version: remember it, or the same installer would be offered again
    if let Some(level) = hotfix.filter(|&l| l > 0) {
        if version == app.package_info().version.to_string() {
            let mut cfg = read_config(&app);
            cfg["hotfixInstalled"] = serde_json::json!({ "version": version, "level": level });
            write_config(&app, &cfg);
        }
    }
    if restarting {
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(800));
            handle.exit(0);
        });
    }
    Ok(serde_json::json!({ "restarting": restarting, "path": target.to_string_lossy() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_highest_version_of_the_platform_only() {
        let html = r#"<a href="VA%20SID%20Studio_1.4.0_x64-setup.exe">
            <a href="VA%20SID%20Studio_1.10.0_arm64-setup.exe">
            <a href="VA SID Studio_1.5.1_x64-setup.exe">
            <a href="VA%20SID%20Studio-1.9.0-1.x86_64.rpm">
            <a href="C64%20Visual%20Assembler_2.7.4_x64-setup.exe">"#;
        assert_eq!(find_latest_asset_version(html, "VA SID Studio_", "_x64-setup.exe"), Some((1, 5, 1)));
        assert_eq!(find_latest_asset_version(html, "VA SID Studio-", "-1.x86_64.rpm"), Some((1, 9, 0)));
        assert_eq!(find_latest_asset_version(html, "VA SID Studio_", "_x64.dmg"), None);
    }

    #[test]
    fn the_running_platform_has_an_installer_name() {
        let name = update_asset_name("1.4.1").unwrap();
        assert!(name.starts_with("VA SID Studio"), "{name}");
        assert!(name.contains("1.4.1"), "{name}");
    }

    #[test]
    fn reads_the_hotfix_level_of_a_version() {
        let html = r#"<meta name="va-hotfix" content="1.4.0 4">
            <meta name="va-hotfix" content="1.4.1 2"><ul><li>x</li></ul>"#;
        assert_eq!(find_hotfix_level(html, (1, 4, 1)), 2);
        assert_eq!(find_hotfix_level(html, (1, 4, 0)), 4);
        assert_eq!(find_hotfix_level(html, (1, 4, 2)), 0);
        assert_eq!(find_hotfix_level(r#"<meta name="va-hotfix" content="1.4.1 x">"#, (1, 4, 1)), 0);
    }

    #[test]
    fn installed_hotfix_counts_only_for_the_running_version() {
        let cfg = serde_json::json!({ "hotfixInstalled": { "version": "1.4.0", "level": 2 } });
        assert_eq!(installed_hotfix_level(&cfg, "1.4.0"), 2);
        assert_eq!(installed_hotfix_level(&cfg, "1.4.1"), 0);
        assert_eq!(installed_hotfix_level(&serde_json::json!({}), "1.4.0"), 0);
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(parse_version_triplet("1.10.0") > parse_version_triplet("1.9.9"));
        assert_eq!(parse_version_triplet("v1.4"), Some((1, 4, 0)));
        assert_eq!(parse_version_triplet("1.4.0.1"), None);
        assert_eq!(parse_version_triplet("../x"), None);
    }

    #[test]
    fn the_server_address_is_normalized_and_checked() {
        assert_eq!(normalize_update_server("").unwrap(), UPDATE_SERVER_DEFAULT);
        assert_eq!(normalize_update_server("https://example.com").unwrap(), "https://example.com/");
        assert_eq!(normalize_update_server("http://localhost:8000").unwrap(), "http://localhost:8000/");
        assert!(normalize_update_server("http://example.com/").is_err());
        assert!(normalize_update_server("https://user@example.com/").is_err());
        assert!(normalize_update_server("https://example.com/?a=1").is_err());
        assert!(normalize_update_server("nonsense").is_err());
    }
}
