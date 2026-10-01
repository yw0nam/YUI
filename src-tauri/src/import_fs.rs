//! Shared import filesystem helpers — sanitize, hash, dest stem candidates, bounded streamed
//! copy, and container-signature sniffing.

use std::io::{Read, Write};
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
    Png,
    Jpeg,
    Webp,
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

/// Map an image extension (any case) to its stored extension and sniff kind.
pub(crate) fn image_ext(ext: &str) -> Option<(&'static str, SniffKind)> {
    match ext.to_ascii_lowercase().as_str() {
        "png" => Some(("png", SniffKind::Png)),
        "jpg" | "jpeg" => Some(("jpg", SniffKind::Jpeg)),
        "webp" => Some(("webp", SniffKind::Webp)),
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
        SniffKind::Png => header.starts_with(b"\x89PNG\r\n\x1a\n"),
        SniffKind::Jpeg => header.starts_with(&[0xFF, 0xD8, 0xFF]),
        SniffKind::Webp => {
            header.len() >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WEBP"
        }
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
/// Includes COM0/LPT0 alongside COM1-9/LPT1-9 per current Microsoft file-naming docs.
/// Keep this list in lockstep with src/io/assets/safe-id.ts's RESERVED_STEM_NAMES.
const RESERVED_STEM_NAMES: [&str; 24] = [
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn is_reserved_stem_name(s: &str) -> bool {
    let base = s.split('.').next().unwrap_or(s);
    RESERVED_STEM_NAMES
        .iter()
        .any(|r| r.eq_ignore_ascii_case(base))
}

/// Filesystem path-component byte cap. Generous for a single stem while guaranteeing a
/// multi-byte (UTF-8) name cannot blow past typical filesystem limits (~255 bytes).
pub(crate) const MAX_STEM_BYTES: usize = 150;

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

/// Candidate dest stems in claim order: the sanitized name, the name with a hash of the source
/// identity, then a numeric walk. Reserved ids are skipped; the caller claims a stem by creating
/// its file and moves to the next candidate when it already exists.
pub(crate) fn dest_stem_candidates<'a>(
    name_stem: &str,
    identity: &str,
    reserved: &'a [String],
) -> impl Iterator<Item = String> + 'a {
    let base = sanitize_stem(name_stem);
    let hashed = format!("{base}-{}", short_hash(identity));
    let numbered = {
        let base = base.clone();
        (2..).map(move |n| format!("{base}-{n}"))
    };
    [base, hashed]
        .into_iter()
        .chain(numbered)
        .filter(move |c| !reserved.contains(c))
}

/// Where and how `claim_and_copy` stores one imported file.
pub(crate) struct ClaimTarget<'a> {
    pub dir: &'a Path,
    pub name_stem: &'a str,
    pub identity: &'a str,
    pub ext: &'a str,
    pub kind: SniffKind,
    pub cap: u64,
    pub reserved: &'a [String],
}

/// Copy `reader` into `target.dir` under the first free candidate stem.
pub(crate) fn claim_and_copy(
    mut reader: impl Read,
    target: &ClaimTarget,
) -> Result<(String, PathBuf), String> {
    std::fs::create_dir_all(target.dir).map_err(|e| {
        log::error!("create_dir_failed dest={} error={e}", target.dir.display());
        "storage unavailable".to_string()
    })?;
    for stem in dest_stem_candidates(target.name_stem, target.identity, target.reserved) {
        let dest = target.dir.join(format!("{stem}.{}", target.ext));
        ensure_within(target.dir, &dest)?;
        // create_new claims the stem atomically, so concurrent imports never share a dest.
        let file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
        {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                log::error!("create_dest_failed dest={} error={e}", dest.display());
                return Err("import failed".to_string());
            }
        };
        if let Err(e) = copy_bounded(&mut reader, file, target.cap, target.kind) {
            let _ = std::fs::remove_file(&dest);
            return Err(e);
        }
        return Ok((stem, dest));
    }
    Err("import failed".to_string())
}

