//! Bring-your-own-VRM import (native half).
//!
//! Copies a user-picked `.vrm` from an arbitrary path into `<app_data_dir>/vrms/`
//! via a native command — sidestepping fs-plugin scope on the arbitrary source.

use std::path::Path;

/// Sanitize a filename stem into an AvatarOption id (`[A-Za-z0-9._-]`).
fn sanitize_stem(_stem: &str) -> String {
    String::new() // STUB — replaced in feat:
}

/// Derive the dest filename stem from a source path, disambiguating on collision.
fn derive_dest_stem(_src: &Path, _exists_different: impl Fn(&str) -> bool) -> String {
    String::new() // STUB — replaced in feat:
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // ── sanitize_stem ────────────────────────────────────────────────────────

    #[test]
    fn sanitize_keeps_safe_chars() {
        assert_eq!(sanitize_stem("My_Avatar-1.0"), "My_Avatar-1.0");
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
    fn sanitize_handles_unicode_by_dropping_to_safe() {
        // Non-ascii collapses to underscores; never empty.
        let out = sanitize_stem("ナツメ");
        assert!(!out.is_empty());
        assert!(out.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)));
    }

    // ── derive_dest_stem ─────────────────────────────────────────────────────

    #[test]
    fn derive_uses_sanitized_stem_when_no_collision() {
        let src = PathBuf::from("/Users/me/Downloads/My Avatar.vrm");
        let stem = derive_dest_stem(&src, |_| false);
        assert_eq!(stem, "My_Avatar");
    }

    #[test]
    fn derive_disambiguates_on_collision_with_different_file() {
        let src = PathBuf::from("/a/b/Cat.vrm");
        // "Cat" already taken by a *different* file → must not equal bare "Cat".
        let stem = derive_dest_stem(&src, |candidate| candidate == "Cat");
        assert_ne!(stem, "Cat");
        assert!(stem.starts_with("Cat"));
        assert!(stem.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)));
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
}
