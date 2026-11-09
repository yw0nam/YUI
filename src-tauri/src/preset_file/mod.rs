//! Preset file (`.yui`): a zip holding a card, thumbnail, VRM and voice clip, read on import and
//! written on export, plus the PNG card export.

mod manifest;
mod png_card;
mod vrm_license;

use crate::card_import::{
    cards_dir, claim_thumbnail, read_bounded, remove_thumbnail_at, CardSource, ImportedCardFile,
    MAX_JSON_BYTES, MAX_PNG_BYTES,
};
use crate::import_fs::{
    app_data_subdir, claim_and_copy, ensure_within, sanitize_stem, ClaimTarget, SniffKind,
};
use crate::voice_import::{copy_reader_into_references, remove_user_voice_at, AUDIO_EXTS};
use crate::vrm_import::{remove_user_vrm_at, vrms_dir, MAX_VRM_BYTES};
use manifest::{
    voice_ext, Manifest, ManifestVoice, ManifestVrm, FORMAT, UNREADABLE, VERSION, VRM_ENTRY,
};
use serde::{Deserialize, Serialize};
use std::io::{BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle};
use tauri_plugin_dialog::DialogExt;
use vrm_license::{read_license, VrmLicense};
use zip::result::ZipError;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

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

impl PresetDirs {
    pub(crate) fn of(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            cards: cards_dir(app)?,
            vrms: vrms_dir(app)?,
            references: app_data_subdir(app, "references")?,
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PresetFileExportResult {
    pub saved: bool,
    pub vrm_included: bool,
    pub bytes: u64,
}

/// The files one `read_preset_file` call claimed, removed when a later step fails.
#[derive(Default)]
struct Claimed {
    thumbnail: Option<String>,
    vrm: Option<String>,
    voice: Option<String>,
}

fn unreadable() -> String {
    UNREADABLE.to_string()
}

/// The bytes of zip entry `name`, `None` when the archive has no such entry; `cap` bounds it.
fn entry(
    zip: &mut ZipArchive<impl Read + Seek>,
    name: &str,
    cap: u64,
) -> Result<Option<Vec<u8>>, String> {
    match zip.by_name(name) {
        Ok(file) => read_bounded(file, cap).map(Some),
        Err(ZipError::FileNotFound) => Ok(None),
        Err(e) => {
            log::warn!("preset_file_entry_failed name={name} error={e}");
            Err(unreadable())
        }
    }
}

/// Read a preset file: validate its manifest, and claim the thumbnail, VRM and voice into `dirs`.
/// A failure after a claim removes what this call claimed.
pub(crate) fn read_preset_file(
    source: impl Read + Seek,
    name_stem: &str,
    identity: &str,
    dirs: &PresetDirs,
    reserved_vrm_ids: &[String],
    voice_staging_id: &str,
) -> Result<ImportedCardFile, String> {
    let mut zip = ZipArchive::new(source).map_err(|e| {
        log::warn!("preset_file_open_failed error={e}");
        unreadable()
    })?;
    let manifest_bytes =
        entry(&mut zip, "manifest.json", MAX_MANIFEST_BYTES)?.ok_or_else(unreadable)?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes).map_err(|_| unreadable())?;
    manifest.validate()?;
    let json = entry(&mut zip, "card.json", MAX_JSON_BYTES)?.ok_or_else(unreadable)?;
    let json = String::from_utf8(json).map_err(|_| "card unreadable".to_string())?;

    let mut claimed = Claimed::default();
    let ctx = ClaimCtx {
        name_stem,
        identity,
        dirs,
        reserved_vrm_ids,
        voice_staging_id,
    };
    let assets = claim_assets(&mut zip, &manifest, &ctx, &mut claimed);
    match assets {
        Ok(Assets {
            thumbnail_temp_id,
            vrm,
            voice,
        }) => Ok(ImportedCardFile {
            source: CardSource::Yui,
            json,
            thumbnail_temp_id,
            crop: manifest.crop,
            vrm,
            voice,
        }),
        Err(e) => {
            if let Some(id) = &claimed.thumbnail {
                let _ = remove_thumbnail_at(&dirs.cards, id);
            }
            if let Some(id) = &claimed.vrm {
                let _ = remove_user_vrm_at(&dirs.vrms, id);
            }
            if let Some(id) = &claimed.voice {
                let _ = remove_user_voice_at(&dirs.references, id);
            }
            Err(e)
        }
    }
}

/// The files `claim_assets` claimed out of a preset file.
struct Assets {
    thumbnail_temp_id: Option<String>,
    vrm: Option<PresetFileVrm>,
    voice: Option<PresetFileVoice>,
}

/// What `claim_assets` needs to name and place the files it claims.
struct ClaimCtx<'a> {
    name_stem: &'a str,
    identity: &'a str,
    dirs: &'a PresetDirs,
    reserved_vrm_ids: &'a [String],
    voice_staging_id: &'a str,
}

