//! Shared import filesystem helpers — sanitize, hash, derive stem, collision
//! check, and container-signature sniffing.

use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// Container kinds we content-validate before copying an imported file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SniffKind {
    Glb,
    Wav,
    Ogg,
    Opus,
    Flac,
    Mp3,
    M4a,
    Aac,
    Webm,
}

/// Bytes read from the source head to recognize a container signature.
pub(crate) const SNIFF_HEADER_LEN: usize = 16;

/// Map an allowed lowercase audio extension to its sniff kind.
pub(crate) fn audio_sniff_kind(ext_lower: &str) -> Option<SniffKind> {
    match ext_lower {
        "mp3" => Some(SniffKind::Mp3),
        "wav" => Some(SniffKind::Wav),
        "ogg" => Some(SniffKind::Ogg),
        "m4a" => Some(SniffKind::M4a),
        "flac" => Some(SniffKind::Flac),
        "aac" => Some(SniffKind::Aac),
        "opus" => Some(SniffKind::Opus),
        "webm" => Some(SniffKind::Webm),
        _ => None,
    }
}

/// True when `header` carries a container signature matching `kind`.
pub(crate) fn sniff_ok(header: &[u8], kind: SniffKind) -> bool {
    match kind {
        SniffKind::Glb => header.starts_with(b"glTF"),
        SniffKind::Wav => {
            header.len() >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WAVE"
        }
        SniffKind::Ogg | SniffKind::Opus => header.starts_with(b"OggS"),
        SniffKind::Flac => header.starts_with(b"fLaC"),
        SniffKind::Mp3 => {
            header.starts_with(b"ID3")
                || (header.len() >= 2 && header[0] == 0xFF && header[1] & 0xE0 == 0xE0)
        }
        SniffKind::M4a | SniffKind::Aac => {
            (header.len() >= 8 && &header[4..8] == b"ftyp")
                || (header.len() >= 2 && header[0] == 0xFF && header[1] & 0xF6 == 0xF0)
        }
        SniffKind::Webm => header.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]),
    }
}

/// Read the source head and report whether it matches `kind`. Errors generically
/// when the source cannot be opened or read.
pub(crate) fn sniff_file(src: &Path, kind: SniffKind) -> Result<bool, String> {
    let mut f = std::fs::File::open(src).map_err(|e| {
        log::warn!("sniff_open_failed src={} error={e}", src.display());
        "source file not found".to_string()
    })?;
    let mut header = [0u8; SNIFF_HEADER_LEN];
    let n = f.read(&mut header).map_err(|e| {
        log::warn!("sniff_read_failed src={} error={e}", src.display());
        "source file not found".to_string()
    })?;
    Ok(sniff_ok(&header[..n], kind))
}

/// Chars neutralized regardless of position: path separators, ASCII control chars
/// (including NUL and DEL), and the characters illegal in a Windows filename.
fn is_unsafe_stem_char(c: char) -> bool {
    matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')
        || (c as u32) < 0x20
        || c == '\u{7f}'
}

/// Windows reserved device names — matched case-insensitively against the part of the
/// stem before its first `.`, so both a bare `CON` and a `CON.txt`-shaped stem are caught.
const RESERVED_STEM_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn is_reserved_stem_name(s: &str) -> bool {
    let base = s.split('.').next().unwrap_or(s);
    RESERVED_STEM_NAMES
        .iter()
        .any(|r| r.eq_ignore_ascii_case(base))
}

/// Filesystem path-component byte cap. Generous for a single stem while guaranteeing a
/// multi-byte (UTF-8) name cannot blow past typical filesystem limits (~255 bytes).
const MAX_STEM_BYTES: usize = 150;

