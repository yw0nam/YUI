//! Shared import filesystem helpers — sanitize, hash, derive stem, collision check.

use std::path::{Component, Path, PathBuf};

/// Sanitize a filename stem into a safe id charset (`[A-Za-z0-9_-]`).
/// Every other char — including `.`, `/`, `\`, NUL, unicode — becomes `_`, so the
/// result can never be `.`, `..`, or contain a path separator. Collapses to `avatar`
/// when nothing usable remains.
pub(crate) fn sanitize_stem(stem: &str) -> String {
    let out: String = stem
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.chars().all(|c| c == '_') {
        return "avatar".to_string();
    }
    out
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

    /// A safe stem can never be a separator, `.`, or `..`.
    fn is_safe_stem(s: &str) -> bool {
        !s.is_empty()
            && s != "."
            && s != ".."
            && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    }

    // ── sanitize_stem ────────────────────────────────────────────────────────

    #[test]
    fn sanitize_keeps_only_alnum_underscore_dash() {
        assert_eq!(sanitize_stem("My_Avatar-1"), "My_Avatar-1");
    }

    #[test]
    fn sanitize_replaces_dot_with_underscore() {
        assert_eq!(sanitize_stem("My_Avatar-1.0"), "My_Avatar-1_0");
    }

    #[test]
    fn sanitize_replaces_spaces_and_specials_with_underscore() {
        assert_eq!(sanitize_stem("my avatar (v2)"), "my_avatar__v2_");
    }

    #[test]
    fn sanitize_collapses_to_avatar_when_empty() {
        assert_eq!(sanitize_stem(""), "avatar");
        assert_eq!(sanitize_stem("   "), "avatar");
        assert_eq!(sanitize_stem("///"), "avatar");
    }

    #[test]
    fn sanitize_neutralizes_traversal_inputs() {
        for input in ["..", ".", "../x", "a/b", "a\\b", "\0", "....", "../../etc"] {
            let out = sanitize_stem(input);
            assert!(is_safe_stem(&out), "{input:?} -> {out:?} is not a safe stem");
        }
    }

    #[test]
    fn sanitize_dotdot_is_never_dotdot() {
        assert_ne!(sanitize_stem(".."), "..");
        assert_eq!(sanitize_stem(".."), "avatar");
        assert_eq!(sanitize_stem("."), "avatar");
    }

    #[test]
    fn sanitize_handles_unicode_by_dropping_to_safe() {
        let out = sanitize_stem("ナツメ");
        assert!(is_safe_stem(&out));
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
        assert_eq!(stem, "My_Avatar");
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
}