/// Claim the thumbnail, VRM and voice entries, recording each claim in `claimed`.
fn claim_assets(
    zip: &mut ZipArchive<impl Read + Seek>,
    manifest: &Manifest,
    ctx: &ClaimCtx,
    claimed: &mut Claimed,
) -> Result<Assets, String> {
    let ClaimCtx {
        name_stem,
        identity,
        dirs,
        reserved_vrm_ids,
        voice_staging_id,
    } = *ctx;
    let thumbnail_temp_id = match entry(zip, "thumbnail.png", MAX_PNG_BYTES)? {
        Some(png) => {
            let id = claim_thumbnail(&dirs.cards, name_stem, identity, &png)?;
            claimed.thumbnail = Some(id.clone());
            Some(id)
        }
        None => None,
    };
    let vrm = match &manifest.vrm {
        None => None,
        Some(ManifestVrm::Bundled { bundled }) => Some(PresetFileVrm::Bundled {
            id: bundled.clone(),
        }),
        Some(ManifestVrm::File { .. }) => {
            let file = zip.by_name(VRM_ENTRY).map_err(|_| unreadable())?;
            let (id, dest) = claim_and_copy(
                file,
                &ClaimTarget {
                    dir: &dirs.vrms,
                    name_stem,
                    identity,
                    ext: "vrm",
                    kind: SniffKind::Glb,
                    cap: MAX_VRM_BYTES,
                    reserved: reserved_vrm_ids,
                },
            )?;
            claimed.vrm = Some(id.clone());
            Some(PresetFileVrm::User {
                id,
                dest_path: dest.to_string_lossy().into_owned(),
            })
        }
    };
    let voice = match &manifest.voice {
        None => None,
        Some(ManifestVoice { file, label }) => {
            let ext = voice_ext(file).ok_or_else(unreadable)?;
            let clip = zip.by_name(file).map_err(|_| unreadable())?;
            let staged =
                copy_reader_into_references(&dirs.references, clip, ext, voice_staging_id)?;
            claimed.voice = Some(staged.id.clone());
            Some(PresetFileVoice {
                id: staged.id,
                ref_path: staged.ref_path,
                label: label.clone(),
            })
        }
    };
    Ok(Assets {
        thumbnail_temp_id,
        vrm,
        voice,
    })
}

fn write_failed(e: impl std::fmt::Display) -> String {
    log::error!("preset_file_write_failed error={e}");
    "preset write failed".to_string()
}

fn read_failed(e: impl std::fmt::Display) -> String {
    log::error!("preset_file_read_failed error={e}");
    "preset read failed".to_string()
}

/// `dir/<file_name>` when it is an existing file.
fn existing_file(dir: &Path, file_name: &str) -> Result<Option<PathBuf>, String> {
    let path = dir.join(file_name);
    ensure_within(dir, &path)?;
    Ok(path.is_file().then_some(path))
}

/// Add the file at `path` to the zip as `name`.
fn add_file(zip: &mut ZipWriter<impl Write + Seek>, name: &str, path: &Path) -> Result<(), String> {
    zip.start_file(
        name,
        SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
    )
    .map_err(write_failed)?;
    let mut file = std::fs::File::open(path).map_err(read_failed)?;
    std::io::copy(&mut file, zip).map_err(write_failed)?;
    Ok(())
}

