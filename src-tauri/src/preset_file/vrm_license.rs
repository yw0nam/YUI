//! The redistribution rule a VRM file states in its GLB JSON chunk.

use serde::Serialize;
use std::io::Read;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum VrmLicense {
    Allowed,
    Prohibited,
    Unknown,
}

/// The license of the VRM in `reader`: VRM 1.0 `allowRedistribution`, else VRM 0.x `licenseName`.
pub(crate) fn read_license(_reader: impl Read) -> VrmLicense {
    VrmLicense::Unknown
}

/// A GLB whose JSON chunk is `json`.
#[cfg(test)]
pub(crate) fn glb_with_json(json: &str) -> Vec<u8> {
    let mut chunk = json.as_bytes().to_vec();
    while chunk.len() % 4 != 0 {
        chunk.push(b' ');
    }
    let total = 12 + 8 + chunk.len();
    let mut out = b"glTF".to_vec();
    out.extend(2u32.to_le_bytes());
    out.extend((total as u32).to_le_bytes());
    out.extend((chunk.len() as u32).to_le_bytes());
    out.extend(b"JSON");
    out.extend(chunk);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_license_follows_the_vrm_meta() {
        let cases = [
            (
                "1.0 true",
                r#"{"extensions":{"VRMC_vrm":{"meta":{"allowRedistribution":true}}}}"#,
                VrmLicense::Allowed,
            ),
            (
                "1.0 false",
                r#"{"extensions":{"VRMC_vrm":{"meta":{"allowRedistribution":false}}}}"#,
                VrmLicense::Prohibited,
            ),
            (
                "1.0 missing",
                r#"{"extensions":{"VRMC_vrm":{"meta":{}}}}"#,
                VrmLicense::Prohibited,
            ),
            (
                "0.x prohibited",
                r#"{"extensions":{"VRM":{"meta":{"licenseName":"Redistribution_Prohibited"}}}}"#,
                VrmLicense::Prohibited,
            ),
            (
                "0.x CC",
                r#"{"extensions":{"VRM":{"meta":{"licenseName":"CC_BY"}}}}"#,
                VrmLicense::Allowed,
            ),
            (
                "0.x missing",
                r#"{"extensions":{"VRM":{"meta":{}}}}"#,
                VrmLicense::Unknown,
            ),
            (
                "0.x empty",
                r#"{"extensions":{"VRM":{"meta":{"licenseName":""}}}}"#,
                VrmLicense::Unknown,
            ),
            (
                "0.x Other",
                r#"{"extensions":{"VRM":{"meta":{"licenseName":"Other"}}}}"#,
                VrmLicense::Unknown,
            ),
            (
                "no VRM extension",
                r#"{"asset":{"version":"2.0"}}"#,
                VrmLicense::Unknown,
            ),
        ];
        for (label, json, want) in cases {
            assert_eq!(
                read_license(glb_with_json(json).as_slice()),
                want,
                "{label}"
            );
        }
        assert_eq!(
            read_license(&b"not a glb at all, just bytes"[..]),
            VrmLicense::Unknown,
            "garbage bytes"
        );
        let mut not_glb =
            glb_with_json(r#"{"extensions":{"VRMC_vrm":{"meta":{"allowRedistribution":true}}}}"#);
        not_glb[..4].copy_from_slice(b"RIFF");
        assert_eq!(
            read_license(not_glb.as_slice()),
            VrmLicense::Unknown,
            "bad magic"
        );
    }
}
