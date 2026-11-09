//! Preset file (`.yui`): a zip holding a card, thumbnail, VRM and voice clip, read on import and
//! written on export, plus the PNG card export.

mod manifest;
mod png_card;
mod vrm_license;

use crate::card_import::ImportedCardFile;
use serde::{Deserialize, Serialize};
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use vrm_license::VrmLicense;

/// The app-data folders a preset file reads from and claims into.
pub(crate) struct PresetDirs {
    pub cards: PathBuf,
    pub vrms: PathBuf,
    pub references: PathBuf,
}

/// The VRM a preset file carried: copied into `vrms/`, or named by id for a bundled one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PresetFileVrm {
    User { id: String, dest_path: String },
    Bundled { id: String },
}

/// The voice clip a preset file carried, staged under `references/<id>/`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetFileVoice {
    pub id: String,
    pub ref_path: String,
    pub label: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum PresetFileVrmRef {
    User { id: String },
    Bundled { id: String },
}

#[derive(Debug, Deserialize)]
pub(crate) struct PresetFileVoiceRef {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetFileExportRequest {
    pub default_name: String,
    pub card_json: String,
    pub thumbnail_preset_id: Option<String>,
    pub crop: Option<serde_json::Value>,
    pub vrm: Option<PresetFileVrmRef>,
    pub voice: Option<PresetFileVoiceRef>,
}

#[derive(Debug, Serialize)]
pub(crate) struct VrmInspection {
    pub license: VrmLicense,
    pub bytes: u64,
}

/// Read a preset file: validate its manifest, and claim the thumbnail, VRM and voice into `dirs`.
/// A failure after a claim removes what this call claimed.
pub(crate) fn read_preset_file(
    _source: impl Read + Seek,
    _name_stem: &str,
    _identity: &str,
    _dirs: &PresetDirs,
    _reserved_vrm_ids: &[String],
    _voice_staging_id: &str,
) -> Result<ImportedCardFile, String> {
    Err("not implemented".to_string())
}

/// Write the preset `request` describes into `out`, resolving its files under `dirs`. Returns
/// whether the VRM is represented (a bundled id, or a file whose license is not prohibited).
pub(crate) fn write_preset_file(
    _dirs: &PresetDirs,
    _request: &PresetFileExportRequest,
    _out: impl Write + Seek,
) -> Result<bool, String> {
    Err("not implemented".to_string())
}

/// The license and size of `vrms/<sanitized id>.vrm`.
fn inspect_vrm_at(_vrms: &Path, _id: &str) -> Result<VrmInspection, String> {
    Err("not implemented".to_string())
}

/// `cards/<sanitized preset id>.png` with `card_json` written into it.
fn card_png_bytes(_cards: &Path, _preset_id: &str, _card_json: &str) -> Result<Vec<u8>, String> {
    Err("not implemented".to_string())
}

#[cfg(test)]
mod tests {
    use super::manifest::{Manifest, ManifestVrm};
    use super::*;
    use crate::card_import::CardSource;
    use serde_json::json;
    use std::io::Cursor;
    use zip::write::SimpleFileOptions;

    const CARD: &str = r#"{"spec":"chara_card_v2"}"#;
    const WAV: &[u8] = b"RIFF\x24\x08\x00\x00WAVEfmt ";
    const ALLOWED: &str = r#"{"extensions":{"VRMC_vrm":{"meta":{"allowRedistribution":true}}}}"#;
    const PROHIBITED: &str =
        r#"{"extensions":{"VRM":{"meta":{"licenseName":"Redistribution_Prohibited"}}}}"#;

    fn dirs(tag: &str) -> PresetDirs {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("yui_preset_test_{tag}_{nanos}"));
        PresetDirs {
            cards: root.join("cards"),
            vrms: root.join("vrms"),
            references: root.join("references"),
        }
    }