/// Write the preset `request` describes into `out`, resolving its files under `dirs`. Returns
/// whether the VRM is represented (a bundled id, or a file whose license is not prohibited).
pub(crate) fn write_preset_file(
    dirs: &PresetDirs,
    request: &PresetFileExportRequest,
    out: impl Write + Seek,
) -> Result<bool, String> {
    let mut zip = ZipWriter::new(out);
    let mut manifest = Manifest {
        format: FORMAT.to_string(),
        version: VERSION,
        crop: request.crop.clone(),
        vrm: None,
        voice: None,
    };
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("card.json", deflated)
        .map_err(write_failed)?;
    zip.write_all(request.card_json.as_bytes())
        .map_err(write_failed)?;

    if let Some(id) = &request.thumbnail_preset_id {
        if let Some(png) = existing_file(&dirs.cards, &format!("{}.png", sanitize_stem(id)))? {
            add_file(&mut zip, "thumbnail.png", &png)?;
        }
    }

    match &request.vrm {
        None => {}
        Some(PresetFileVrmRef::Bundled { id }) => {
            manifest.vrm = Some(ManifestVrm::Bundled {
                bundled: id.clone(),
            });
        }
        Some(PresetFileVrmRef::User { id }) => {
            if let Some(vrm) = existing_file(&dirs.vrms, &format!("{}.vrm", sanitize_stem(id)))? {
                let license = read_license(std::fs::File::open(&vrm).map_err(read_failed)?);
                if license != VrmLicense::Prohibited {
                    add_file(&mut zip, VRM_ENTRY, &vrm)?;
                    manifest.vrm = Some(ManifestVrm::File {
                        file: VRM_ENTRY.to_string(),
                    });
                }
            }
        }
    }

    if let Some(voice) = &request.voice {
        let dir = dirs.references.join(sanitize_stem(&voice.id));
        ensure_within(&dirs.references, &dir)?;
        let clip = AUDIO_EXTS.iter().find_map(|ext| {
            let path = dir.join(format!("clip.{ext}"));
            path.is_file().then_some((*ext, path))
        });
        if let Some((ext, path)) = clip {
            let file = format!("voice/clip.{ext}");
            add_file(&mut zip, &file, &path)?;
            manifest.voice = Some(ManifestVoice {
                file,
                label: voice.label.clone(),
            });
        }
    }

    zip.start_file("manifest.json", deflated)
        .map_err(write_failed)?;
    zip.write_all(&serde_json::to_vec(&manifest).map_err(write_failed)?)
        .map_err(write_failed)?;
    zip.finish().map_err(write_failed)?;
    Ok(manifest.vrm.is_some())
}

/// The license and size of `vrms/<sanitized id>.vrm`.
fn inspect_vrm_at(vrms: &Path, id: &str) -> Result<VrmInspection, String> {
    let path = existing_file(vrms, &format!("{}.vrm", sanitize_stem(id)))?
        .ok_or_else(|| "vrm not found".to_string())?;
    let file = std::fs::File::open(&path).map_err(read_failed)?;
    let bytes = file.metadata().map_err(read_failed)?.len();
    Ok(VrmInspection {
        license: read_license(file),
        bytes,
    })
}

/// `cards/<sanitized preset id>.png` with `card_json` written into it.
fn card_png_bytes(cards: &Path, preset_id: &str, card_json: &str) -> Result<Vec<u8>, String> {
    let png = existing_file(cards, &format!("{}.png", sanitize_stem(preset_id)))?
        .ok_or_else(|| "no picture".to_string())?;
    let bytes = read_bounded(
        std::fs::File::open(png).map_err(read_failed)?,
        MAX_PNG_BYTES,
    )?;
    png_card::with_card_chunk(&bytes, card_json)
}

