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
    // va-sid: the version from Cargo.lock
    let va_sid = lock
        .split("[[package]]")
        .find(|package| package.lines().any(|line| line.trim() == "name = \"va-sid\""))
        .unwrap_or_default();
    let va_sid_version = va_sid
        .lines()
        .find_map(|line| line.trim().strip_prefix("version = \""))
        .map(|version| version.trim_end_matches('"').to_string())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=VA_SID_VERSION={va_sid_version}");
    tauri_build::build()
}
