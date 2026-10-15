use crate::model::{Health, UsageSnapshot};
use tauri::image::Image;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Green,
    Amber,
    Red,
    Grey,
}

/// Colour of the worst connected provider: above 40% green, 15-40% amber, below 15% red.
pub fn level(snapshots: &[UsageSnapshot]) -> Level {
    let lowest = snapshots
        .iter()
        .filter_map(UsageSnapshot::lowest_remaining)
        .min();
    match lowest {
        None => Level::Grey,
        Some(pct) if pct > 40 => Level::Green,
        Some(pct) if pct >= 15 => Level::Amber,
        Some(_) => Level::Red,
    }
}

pub fn has_warning(snapshots: &[UsageSnapshot]) -> bool {
    snapshots.iter().any(|s| s.health.is_problem())
}

pub fn tooltip(snapshots: &[UsageSnapshot]) -> String {
    let lines: Vec<String> = snapshots
        .iter()
        .filter(|s| s.health != Health::ComingSoon && s.health != Health::NotConnected)
        .map(|s| match s.lowest_remaining() {
            Some(pct) => format!("{}: {}% left", s.display_name, pct),
            None => format!("{}: no data yet", s.display_name),
        })
        .collect();
    if lines.is_empty() {
        "Vessel".to_string()
    } else {
        format!("Vessel\n{}", lines.join("\n"))
    }
}

fn colour(level: Level) -> [u8; 4] {
    match level {
        Level::Green => [22, 163, 74, 255],
        Level::Amber => [217, 119, 6, 255],
        Level::Red => [220, 38, 38, 255],
        Level::Grey => [107, 114, 128, 255],
    }
}

fn disc(rgba: &mut [u8], size: usize, cx: f32, cy: f32, radius: f32, rgb: [u8; 4]) {
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            if dx * dx + dy * dy <= radius * radius {
                let i = (y * size + x) * 4;
                rgba[i..i + 4].copy_from_slice(&rgb);
            }
        }
    }
}

pub fn render_icon(level: Level, warning: bool) -> Image<'static> {
    let size = 32usize;
    let mut rgba = vec![0u8; size * size * 4];
    disc(&mut rgba, size, 16.0, 16.0, 14.0, colour(level));
    disc(&mut rgba, size, 16.0, 16.0, 8.0, [15, 23, 42, 255]);
    if warning {
        disc(&mut rgba, size, 25.0, 25.0, 7.0, [255, 255, 255, 255]);
        disc(&mut rgba, size, 25.0, 25.0, 4.0, [220, 38, 38, 255]);
    }
    Image::new_owned(rgba, size as u32, size as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::UsageWindow;

    fn snap(remaining: u32) -> UsageSnapshot {
        UsageSnapshot::ok(
            "p",
            "P",
            vec![UsageWindow::from_used("5h", (100 - remaining) as f64, None)],
        )
    }

    #[test]
    fn colour_thresholds() {
        assert_eq!(level(&[snap(41)]), Level::Green);
        assert_eq!(level(&[snap(40)]), Level::Amber);
        assert_eq!(level(&[snap(15)]), Level::Amber);
        assert_eq!(level(&[snap(14)]), Level::Red);
    }

    #[test]
    fn worst_provider_wins() {
        assert_eq!(level(&[snap(90), snap(10)]), Level::Red);
    }

    #[test]
    fn no_data_is_grey() {
        assert_eq!(level(&[]), Level::Grey);
        let waiting = UsageSnapshot::new("c", "C", Health::WaitingForFirstUse, None);
        assert_eq!(level(&[waiting]), Level::Grey);
    }

    #[test]
    fn warning_only_for_real_problems() {
        assert!(has_warning(&[UsageSnapshot::new(
            "c",
            "C",
            Health::SignInAgain,
            None
        )]));
        assert!(!has_warning(&[UsageSnapshot::new(
            "g",
            "G",
            Health::ComingSoon,
            None
        )]));
    }
}