/// Truncate `s` to at most `max_bytes`, backing off to the nearest char boundary so a
/// multi-byte UTF-8 sequence is never split.
fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Sanitize a filename stem into a safe path-component, permitting UTF-8. Neutralizes path
/// separators, `.`/`..` traversal (via leading/trailing dot trim), leading/trailing whitespace,
/// ASCII control chars + NUL, Windows-illegal characters, and Windows reserved device names, and
/// caps the byte length. Collapses to `avatar` when nothing safe/usable remains.
pub(crate) fn sanitize_stem(stem: &str) -> String {
    let substituted: String = stem
        .chars()
        .map(|c| if is_unsafe_stem_char(c) { '_' } else { c })
        .collect();
    let trim = |s: &str| {
        s.trim_matches(|c: char| c == '.' || c.is_whitespace())
            .to_string()
    };
    let trimmed = trim(&substituted);
    let capped = trim(truncate_at_char_boundary(&trimmed, MAX_STEM_BYTES));

    if capped.is_empty() || capped.chars().all(|c| c == '_') || is_reserved_stem_name(&capped) {
        return "avatar".to_string();
    }
    capped
}

/// Lexically normalize `path` by resolving `.`/`..` components without touching
/// the filesystem. A leading `..` that would escape the root yields `None`.
fn lexical_normalize(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

/// Assert `child` stays under `parent` (defense-in-depth against traversal).
/// `parent` is canonicalized (must exist). `child` need not exist yet, so its
/// deepest existing ancestor is canonicalized and the remaining components are
/// appended — this resolves filesystem symlinks (e.g. macOS `/var`→`/private/var`)
/// while staying valid for a not-yet-created dest. Errors generically when `parent`
/// is unresolvable or the resolved `child` escapes it.
pub(crate) fn ensure_within(parent: &Path, child: &Path) -> Result<(), String> {
    let parent = parent
        .canonicalize()
        .map_err(|_| "destination parent unavailable".to_string())?;

    let normalized = lexical_normalize(child).ok_or("path escapes its parent".to_string())?;

    // Canonicalize the deepest ancestor that exists, then re-append the tail so a
    // symlinked parent prefix is resolved even when the leaf does not exist yet.
    let mut ancestor = normalized.as_path();
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    let resolved = loop {
        if let Ok(c) = ancestor.canonicalize() {
            let mut full = c;
            for part in tail.iter().rev() {
                full.push(part);
            }
            break full;
        }
        match (ancestor.file_name(), ancestor.parent()) {
            (Some(name), Some(p)) => {
                tail.push(name);
                ancestor = p;
            }
            _ => break normalized.clone(),
        }
    };

    if resolved.starts_with(&parent) {
        Ok(())
    } else {
        Err("path escapes its parent".to_string())
    }
}

/// FNV-1a over the full source path → short stable hex suffix for disambiguation.
pub(crate) fn short_hash(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:x}", h & 0xffffff)
}

