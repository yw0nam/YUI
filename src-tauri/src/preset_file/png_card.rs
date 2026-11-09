//! Writes a card into a PNG as a `chara` tEXt chunk.

use crate::card_import::{chunk_len, text_chunk, PNG_SIGNATURE};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

/// `png` with every `chara` and `ccv3` tEXt chunk dropped and one `chara` chunk holding the base64
/// of `card_json` placed right before `IEND`.
pub(crate) fn with_card_chunk(png: &[u8], card_json: &str) -> Result<Vec<u8>, String> {
    let malformed = || "png malformed".to_string();
    if !png.starts_with(PNG_SIGNATURE) {
        return Err(malformed());
    }
    let mut out = PNG_SIGNATURE.to_vec();
    let mut offset = PNG_SIGNATURE.len();
    loop {
        let len = chunk_len(png, offset).ok_or_else(malformed)?;
        let end = offset + 12 + len;
        let kind = &png[offset + 4..offset + 8];
        if kind == b"IEND" {
            out.extend(chara_chunk(card_json));
        }
        let is_card_text = kind == b"tEXt"
            && matches!(
                text_chunk(&png[offset + 8..end - 4]),
                Some(("chara" | "ccv3", _))
            );
        if !is_card_text {
            out.extend(&png[offset..end]);
        }
        if kind == b"IEND" {
            return Ok(out);
        }
        offset = end;
    }
}

/// A `tEXt` chunk `chara\0<base64(card_json)>`, with its CRC.
fn chara_chunk(card_json: &str) -> Vec<u8> {
    let mut body = b"tEXtchara\0".to_vec();
    body.extend(B64.encode(card_json).as_bytes());
    let mut chunk = ((body.len() - 4) as u32).to_be_bytes().to_vec();
    chunk.extend(&body);
    chunk.extend(crc32fast::hash(&body).to_be_bytes());
    chunk
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card_import::card_json_from_png;

    fn one_pixel_png() -> Vec<u8> {
        let mut out = Vec::new();
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    /// One tEXt chunk with a zero CRC.
    fn text_chunk(keyword: &str, text: &str) -> Vec<u8> {
        let data = format!("{keyword}\0{text}");
        let mut out = (data.len() as u32).to_be_bytes().to_vec();
        out.extend(b"tEXt");
        out.extend(data.as_bytes());
        out.extend([0u8; 4]);
        out
    }

    #[test]
    fn the_chunk_sits_before_iend_with_the_crc_of_its_type_and_data() {
        let png = one_pixel_png();

        let out = with_card_chunk(&png, "{}").unwrap();

        let mut chunk = vec![0, 0, 0, 10];
        chunk.extend(b"tEXtchara\0e30=");
        chunk.extend([0x22, 0xd8, 0x6d, 0xaf]);
        let iend = &png[png.len() - 12..];
        assert_eq!(
            out[out.len() - 12 - chunk.len()..],
            [&chunk[..], iend].concat()
        );
        assert_eq!(out.len(), png.len() + chunk.len());
    }

    #[test]
    fn the_card_reads_back_and_replaces_the_old_card_chunks() {
        let png = one_pixel_png();
        let (body, iend) = png.split_at(png.len() - 12);
        let old = [
            body,
            &text_chunk("ccv3", "b2xkMw=="),
            &text_chunk("chara", "b2xkMg=="),
            iend,
        ]
        .concat();

        let out = with_card_chunk(&old, r#"{"name":"Mio"}"#).unwrap();

        assert_eq!(
            card_json_from_png(&out),
            Ok(r#"{"name":"Mio"}"#.to_string())
        );
        assert_eq!(out.windows(4).filter(|w| *w == b"tEXt").count(), 1);
    }

    #[test]
    fn a_file_that_is_no_png_is_refused() {
        assert_eq!(
            with_card_chunk(b"GIF89a", "{}"),
            Err("png malformed".to_string())
        );
    }
}
