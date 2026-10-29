use crate::threads::model::{parse_upsert, Upsert};
use std::time::Duration;

#[derive(Debug)]
pub(super) enum ThreadRoute {
    Upsert {
        id: String,
        body: Upsert,
    },
    Answer {
        id: String,
        ask_id: String,
        wait: Duration,
    },
}

pub(super) fn parse(method: &str, path: &str, url: &str, body: &str) -> Result<ThreadRoute, u16> {
    let rest = path.strip_prefix("/threads/").ok_or(404u16)?;
    let (id, suffix) = rest.split_once('/').unwrap_or((rest, ""));
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-.:".contains(&c))
    {
        return Err(404);
    }
    match suffix {
        "" if !rest.ends_with('/') => {
            if method != "PUT" {
                return Err(405);
            }
            Ok(ThreadRoute::Upsert {
                id: id.into(),
                body: parse_upsert(body)?,
            })
        }
        "answer" => {
            if method != "GET" {
                return Err(405);
            }
            let url = reqwest::Url::parse(&format!("http://localhost{url}")).map_err(|_| 400u16)?;
            let pairs: Vec<_> = url.query_pairs().collect();
            let ask_id = pairs
                .iter()
                .find(|(key, _)| key == "ask_id")
                .map(|(_, v)| v.to_string())
                .ok_or(400u16)?;
            let wait = match pairs.iter().find(|(key, _)| key == "wait") {
                None => 25,
                Some((_, value)) => {
                    if value.is_empty() || !value.bytes().all(|c| c.is_ascii_digit()) {
                        return Err(400);
                    }
                    value.parse::<u64>().map_err(|_| 400u16)?
                }
            };
            if wait > 25 {
                return Err(400);
            }
            Ok(ThreadRoute::Answer {
                id: id.into(),
                ask_id,
                wait: Duration::from_secs(wait),
            })
        }
        _ => Err(404),
    }
}
