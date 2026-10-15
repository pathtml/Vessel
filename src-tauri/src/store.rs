use crate::model::UsageSnapshot;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Last known snapshot per provider, so the popup opens instantly with cached data.
pub struct Store {
    map: BTreeMap<String, UsageSnapshot>,
    path: Option<PathBuf>,
}

impl Store {
    pub fn load(path: Option<PathBuf>) -> Self {
        let map = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<Vec<UsageSnapshot>>(&raw).ok())
            .map(|list| list.into_iter().map(|s| (s.provider.clone(), s)).collect())
            .unwrap_or_default();
        Self { map, path }
    }

    /// Offline keeps the last known windows so the bars don't vanish.
    pub fn apply(&mut self, mut new: UsageSnapshot) {
        if new.health == crate::model::Health::Offline {
            if let Some(old) = self.map.get(&new.provider) {
                if !old.windows.is_empty() {
                    new.windows = old.windows.clone();
                }
            }
        }
        self.map.insert(new.provider.clone(), new);
    }

    pub fn all(&self) -> Vec<UsageSnapshot> {
        self.map.values().cloned().collect()
    }

    pub fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.all()) {
            let _ = std::fs::write(path, json);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Health, UsageWindow};

    fn ok(provider: &str) -> UsageSnapshot {
        UsageSnapshot::ok(
            provider,
            provider,
            vec![UsageWindow::from_used("5h", 30.0, None)],
        )
    }

    #[test]
    fn offline_keeps_last_windows() {
        let mut store = Store::load(None);
        store.apply(ok("codex"));
        store.apply(UsageSnapshot::new("codex", "codex", Health::Offline, None));
        let all = store.all();
        assert_eq!(all[0].health, Health::Offline);
        assert_eq!(all[0].windows.len(), 1);
    }

    #[test]
    fn sign_in_error_does_not_keep_stale_windows() {
        let mut store = Store::load(None);
        store.apply(ok("codex"));
        store.apply(UsageSnapshot::new(
            "codex",
            "codex",
            Health::SignInAgain,
            None,
        ));
        assert!(store.all()[0].windows.is_empty());
    }
}
