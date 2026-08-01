use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::GenericImageView;
use serde::Serialize;
use tauri::State;

/// Extracted album-art colours used to tint the UI for the current track.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Palette {
    /// Dominant vivid colour, as `#rrggbb`.
    pub primary: String,
    /// A contrasting companion, as `#rrggbb`.
    pub secondary: String,
    /// Whether the artwork is dark overall — lets the UI decide text contrast.
    pub is_dark: bool,
}

#[derive(Default)]
pub struct ArtworkCache(Mutex<HashMap<String, Palette>>);

impl ArtworkCache {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Pixels this washed-out or this close to black/white carry no useful hue,
/// so they're excluded from the vote rather than dragging everything grey.
const MIN_SATURATION: f32 = 0.18;
const MIN_LIGHTNESS: f32 = 0.12;
const MAX_LIGHTNESS: f32 = 0.92;
const HUE_BUCKETS: usize = 24;

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    let delta = max - min;

    if delta.abs() < f32::EPSILON {
        return (0.0, 0.0, l);
    }

    let s = if l > 0.5 {
        delta / (2.0 - max - min)
    } else {
        delta / (max + min)
    };

    let h = if (max - r).abs() < f32::EPSILON {
        ((g - b) / delta).rem_euclid(6.0)
    } else if (max - g).abs() < f32::EPSILON {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    };

    (h * 60.0, s, l)
}

fn hsl_to_hex(h: f32, s: f32, l: f32) -> String {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h_prime = h.rem_euclid(360.0) / 60.0;
    let x = c * (1.0 - (h_prime % 2.0 - 1.0).abs());
    let (r1, g1, b1) = match h_prime as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = l - c / 2.0;
    let to_byte = |v: f32| ((v + m).clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", to_byte(r1), to_byte(g1), to_byte(b1))
}

/// Votes pixels into hue buckets and returns the palette. Weighting each vote
/// by saturation biases the result toward the colour a person would actually
/// call "the colour of this cover", rather than whatever merely covers the
/// most area (usually a muted background).
pub fn palette_from_pixels(pixels: impl Iterator<Item = (u8, u8, u8)>) -> Palette {
    let mut buckets = [0f32; HUE_BUCKETS];
    let mut sat_sum = [0f32; HUE_BUCKETS];
    let mut light_sum = [0f32; HUE_BUCKETS];
    let mut total_lightness = 0f32;
    let mut total = 0f32;

    for (r, g, b) in pixels {
        let (h, s, l) = rgb_to_hsl(r, g, b);
        total_lightness += l;
        total += 1.0;

        if s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS {
            continue;
        }
        let idx = ((h / 360.0) * HUE_BUCKETS as f32) as usize % HUE_BUCKETS;
        buckets[idx] += s;
        sat_sum[idx] += s;
        light_sum[idx] += l;
    }

    let is_dark = total > 0.0 && (total_lightness / total) < 0.5;

    let best = buckets
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(i, w)| (i, *w));

    let Some((idx, weight)) = best.filter(|(_, w)| *w > 0.0) else {
        // No colourful pixels at all (pure greyscale art): fall back to the
        // brand accents so the UI still looks intentional.
        return Palette {
            primary: "#7c5cff".into(),
            secondary: "#ec4899".into(),
            is_dark,
        };
    };

    let count = weight.max(f32::EPSILON);
    let hue = (idx as f32 + 0.5) * (360.0 / HUE_BUCKETS as f32);
    let sat = (sat_sum[idx] / count).clamp(0.45, 0.85);
    let light = (light_sum[idx] / count).clamp(0.42, 0.62);

    // Second swatch is a neighbouring hue rather than a strict complement —
    // analogous pairs read as "designed" while complements often clash.
    let secondary_hue = hue + 42.0;

    Palette {
        primary: hsl_to_hex(hue, sat, light),
        secondary: hsl_to_hex(secondary_hue, (sat * 0.95).clamp(0.4, 0.8), light * 0.9),
        is_dark,
    }
}

fn decode_source(source: &str) -> Result<Vec<u8>, String> {
    if let Some(rest) = source.strip_prefix("data:") {
        let b64 = rest
            .split_once(";base64,")
            .map(|(_, data)| data)
            .ok_or_else(|| "unsupported data URI (expected base64)".to_string())?;
        return STANDARD.decode(b64).map_err(|e| e.to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(source).send().map_err(|e| e.to_string())?;
    response.bytes().map(|b| b.to_vec()).map_err(|e| e.to_string())
}

fn extract(source: &str) -> Result<Palette, String> {
    let bytes = decode_source(source)?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    // Downscale first: a 64x64 thumbnail is plenty to judge colour and keeps
    // this to a few thousand pixels regardless of the source resolution.
    let small = img.thumbnail(64, 64);
    Ok(palette_from_pixels(
        small.pixels().map(|(_, _, p)| (p.0[0], p.0[1], p.0[2])),
    ))
}

#[tauri::command]
pub async fn artwork_palette(
    cache: State<'_, ArtworkCache>,
    source: String,
) -> Result<Palette, String> {
    if let Ok(map) = cache.0.lock() {
        if let Some(hit) = map.get(&source) {
            return Ok(hit.clone());
        }
    }

    let key = source.clone();
    // Decoding is CPU-bound and the fetch is blocking, so keep both off the
    // async runtime's worker threads.
    let palette = tauri::async_runtime::spawn_blocking(move || extract(&key))
        .await
        .map_err(|e| e.to_string())??;

    if let Ok(mut map) = cache.0.lock() {
        map.insert(source, palette.clone());
    }
    Ok(palette)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(r: u8, g: u8, b: u8, n: usize) -> impl Iterator<Item = (u8, u8, u8)> {
        std::iter::repeat((r, g, b)).take(n)
    }

    #[test]
    fn picks_the_dominant_hue() {
        // Mostly red with a little blue: the primary should land in the reds.
        let pixels = solid(220, 30, 30, 900).chain(solid(30, 30, 220, 100));
        let palette = palette_from_pixels(pixels);

        let hex = palette.primary.trim_start_matches('#');
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap();
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap();
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap();
        assert!(r > g && r > b, "expected a red-dominant primary, got {}", palette.primary);
    }

    #[test]
    fn greyscale_art_falls_back_to_brand_accents() {
        let palette = palette_from_pixels(solid(128, 128, 128, 500));
        assert_eq!(palette.primary, "#7c5cff");
        assert_eq!(palette.secondary, "#ec4899");
    }

    #[test]
    fn reports_darkness() {
        assert!(palette_from_pixels(solid(12, 12, 20, 200)).is_dark);
        assert!(!palette_from_pixels(solid(240, 240, 250, 200)).is_dark);
    }

    #[test]
    fn produces_valid_hex() {
        let palette = palette_from_pixels(solid(10, 180, 90, 400));
        for hex in [&palette.primary, &palette.secondary] {
            assert_eq!(hex.len(), 7, "bad hex: {hex}");
            assert!(hex.starts_with('#'));
            assert!(u32::from_str_radix(&hex[1..], 16).is_ok(), "bad hex: {hex}");
        }
    }
}
