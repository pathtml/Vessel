//! Phase 0 spike. Probes each provider and prints a verdict. Never prints tokens.

use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

fn home() -> Option<PathBuf> {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok().map(PathBuf::from)
}

fn codex() -> String {
    let path = std::env::var("CODEX_HOME")
        .ok()
        .map(|h| PathBuf::from(h).join("auth.json"))
        .filter(|p| p.exists())
        .or_else(|| home().map(|h| h.join(".codex").join("auth.json")).filter(|p| p.exists()));
    let Some(path) = path else { return "NOT FOUND: no Codex auth.json".into() };
    let Ok(raw) = std::fs::read_to_string(&path) else { return "ERROR: cannot read auth.json".into() };
    let Ok(auth) = serde_json::from_str::<Value>(&raw) else { return "ERROR: auth.json invalid".into() };
    let token = auth.pointer("/tokens/access_token").and_then(Value::as_str);
    let account = auth.pointer("/tokens/account_id").and_then(Value::as_str);
    let (Some(token), Some(account)) = (token, account) else {
        return "NEEDS SIGN-IN: auth.json lacks token or account id".into();
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("codex-cli")
        .build()
        .unwrap();
    let resp = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .bearer_auth(token)
        .header("ChatGPT-Account-Id", account)
        .header("Accept", "application/json")
        .send();
    let resp = match resp {
        Ok(r) => r,
        Err(e) => return format!("OFFLINE/ERROR: {e}"),
    };
    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return format!("NEEDS SIGN-IN: HTTP {status}");
    }
    if !status.is_success() {
        return format!("SOURCE CHANGED?: HTTP {status}");
    }
    let Ok(body) = resp.json::<Value>() else { return "SOURCE CHANGED?: body not JSON".into() };
    let mut out = vec![];
    for (label, ptr) in [("5h", "/rate_limit/primary_window"), ("weekly", "/rate_limit/secondary_window")] {
        if let Some(w) = body.pointer(ptr) {
            let used = w.get("used_percent").and_then(Value::as_u64);
            let reset = w.get("reset_at").and_then(Value::as_u64);
            out.push(format!("{label}: used={used:?}% reset_at={reset:?}"));
        }
    }
    if out.is_empty() {
        "SOURCE CHANGED?: no rate_limit windows in response".into()
    } else {
        format!("LIVE OK -> {}", out.join(" | "))
    }
}

fn claude() -> String {
    let Some(h) = home() else { return "ERROR: no home".into() };
    let export = h.join(".vessel").join("claude-code-usage.json");
    let legacy = h.join(".ai-usage-dock").join("claude-code-usage.json");
    let settings = h.join(".claude").join("settings.json");
    let found = [export, legacy].into_iter().find(|p| p.exists());
    match found {
        Some(p) => {
            let raw = std::fs::read_to_string(&p).unwrap_or_default();
            let ok = serde_json::from_str::<Value>(&raw)
                .ok()
                .map(|v| v.pointer("/rate_limits/five_hour").is_some() || v.pointer("/rate_limits/seven_day").is_some())
                .unwrap_or(false);
            if ok { format!("LIVE OK from {}", p.display()) } else { "WAITING: export has no rate limits yet".into() }
        }
        None if settings.exists() => "SETUP AVAILABLE: Claude Code present, hook not installed".into(),
        None if h.join(".claude").exists() => "SETUP AVAILABLE: ~/.claude exists, no settings.json yet (hook installer would create it)".into(),
        None => "NOT FOUND: Claude Code not installed".into(),
    }
}

fn gemini() -> String {
    let Some(h) = home() else { return "ERROR: no home".into() };
    let creds = h.join(".gemini").join("oauth_creds.json");
    let export = h.join(".vessel").join("gemini-cli-usage.json");
    if export.exists() {
        return format!("LIVE OK? export at {}", export.display());
    }
    if creds.exists() {
        return "CANDIDATE: Gemini CLI login found, but no documented quota endpoint to call -> COMING SOON unless one is confirmed".into();
    }
    "COMING SOON: no Gemini CLI login (~/.gemini/oauth_creds.json) and no quota export".into()
}

fn main() {
    println!("Codex : {}", codex());
    println!("Claude: {}", claude());
    println!("Gemini: {}", gemini());
}
