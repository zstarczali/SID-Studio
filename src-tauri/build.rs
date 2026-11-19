fn main() {
    println!("cargo:rerun-if-changed=Cargo.lock");
    let lock = std::fs::read_to_string("Cargo.lock").unwrap_or_default();
    let vma_version = lock
        .split("[[package]]")
        .find(|package| package.lines().any(|line| line.trim() == "name = \"vma\""))
        .and_then(|package| package.lines().find_map(|line| line.trim().strip_prefix("version = \"")))
        .map(|version| version.trim_end_matches('"'))
        .unwrap_or("unknown");
    println!("cargo:rustc-env=VMA_VERSION={vma_version}");
    // va-sid: the version and the pinned commit (git dependency) from Cargo.lock
    let va_sid = lock
        .split("[[package]]")
        .find(|package| package.lines().any(|line| line.trim() == "name = \"va-sid\""))
        .unwrap_or_default();
    let va_sid_version = va_sid
        .lines()
        .find_map(|line| line.trim().strip_prefix("version = \""))
        .map(|version| version.trim_end_matches('"').to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let va_sid_rev = va_sid
        .lines()
        .find_map(|line| line.trim().strip_prefix("source = \"git+"))
        .and_then(|source| source.trim_end_matches('"').rsplit('#').next())
        .map(|rev| rev.chars().take(7).collect::<String>())
        .unwrap_or_default();
    let va_sid_full = if va_sid_rev.is_empty() { va_sid_version } else { format!("{va_sid_version} ({va_sid_rev})") };
    println!("cargo:rustc-env=VA_SID_VERSION={va_sid_full}");
    tauri_build::build()
}