    fn png() -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    fn write_file(path: PathBuf, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    /// App data holding preset `pid`'s thumbnail, the VRM `Mio` and the voice `v1`'s clip.
    fn seeded(tag: &str, vrm_json: &str) -> PresetDirs {
        let d = dirs(tag);
        write_file(d.cards.join("pid.png"), &png());
        write_file(
            d.vrms.join("Mio.vrm"),
            &vrm_license::glb_with_json(vrm_json),
        );
        write_file(d.references.join("v1").join("clip.wav"), WAV);
        d
    }

    fn request() -> PresetFileExportRequest {
        PresetFileExportRequest {
            default_name: "Mio".into(),
            card_json: CARD.into(),
            thumbnail_preset_id: None,
            crop: None,
            vrm: None,
            voice: None,
        }
    }

    fn full_request() -> PresetFileExportRequest {
        PresetFileExportRequest {
            thumbnail_preset_id: Some("pid".into()),
            crop: Some(json!({"x": 0.1, "y": 0.2, "zoom": 1.5})),
            vrm: Some(PresetFileVrmRef::User { id: "Mio".into() }),
            voice: Some(PresetFileVoiceRef {
                id: "v1".into(),
                label: "Mio voice".into(),
            }),
            ..request()
        }
    }

    fn write(d: &PresetDirs, req: &PresetFileExportRequest) -> (Result<bool, String>, Vec<u8>) {
        let mut out = Cursor::new(Vec::new());
        let result = write_preset_file(d, req, &mut out);
        (result, out.into_inner())
    }

    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    fn entry_names(zip: &[u8]) -> Vec<String> {
        let archive = zip::ZipArchive::new(Cursor::new(zip)).unwrap();
        let mut names: Vec<String> = archive
            .file_names()
            .map(|n| n.unwrap().into_owned())
            .collect();
        names.sort();
        names
    }

    fn manifest_of(zip: &[u8]) -> Manifest {
        let mut archive = zip::ZipArchive::new(Cursor::new(zip)).unwrap();
        serde_json::from_reader(archive.by_name("manifest.json").unwrap()).unwrap()
    }

    fn read(d: &PresetDirs, zip: Vec<u8>) -> Result<ImportedCardFile, String> {
        read_preset_file(
            Cursor::new(zip),
            "mio-preset",
            "file:///mio.yui",
            d,
            &[],
            "stage1",
        )
    }

    fn files_under(dir: &Path) -> usize {
        std::fs::read_dir(dir).map_or(0, |entries| {
            entries
                .flatten()
                .map(|e| {
                    if e.path().is_dir() {
                        files_under(&e.path())
                    } else {
                        1
                    }
                })
                .sum()
        })
    }

    #[test]
    fn a_preset_file_round_trips_its_card_thumbnail_vrm_voice_and_crop() {
        let src = seeded("rt_src", ALLOWED);
        let (written, zip) = write(&src, &full_request());
        assert_eq!(written, Ok(true));
        assert_eq!(
            entry_names(&zip),
            [
                "card.json",
                "manifest.json",
                "thumbnail.png",
                "voice/clip.wav",
                "vrm/model.vrm"
            ]
        );

        let dst = dirs("rt_dst");
        let got = read(&dst, zip);

        assert!(got.is_ok(), "read failed: {got:?}");
        let got = got.unwrap();
        assert_eq!(got.source, CardSource::Yui);
        assert_eq!(got.json, CARD);
        assert_eq!(got.crop, Some(json!({"x": 0.1, "y": 0.2, "zoom": 1.5})));
        assert_eq!(got.thumbnail_temp_id.as_deref(), Some("mio-preset"));
        assert_eq!(
            std::fs::read(dst.cards.join("mio-preset.png")).unwrap(),
            png()
        );
        assert_eq!(
            got.vrm,
            Some(PresetFileVrm::User {
                id: "mio-preset".into(),
                dest_path: dst
                    .vrms
                    .join("mio-preset.vrm")
                    .to_string_lossy()
                    .into_owned(),
            })
        );
        assert_eq!(
            std::fs::read(dst.vrms.join("mio-preset.vrm")).unwrap(),
            vrm_license::glb_with_json(ALLOWED)
        );
        assert_eq!(
            got.voice,
            Some(PresetFileVoice {
                id: "stage1".into(),
                ref_path: dst
                    .references
                    .join("stage1")
                    .join("clip.wav")
                    .to_string_lossy()
                    .into_owned(),
                label: "Mio voice".into(),
            })
        );
        assert_eq!(
            std::fs::read(dst.references.join("stage1").join("clip.wav")).unwrap(),
            WAV
        );
    }

    #[test]
    fn a_card_only_preset_file_reads_as_yui_with_no_assets() {
        let (written, zip) = write(&dirs("card_only_src"), &request());
        assert_eq!(written, Ok(false));
        let dst = dirs("card_only_dst");

        let got = read(&dst, zip);

        assert!(got.is_ok(), "read failed: {got:?}");
        let got = got.unwrap();
        assert_eq!(got.source, CardSource::Yui);
        assert_eq!(got.json, CARD);
        assert_eq!(got.thumbnail_temp_id, None);
        assert_eq!(got.crop, None);
        assert_eq!(got.vrm, None);
        assert_eq!(got.voice, None);
        assert_eq!(
            files_under(&dst.cards) + files_under(&dst.vrms) + files_under(&dst.references),
            0
        );
    }

    #[test]
    fn a_prohibited_vrm_is_left_out_and_the_rest_exports() {
        let src = seeded("prohibited", PROHIBITED);

        let (written, zip) = write(&src, &full_request());

        assert_eq!(written, Ok(false));
        assert_eq!(
            entry_names(&zip),
            [
                "card.json",
                "manifest.json",
                "thumbnail.png",
                "voice/clip.wav"
            ]
        );
        assert!(manifest_of(&zip).vrm.is_none());
    }

    #[test]
    fn a_bundled_vrm_is_named_by_id_with_no_file() {
        let src = seeded("bundled_src", ALLOWED);
        let req = PresetFileExportRequest {
            vrm: Some(PresetFileVrmRef::Bundled {
                id: "default".into(),
            }),
            ..request()
        };

        let (written, zip) = write(&src, &req);

        assert_eq!(written, Ok(true));
        assert_eq!(entry_names(&zip), ["card.json", "manifest.json"]);
        assert!(matches!(
            manifest_of(&zip).vrm,
            Some(ManifestVrm::Bundled { bundled }) if bundled == "default"
        ));
        let got = read(&dirs("bundled_dst"), zip);
        assert_eq!(
            got.map(|c| c.vrm),
            Ok(Some(PresetFileVrm::Bundled {
                id: "default".into()
            }))
        );
    }

    #[test]
    fn a_manifest_this_client_does_not_read_is_refused() {
        let cases = [
            ("format", r#"{"format":"other","version":1}"#),
            ("version", r#"{"format":"yui-preset","version":2}"#),
            (
                "vrm path",
                r#"{"format":"yui-preset","version":1,"vrm":{"file":"../evil.vrm"}}"#,
            ),
            (
                "voice ext",
                r#"{"format":"yui-preset","version":1,"voice":{"file":"voice/clip.exe","label":"x"}}"#,
            ),
        ];
        for (label, manifest) in cases {
            let d = dirs("refused");
            let zip = zip_of(&[("manifest.json", manifest.as_bytes()), ("card.json", b"{}")]);
            assert_eq!(
                read(&d, zip).map(|_| ()),
                Err("bundle unreadable".to_string()),
                "{label}"
            );
        }
    }

    #[test]
    fn an_over_cap_entry_is_refused() {
        let zip = zip_of(&[
            ("manifest.json", &vec![b' '; 64 * 1024 + 1]),
            ("card.json", b"{}"),
        ]);

        let got = read(&dirs("over_cap"), zip);

        assert_eq!(got.map(|_| ()), Err("source file too large".to_string()));
    }

    #[test]
    fn a_voice_that_fails_after_the_vrm_was_claimed_leaves_no_file_behind() {
        let manifest = r#"{"format":"yui-preset","version":1,"vrm":{"file":"vrm/model.vrm"},"voice":{"file":"voice/clip.wav","label":"x"}}"#;
        let zip = zip_of(&[
            ("manifest.json", manifest.as_bytes()),
            ("card.json", b"{}"),
            ("thumbnail.png", &png()),
            ("vrm/model.vrm", &vrm_license::glb_with_json(ALLOWED)),
            ("voice/clip.wav", b"not a wav"),
        ]);
        let dst = dirs("rollback");

        let got = read(&dst, zip);

        assert_eq!(got.map(|_| ()), Err("unrecognized file type".to_string()));
        assert_eq!(
            files_under(&dst.cards) + files_under(&dst.vrms) + files_under(&dst.references),
            0
        );
    }

    #[test]
    fn inspecting_a_vrm_reports_its_license_and_size() {
        let src = seeded("inspect", PROHIBITED);

        let got = inspect_vrm_at(&src.vrms, "Mio").map(|i| (i.license, i.bytes));

        let size = vrm_license::glb_with_json(PROHIBITED).len() as u64;
        assert_eq!(got, Ok((VrmLicense::Prohibited, size)));
    }

    #[test]
    fn a_card_png_needs_the_presets_picture() {
        let d = seeded("png", ALLOWED);

        assert_eq!(
            card_png_bytes(&d.cards, "nobody", CARD),
            Err("no picture".to_string())
        );
        let out = card_png_bytes(&d.cards, "pid", CARD).unwrap();
        assert_eq!(
            crate::card_import::card_json_from_png(&out),
            Ok(CARD.to_string())
        );
    }
}
