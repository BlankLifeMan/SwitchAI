use std::path::PathBuf;

fn state_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".switchai")
}

fn state_file(filename: &str) -> PathBuf {
    state_dir().join(filename)
}

pub fn update_last_gateway_state(running: bool) {
    let path = state_file("last_gateway_state");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let value = if running { "1" } else { "0" };
    let _ = std::fs::write(&path, value);
}

pub fn read_last_gateway_state() -> bool {
    let path = state_file("last_gateway_state");
    std::fs::read_to_string(&path)
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}

pub fn generate_provider_id(name: &str) -> String {
    let slug = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>();
    let short = uuid::Uuid::new_v4().to_string();
    format!("{}-{}", slug, &short[..8])
}