/// Stream `reader` into `writer`, reading at most `cap + 1` bytes. The first bytes are
/// checked for the signature of `kind` before anything is written; the stream is rejected when it carries
/// more than `cap` bytes. Errors are generic; the caller removes the partial destination.
pub(crate) fn copy_bounded(
    reader: impl Read,
    mut writer: impl Write,
    cap: u64,
    kind: SniffKind,
) -> Result<u64, String> {
    let mut reader = reader.take(cap.saturating_add(1));
    let mut header = [0u8; SNIFF_HEADER_LEN];
    let mut filled = 0;
    while filled < header.len() {
        match reader.read(&mut header[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => {
                log::warn!("copy_read_failed error={e}");
                return Err("source file not found".to_string());
            }
        }
    }
    if !sniff_ok(&header[..filled], kind) {
        return Err("unrecognized file type".to_string());
    }
    let fail = |e: std::io::Error| {
        log::error!("copy_failed error={e}");
        "import failed".to_string()
    };
    writer.write_all(&header[..filled]).map_err(fail)?;
    let rest = std::io::copy(&mut reader, &mut writer).map_err(fail)?;
    let total = filled as u64 + rest;
    if total > cap {
        return Err("source file too large".to_string());
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // Shared with src/io/assets/safe-id.test.ts's sanitizeStem reimplementation — a single source of
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

    // ── dest_stem_candidates ─────────────────────────────────────────────────

    fn first_n(name: &str, identity: &str, reserved: &[String], n: usize) -> Vec<String> {
        dest_stem_candidates(name, identity, reserved)
            .take(n)
            .collect()
    }

    #[test]
    fn candidates_start_with_the_sanitized_name_stem() {
        // Interior spaces are kept by the relaxed sanitize_stem — only traversal/illegal chars are neutralized.
        assert_eq!(first_n("My Avatar", "/x/y", &[], 1), ["My Avatar"]);
    }

    #[test]
    fn candidates_follow_base_then_hash_then_numeric_walk() {
        let c = first_n("Cat", "/a/b/Cat.vrm", &[], 4);
        assert_eq!(c[0], "Cat");
        assert_eq!(c[1], format!("Cat-{}", short_hash("/a/b/Cat.vrm")));
        assert_eq!(c[2], "Cat-2");
        assert_eq!(c[3], "Cat-3");
        assert!(c.iter().all(|s| is_safe_stem(s)));
    }

    #[test]
    fn candidates_skip_reserved_ids() {
        let reserved = vec!["Cat".to_string(), "Cat-2".to_string()];
        let c = first_n("Cat", "/a/b/Cat.vrm", &reserved, 2);
        assert!(!c.contains(&"Cat".to_string()));
        assert!(!c.contains(&"Cat-2".to_string()));
        assert_eq!(c[0], format!("Cat-{}", short_hash("/a/b/Cat.vrm")));
        assert_eq!(c[1], "Cat-3");
    }

    #[test]
    fn candidates_use_the_identity_for_disambiguation_only() {
        let a = first_n("Cat", "content://x/1", &[], 2);
        let b = first_n("Cat", "content://x/2", &[], 2);
        assert_eq!(a[0], b[0]);
        assert_ne!(a[1], b[1]);
    }

    // ── copy_bounded ─────────────────────────────────────────────────────────

    /// A reader that yields one byte per call.
    struct OneByte<'a>(&'a [u8]);

    impl Read for OneByte<'_> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            match self.0.split_first() {
                Some((b, rest)) if !buf.is_empty() => {
                    buf[0] = *b;
                    self.0 = rest;
                    Ok(1)
                }
                _ => Ok(0),
            }
        }
    }

    struct FailingWriter;

    impl std::io::Write for FailingWriter {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("disk full"))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    const GLB: &[u8] = b"glTF\x02\x00\x00\x00binary chunk of the model";

    #[test]
    fn copy_bounded_copies_a_glb_stream_under_the_cap() {
        let mut out = Vec::new();
        let n = copy_bounded(GLB, &mut out, 1024, SniffKind::Glb).unwrap();
        assert_eq!(n, GLB.len() as u64);
        assert_eq!(out, GLB);
    }

    #[test]
    fn copy_bounded_accepts_exactly_the_cap_and_rejects_one_over() {
        let mut out = Vec::new();
        assert!(copy_bounded(GLB, &mut out, GLB.len() as u64, SniffKind::Glb).is_ok());
        let mut out = Vec::new();
        assert!(copy_bounded(GLB, &mut out, GLB.len() as u64 - 1, SniffKind::Glb).is_err());
    }

    #[test]
    fn copy_bounded_stops_reading_past_the_cap() {
        let mut data = GLB.to_vec();
        data.extend(std::iter::repeat_n(0u8, 10_000));
        let mut out = Vec::new();
        assert!(copy_bounded(&data[..], &mut out, 64, SniffKind::Glb).is_err());
        assert!(out.len() <= 65, "wrote {} bytes past the cap", out.len());
    }

    #[test]
    fn copy_bounded_rejects_bad_magic_without_writing() {
        let mut out = Vec::new();
        assert!(copy_bounded(
            &b"%PDF-1.4 not a vrm at all"[..],
            &mut out,
            1024,
            SniffKind::Glb
        )
        .is_err());
        assert!(out.is_empty());
    }

    #[test]
    fn copy_bounded_rejects_a_stream_shorter_than_the_magic() {
        let mut out = Vec::new();
        assert!(copy_bounded(&b"gl"[..], &mut out, 1024, SniffKind::Glb).is_err());
    }

    #[test]
    fn copy_bounded_handles_one_byte_reads() {
        let mut out = Vec::new();
        let n = copy_bounded(OneByte(GLB), &mut out, 1024, SniffKind::Glb).unwrap();
        assert_eq!(n, GLB.len() as u64);
        assert_eq!(out, GLB);
    }

    #[test]
    fn copy_bounded_surfaces_a_write_error() {
        assert!(copy_bounded(GLB, FailingWriter, 1024, SniffKind::Glb).is_err());
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

    // ── image sniffs and claim_and_copy ─────────────────────────────────────

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRpixels";
    const JPEG: &[u8] = b"\xFF\xD8\xFF\xE0\x00\x10JFIFpixels";
    const WEBP: &[u8] = b"RIFF\x24\x00\x00\x00WEBPVP8 pixels";

    #[test]
    fn sniff_png_jpeg_and_webp_accept_their_signatures() {
        assert!(sniff_ok(PNG, SniffKind::Png));
        assert!(sniff_ok(JPEG, SniffKind::Jpeg));
        assert!(sniff_ok(WEBP, SniffKind::Webp));
    }

    #[test]
    fn sniff_images_reject_each_others_signatures() {
        assert!(!sniff_ok(JPEG, SniffKind::Png));
        assert!(!sniff_ok(PNG, SniffKind::Jpeg));
        assert!(!sniff_ok(b"RIFF\x24\x00\x00\x00WAVEfmt ", SniffKind::Webp));
        assert!(!sniff_ok(b"RIFF\x24\x00", SniffKind::Webp));
    }

    #[test]
    fn image_ext_lowercases_and_stores_jpeg_as_jpg() {
        assert_eq!(image_ext("PNG"), Some(("png", SniffKind::Png)));
        assert_eq!(image_ext("jpeg"), Some(("jpg", SniffKind::Jpeg)));
        assert_eq!(image_ext("JPG"), Some(("jpg", SniffKind::Jpeg)));
        assert_eq!(image_ext("webp"), Some(("webp", SniffKind::Webp)));
        assert_eq!(image_ext("gif"), None);
    }

    #[test]
    fn copy_bounded_checks_the_given_kind() {
        let mut out = Vec::new();
        assert_eq!(
            copy_bounded(PNG, &mut out, 1024, SniffKind::Png).unwrap(),
            PNG.len() as u64
        );
        let mut out = Vec::new();
        assert!(copy_bounded(PNG, &mut out, 1024, SniffKind::Jpeg).is_err());
        assert!(out.is_empty());
    }

    #[test]
    fn copy_bounded_errors_name_no_format() {
        let err = copy_bounded(&b"zzzz"[..], Vec::new(), 1024, SniffKind::Png).unwrap_err();
        assert!(!err.contains("vrm"), "{err}");
    }

    fn claim_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("yui_claim_{tag}_{nanos}"))
            .join("out")
    }

    fn claim(dir: &Path, stem: &str, bytes: &[u8], cap: u64) -> Result<(String, PathBuf), String> {
        claim_and_copy(
            bytes,
            &ClaimTarget {
                dir,
                name_stem: stem,
                identity: "content://x/1",
                ext: "png",
                kind: SniffKind::Png,
                cap,
                reserved: &[],
            },
        )
    }

    #[test]
    fn claim_and_copy_creates_the_dir_and_appends_the_extension() {
        let dir = claim_dir("ok");
        let (stem, path) = claim(&dir, "beach", PNG, 1024).unwrap();
        assert_eq!(stem, "beach");
        assert_eq!(path, dir.join("beach.png"));
        assert_eq!(std::fs::read(&path).unwrap(), PNG);
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn claim_and_copy_moves_to_the_next_stem_when_taken() {
        let dir = claim_dir("taken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("beach.png"), b"old").unwrap();
        let (stem, path) = claim(&dir, "beach", PNG, 1024).unwrap();
        assert_ne!(stem, "beach");
        assert_eq!(std::fs::read(dir.join("beach.png")).unwrap(), b"old");
        assert_eq!(std::fs::read(path).unwrap(), PNG);
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }

    #[test]
    fn claim_and_copy_leaves_no_file_on_a_bad_signature_or_oversize() {
        let dir = claim_dir("bad");
        assert!(claim(&dir, "a", b"not an image at all", 1024).is_err());
        assert!(claim(&dir, "b", PNG, 4).is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
    }
}