/// Write the zip beside `dest` as `<dest>.partial`, then rename it onto `dest`.
fn write_to(
    dirs: &PresetDirs,
    request: &PresetFileExportRequest,
    dest: &Path,
) -> Result<PresetFileExportResult, String> {
    let mut partial = dest.as_os_str().to_owned();
    partial.push(".partial");
    let partial = PathBuf::from(partial);
    let written = (|| {
        let mut out = BufWriter::new(std::fs::File::create(&partial).map_err(write_failed)?);
        let vrm_included = write_preset_file(dirs, request, &mut out)?;
        out.flush().map_err(write_failed)?;
        let bytes = std::fs::metadata(&partial).map_err(write_failed)?.len();
        std::fs::rename(&partial, dest).map_err(write_failed)?;
        Ok(PresetFileExportResult {
            saved: true,
            vrm_included,
            bytes,
        })
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    written
}

/// Open the save dialog here and return the picked absolute path. `None` when the dialog is
/// dismissed.
fn pick_save_path(
    app: &AppHandle,
    default_name: &str,
    filter_name: &str,
    exts: &[&str],
) -> Result<Option<PathBuf>, String> {
    let Some(dest_path) = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(filter_name, exts)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let dest = dest_path.into_path().map_err(|e| {
        log::error!("save_dest_unavailable error={e}");
        "destination unavailable".to_string()
    })?;
    if !dest.is_absolute() {
        return Err("destination must be absolute".to_string());
    }
    Ok(Some(dest))
}

/// The license and size of the user VRM `id`, read before the user exports it.
#[command]
pub fn inspect_preset_vrm(app: AppHandle, id: String) -> Result<VrmInspection, String> {
    inspect_vrm_at(&vrms_dir(&app)?, &id)
}

/// Open the save dialog here and write the preset `request` describes as a `.yui` file, resolving
/// its files under app data. Dismissed: `saved: false`.
#[command]
pub async fn export_preset_file(
    app: AppHandle,
    request: PresetFileExportRequest,
) -> Result<PresetFileExportResult, String> {
    let Some(dest) = pick_save_path(&app, &request.default_name, "Preset", &["yui"])? else {
        return Ok(PresetFileExportResult {
            saved: false,
            vrm_included: false,
            bytes: 0,
        });
    };
    let dirs = PresetDirs::of(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_to(&dirs, &request, &dest))
        .await
        .map_err(write_failed)?
}

/// Open the save dialog here and write preset `preset_id`'s picture as a PNG card holding
/// `card_json`. `false` when the dialog is dismissed.
#[command]
pub async fn export_card_png(
    app: AppHandle,
    default_name: String,
    card_json: String,
    preset_id: String,
) -> Result<bool, String> {
    let png = card_png_bytes(&cards_dir(&app)?, &preset_id, &card_json)?;
    let Some(dest) = pick_save_path(&app, &default_name, "Card", &["png"])? else {
        return Ok(false);
    };
    std::fs::write(&dest, png).map_err(write_failed)?;
    Ok(true)
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
            // The VRM list names the file `Mio` "Yui Summer/Beach".
            vrm: Some(
                serde_json::from_value(
                    json!({"kind": "user", "id": "Mio", "label": "Yui Summer/Beach"}),
                )
                .unwrap(),
            ),
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

    fn manifest_json(zip: &[u8]) -> serde_json::Value {
        let mut archive = zip::ZipArchive::new(Cursor::new(zip)).unwrap();
        serde_json::from_reader(archive.by_name("manifest.json").unwrap()).unwrap()
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
            manifest_json(&zip)["vrm"],
            json!({"file": "vrm/model.vrm", "name": "Yui Summer/Beach"})
        );
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
        // The picked file is `mio.yui`; the claimed VRM follows the VRM's own name.
        assert_eq!(
            serde_json::to_value(&got.vrm).unwrap(),
            json!({
                "kind": "user",
                "id": "Yui Summer_Beach",
                "destPath": dst.vrms.join("Yui Summer_Beach.vrm").to_string_lossy(),
                "label": "Yui Summer/Beach",
            })
        );
        assert_eq!(
            std::fs::read(dst.vrms.join("Yui Summer_Beach.vrm")).unwrap(),
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
    fn a_vrm_with_no_name_in_the_manifest_takes_the_picked_files_stem() {
        let manifest = br#"{"format":"yui-preset","version":1,"vrm":{"file":"vrm/model.vrm"}}"#;
        let glb = vrm_license::glb_with_json(ALLOWED);
        let zip = zip_of(&[
            ("manifest.json", manifest),
            ("card.json", CARD.as_bytes()),
            ("vrm/model.vrm", &glb),
        ]);
        let dst = dirs("no_name_dst");
        let got = read(&dst, zip).unwrap();
        assert_eq!(
            serde_json::to_value(&got.vrm).unwrap(),
            json!({
                "kind": "user",
                "id": "mio-preset",
                "destPath": dst.vrms.join("mio-preset.vrm").to_string_lossy(),
                "label": "mio-preset",
            })
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
                Err("preset file unreadable".to_string()),
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
