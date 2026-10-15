use std::path::PathBuf;

pub fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

/// Where Vessel keeps files that other tools (e.g. the Claude hook) write for us.
pub fn vessel_dir() -> Option<PathBuf> {
    Some(home_dir()?.join(".vessel"))
}

/// Pre-rename export folder. Read-only fallback until the v1 import lands.
pub fn legacy_dir() -> Option<PathBuf> {
    Some(home_dir()?.join(".ai-usage-dock"))
}
