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
    tauri_build::build()
}