/// Derive the dest filename stem from a source path, disambiguating on collision.
/// `taken(stem)` reports whether `stem` is already claimed by an existing dest.
pub(crate) fn derive_dest_stem(src: &Path, taken: impl Fn(&str) -> bool) -> String {
    let raw = src.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let base = sanitize_stem(raw);
    if !taken(&base) {
        return base;
    }
    let suffixed = format!("{}-{}", base, short_hash(&src.to_string_lossy()));
    if !taken(&suffixed) {
        return suffixed;
    }
    // Last resort: numeric walk.
    for n in 2.. {
        let candidate = format!("{}-{}", base, n);
        if !taken(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

/// True when `dest` already exists — any existing dest is a collision, so the
/// caller must disambiguate rather than overwrite.
pub(crate) fn collides(dest: &Path) -> bool {
    dest.exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A safe stem can never be empty, `.`, `..`, contain a path separator, a Windows-illegal
    /// character, an ASCII control char, or carry a leading/trailing dot or whitespace —
    /// but otherwise permits arbitrary UTF-8 (the relaxed charset).
    fn is_safe_stem(s: &str) -> bool {
        !s.is_empty()
            && s != "."
            && s != ".."
            && !s.chars().any(|c| {
                matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')
                    || (c as u32) < 0x20
                    || c == '\u{7f}'
            })
            && !s.starts_with('.')
            && !s.ends_with('.')
            && s.trim() == s
            && s.len() <= MAX_STEM_BYTES
    }

    // ── sanitize_stem ────────────────────────────────────────────────────────

    #[test]
    fn sanitize_keeps_alnum_underscore_dash_unchanged() {
        assert_eq!(sanitize_stem("My_Avatar-1"), "My_Avatar-1");
    }

    #[test]
    fn sanitize_keeps_an_interior_dot() {
        // Only leading/trailing dots are traversal-relevant — an interior dot is a normal char.
        assert_eq!(sanitize_stem("My_Avatar-1.0"), "My_Avatar-1.0");
    }

    #[test]
    fn sanitize_keeps_unicode_verbatim() {
        assert_eq!(sanitize_stem("ナツメ"), "ナツメ");
        assert_eq!(sanitize_stem("무라사메"), "무라사메");
    }

    #[test]
    fn sanitize_keeps_interior_spaces_and_parens() {
        assert_eq!(sanitize_stem("my avatar (v2)"), "my avatar (v2)");
    }

    #[test]
    fn sanitize_collapses_to_avatar_when_empty() {
        assert_eq!(sanitize_stem(""), "avatar");
        assert_eq!(sanitize_stem("   "), "avatar");
        assert_eq!(sanitize_stem("///"), "avatar");
    }

    #[test]
    fn sanitize_replaces_path_separators() {
        assert_eq!(sanitize_stem("a/b"), "a_b");
        assert_eq!(sanitize_stem("a\\b"), "a_b");
        assert_eq!(sanitize_stem("a//b\\\\c"), "a__b__c");
    }

    #[test]
    fn sanitize_dotdot_and_dot_collapse_to_avatar() {
        assert_eq!(sanitize_stem(".."), "avatar");
        assert_eq!(sanitize_stem("."), "avatar");
        assert_eq!(sanitize_stem("...."), "avatar");
        assert_ne!(sanitize_stem(".."), "..");
    }

    #[test]
    fn sanitize_trims_leading_and_trailing_dots_and_whitespace() {
        assert_eq!(sanitize_stem("..hidden"), "hidden");
        assert_eq!(sanitize_stem("hidden.."), "hidden");
        assert_eq!(sanitize_stem("  spaced  "), "spaced");
        assert_eq!(sanitize_stem(" . mixed . "), "mixed");
    }

    #[test]
    fn sanitize_neutralizes_control_chars_and_nul() {
        assert_eq!(sanitize_stem("a\0b"), "a_b");
        assert_eq!(sanitize_stem("a\tb\nc"), "a_b_c");
        assert!(is_safe_stem(&sanitize_stem("\0")));
    }

    #[test]
    fn sanitize_replaces_windows_illegal_chars() {
        assert_eq!(sanitize_stem(r#"a<b>c:d"e|f?g*h"#), "a_b_c_d_e_f_g_h");
    }

    #[test]
    fn sanitize_neutralizes_reserved_windows_device_names() {
        for name in [
            "CON", "con", "PRN", "AUX", "NUL", "COM0", "COM1", "com9", "LPT0", "LPT1", "lpt9",
        ] {
            assert_eq!(sanitize_stem(name), "avatar", "{name} must be neutralized");
        }
        // With an extension-shaped suffix, still caught.
        assert_eq!(sanitize_stem("CON.txt"), "avatar");
        assert_eq!(sanitize_stem("com1.mp3"), "avatar");
        // COM10/LPT10 are not reserved (current Microsoft docs list only COM0-9/LPT0-9) — pass through.
        assert_eq!(sanitize_stem("COM10"), "COM10");
        assert_eq!(sanitize_stem("LPT10"), "LPT10");
    }

    #[test]
    fn sanitize_caps_byte_length_on_a_char_boundary() {
        let long = "a".repeat(500);
        let out = sanitize_stem(&long);
        assert!(out.len() <= MAX_STEM_BYTES);
        assert!(out.chars().all(|c| c == 'a'));

        // Multi-byte chars: cap must not split a codepoint.
        let long_unicode = "あ".repeat(200); // 3 bytes each, 600 bytes total
        let out_unicode = sanitize_stem(&long_unicode);
        assert!(out_unicode.len() <= MAX_STEM_BYTES);
        assert!(out_unicode.chars().all(|c| c == 'あ'));
        assert!(std::str::from_utf8(out_unicode.as_bytes()).is_ok());
    }

    #[test]
    fn sanitize_neutralizes_traversal_inputs() {
        for input in [
            "..",
            ".",
            "../x",
            "a/b",
            "a\\b",
            "\0",
            "....",
            "../../etc/passwd",
            "..\\..\\windows",
            "....//....//etc",
        ] {
            let out = sanitize_stem(input);
            assert!(
                is_safe_stem(&out),
                "{input:?} -> {out:?} is not a safe stem"
            );
        }
    }

    #[test]
    fn sanitize_dotdot_is_never_dotdot() {
        assert_ne!(sanitize_stem(".."), "..");
        assert_eq!(sanitize_stem(".."), "avatar");
        assert_eq!(sanitize_stem("."), "avatar");
    }

    #[test]
    fn sanitize_handles_unicode_by_keeping_it_safe() {
        let out = sanitize_stem("ナツメ");
        assert!(is_safe_stem(&out));
        assert_eq!(out, "ナツメ");
    }

    #[test]
    fn sanitize_output_is_idempotent() {
        for input in ["My_Avatar-1.0", "ナツメ", "..", "CON", "a/b\\c", "  x  "] {
            let once = sanitize_stem(input);
            let twice = sanitize_stem(&once);
            assert_eq!(
                once, twice,
                "sanitize_stem must be idempotent for {input:?}"
            );
        }
    }

    #[test]
    fn sanitize_stem_matches_the_shared_cross_language_fixture() {
        // Shared with src/io/safe-id.test.ts's sanitizeStem reimplementation — a single source of
        // truth for what sanitize_stem produces, so the Rust and TS charset rules cannot drift.
        let raw = include_str!("../../fixtures/sanitize-stem-cases.json");
        let cases: Vec<serde_json::Value> = serde_json::from_str(raw).unwrap();
        assert!(!cases.is_empty(), "fixture must not be empty");
        for case in &cases {
            let input = case["input"].as_str().unwrap();
            let expected = case["expected"].as_str().unwrap();
            assert_eq!(
                sanitize_stem(input),
                expected,
                "sanitize_stem({input:?}) mismatch"
            );
        }
    }

    #[test]
    fn sanitize_traversal_result_cannot_escape_via_ensure_within() {
        // Defense-in-depth: even though sanitize_stem already neutralizes traversal, prove the
        // sanitized id joined under a parent never escapes it.
        let parent = std::env::temp_dir().join("yui_sanitize_escape_check");
        std::fs::create_dir_all(&parent).unwrap();
        for input in [
            "../../etc/passwd",
            "..\\..\\windows",
            "..",
            ".",
            "a/../../b",
        ] {
            let id = sanitize_stem(input);
            let child = parent.join(&id);
            assert!(
                ensure_within(&parent, &child).is_ok(),
                "{input:?} -> {id:?} produced a child that failed ensure_within"
            );
        }
        std::fs::remove_dir_all(&parent).ok();
    }

    // ── ensure_within ────────────────────────────────────────────────────────

    #[test]
    fn ensure_within_accepts_a_normal_child() {
        let parent = std::env::temp_dir();
        let child = parent.join("vrms").join("Cat.vrm");
        assert!(ensure_within(&parent, &child).is_ok());
    }

    #[test]
    fn ensure_within_rejects_a_dotdot_escaping_child() {
        let parent = std::env::temp_dir().join("yui_within_parent");
        std::fs::create_dir_all(&parent).unwrap();
        let escaping = parent.join("..").join("sibling.vrm");
        assert!(ensure_within(&parent, &escaping).is_err());
    }

    #[test]
    fn ensure_within_rejects_a_sibling_dir() {
        let parent = std::env::temp_dir().join("yui_within_a");
        std::fs::create_dir_all(&parent).unwrap();
        let sibling = std::env::temp_dir().join("yui_within_b").join("x.vrm");
        assert!(ensure_within(&parent, &sibling).is_err());
    }

    // ── derive_dest_stem ─────────────────────────────────────────────────────

    #[test]
    fn derive_uses_sanitized_stem_when_no_collision() {
        let src = PathBuf::from("/Users/me/Downloads/My Avatar.vrm");
        let stem = derive_dest_stem(&src, |_| false);
        // Interior spaces are kept by the relaxed sanitize_stem — only traversal/illegal chars are neutralized.
        assert_eq!(stem, "My Avatar");
    }

    #[test]
    fn derive_disambiguates_on_any_existing_dest() {
        let src = PathBuf::from("/a/b/Cat.vrm");
        let stem = derive_dest_stem(&src, |candidate| candidate == "Cat");
        assert_ne!(stem, "Cat");
        assert!(stem.starts_with("Cat"));
        assert!(is_safe_stem(&stem));
    }

    #[test]
    fn derive_is_deterministic_for_a_given_src_path() {
        let src = PathBuf::from("/a/b/Cat.vrm");
        let a = derive_dest_stem(&src, |c| c == "Cat");
        let b = derive_dest_stem(&src, |c| c == "Cat");
        assert_eq!(a, b);
    }

    #[test]
    fn derive_distinct_src_paths_disambiguate_differently() {
        let src1 = PathBuf::from("/dir-one/Cat.vrm");
        let src2 = PathBuf::from("/dir-two/Cat.vrm");
        let a = derive_dest_stem(&src1, |c| c == "Cat");
        let b = derive_dest_stem(&src2, |c| c == "Cat");
        assert_ne!(a, b);
    }

    // ── collides ─────────────────────────────────────────────────────────────

    #[test]
    fn collides_is_false_when_dest_absent() {
        let dest = std::env::temp_dir().join("yui_collides_absent_xyz.vrm");
        let _ = std::fs::remove_file(&dest);
        assert!(!collides(&dest));
    }

    #[test]
    fn collides_is_true_for_any_existing_dest_regardless_of_length() {
        let dest = std::env::temp_dir().join("yui_collides_present.vrm");
        std::fs::write(&dest, b"any bytes").unwrap();
        assert!(collides(&dest));
        let _ = std::fs::remove_file(&dest);
    }

    // ── short_hash ───────────────────────────────────────────────────────────

    #[test]
    fn short_hash_is_safe_charset_and_stable() {
        let h = short_hash("/some/path/Cat.vrm");
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(h, short_hash("/some/path/Cat.vrm"));
    }

    // ── sniff_ok ─────────────────────────────────────────────────────────────

    #[test]
    fn sniff_glb_accepts_gltf_magic() {
        assert!(sniff_ok(b"glTF\x02\x00\x00\x00", SniffKind::Glb));
    }

    #[test]
    fn sniff_glb_rejects_non_gltf() {
        assert!(!sniff_ok(b"%PDF-1.4", SniffKind::Glb));
        assert!(!sniff_ok(b"GLTF", SniffKind::Glb));
        assert!(!sniff_ok(b"gl", SniffKind::Glb));
    }

    #[test]
    fn sniff_wav_requires_riff_and_wave() {
        assert!(sniff_ok(b"RIFF\x24\x08\x00\x00WAVEfmt ", SniffKind::Wav));
        assert!(!sniff_ok(b"RIFF\x24\x08\x00\x00AVI WAVE", SniffKind::Wav));
        assert!(!sniff_ok(
            b"OggS\x00\x02\x00\x00\x00\x00\x00\x00",
            SniffKind::Wav
        ));
    }

    #[test]
    fn sniff_ogg_and_opus_require_oggs() {
        assert!(sniff_ok(b"OggS\x00\x02\x00\x00", SniffKind::Ogg));
        assert!(sniff_ok(b"OggS\x00\x02\x00\x00", SniffKind::Opus));
        assert!(!sniff_ok(b"RIFF....WAVE", SniffKind::Ogg));
    }

    #[test]
    fn sniff_flac_requires_flac_magic() {
        assert!(sniff_ok(b"fLaC\x00\x00\x00\x22", SniffKind::Flac));
        assert!(!sniff_ok(b"FLAC", SniffKind::Flac));
    }

    #[test]
    fn sniff_mp3_accepts_id3_or_frame_sync() {
        assert!(sniff_ok(b"ID3\x04\x00\x00\x00\x00", SniffKind::Mp3));
        assert!(sniff_ok(&[0xFF, 0xFB, 0x90, 0x00], SniffKind::Mp3));
        assert!(sniff_ok(&[0xFF, 0xE0, 0x00, 0x00], SniffKind::Mp3));
        assert!(!sniff_ok(b"RIFF....WAVE", SniffKind::Mp3));
        assert!(!sniff_ok(&[0xFF, 0x00, 0x00, 0x00], SniffKind::Mp3));
    }

    #[test]
    fn sniff_m4a_accepts_ftyp_or_adts() {
        assert!(sniff_ok(b"\x00\x00\x00\x20ftypM4A ", SniffKind::M4a));
        assert!(sniff_ok(&[0xFF, 0xF1, 0x00, 0x00], SniffKind::M4a));
        assert!(sniff_ok(&[0xFF, 0xF0, 0x00, 0x00], SniffKind::M4a));
        assert!(!sniff_ok(b"\x00\x00\x00\x20moovM4A ", SniffKind::M4a));
    }

    #[test]
    fn sniff_aac_accepts_ftyp_or_adts() {
        assert!(sniff_ok(b"\x00\x00\x00\x20ftypM4A ", SniffKind::Aac));
        assert!(sniff_ok(&[0xFF, 0xF1, 0x00, 0x00], SniffKind::Aac));
        assert!(!sniff_ok(b"plain text here ", SniffKind::Aac));
    }

    #[test]
    fn sniff_webm_requires_ebml_magic() {
        assert!(sniff_ok(&[0x1A, 0x45, 0xDF, 0xA3, 0x00], SniffKind::Webm));
        assert!(!sniff_ok(b"RIFF....WAVE", SniffKind::Webm));
    }

    #[test]
    fn sniff_rejects_short_headers() {
        assert!(!sniff_ok(b"gl", SniffKind::Glb));
        assert!(!sniff_ok(b"RI", SniffKind::Wav));
        assert!(!sniff_ok(&[0xFF], SniffKind::Mp3));
        assert!(!sniff_ok(b"", SniffKind::Webm));
    }

    #[test]
    fn audio_sniff_kind_maps_each_allowed_ext() {
        assert!(matches!(audio_sniff_kind("mp3"), Some(SniffKind::Mp3)));
        assert!(matches!(audio_sniff_kind("wav"), Some(SniffKind::Wav)));
        assert!(matches!(audio_sniff_kind("ogg"), Some(SniffKind::Ogg)));
        assert!(matches!(audio_sniff_kind("m4a"), Some(SniffKind::M4a)));
        assert!(matches!(audio_sniff_kind("flac"), Some(SniffKind::Flac)));
        assert!(matches!(audio_sniff_kind("aac"), Some(SniffKind::Aac)));
        assert!(matches!(audio_sniff_kind("opus"), Some(SniffKind::Opus)));
        assert!(matches!(audio_sniff_kind("webm"), Some(SniffKind::Webm)));
        assert!(audio_sniff_kind("txt").is_none());
    }

    #[test]
    fn sniff_file_reads_header_and_validates() {
        let path = std::env::temp_dir().join(format!(
            "yui_sniff_file_{}.bin",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"glTF\x02\x00\x00\x00rest of file ignored").unwrap();
        assert!(sniff_file(&path, SniffKind::Glb).unwrap());
        assert!(!sniff_file(&path, SniffKind::Wav).unwrap());
        let _ = std::fs::remove_file(&path);
    }
}
