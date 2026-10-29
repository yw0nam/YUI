use crate::threads::model::{parse_upsert, Upsert};
use std::time::Duration;

const THREAD_ID_MAX_BYTES: usize = 128;
const SOURCE_MAX_CHARS: usize = 64;
const WAIT_MAX_SECONDS: u64 = 25;

#[derive(Debug)]
pub(in crate::agent_ingress) enum ThreadRoute {
    Upsert {
        id: String,
        body: Upsert,
    },
    Answer {
        id: String,
        ask_id: Option<String>,
        wait: Duration,
    },
    Sweep {
        source: String,
    },
}

pub(in crate::agent_ingress) fn parse(
    method: &str,
    path: &str,
    url: &str,
    body: &str,
) -> Result<ThreadRoute, u16> {
    let rest = path.strip_prefix("/threads/").ok_or(404u16)?;
    let (id, suffix) = rest.split_once('/').unwrap_or((rest, ""));
    if id.is_empty()
        || id.len() > THREAD_ID_MAX_BYTES
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-.:".contains(&c))
    {
        return Err(404);
    }
    match suffix {
        "" if !rest.ends_with('/') => {
            if id == "answers" {
                if method == "GET" {
                    return sweep_source(url).map(|source| ThreadRoute::Sweep { source });
                }
                // answers is reserved and names no Thread; PUT misses an id, the rest miss the sweep.
                return Err(if method == "PUT" { 404 } else { 405 });
            }
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
                .map(|(_, v)| v.to_string());
            let wait = match pairs.iter().find(|(key, _)| key == "wait") {
                None => WAIT_MAX_SECONDS,
                Some((_, value)) => {
                    if value.is_empty() || !value.bytes().all(|c| c.is_ascii_digit()) {
                        return Err(400);
                    }
                    value.parse::<u64>().map_err(|_| 400u16)?
                }
            };
            if wait > WAIT_MAX_SECONDS {
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

fn sweep_source(url: &str) -> Result<String, u16> {
    let url = reqwest::Url::parse(&format!("http://localhost{url}")).map_err(|_| 400u16)?;
    let pairs: Vec<_> = url.query_pairs().collect();
    let source = pairs
        .iter()
        .find(|(key, _)| key == "source")
        .map(|(_, v)| v.to_string())
        .ok_or(400u16)?;
    if source.is_empty() || source.chars().count() > SOURCE_MAX_CHARS {
        return Err(400);
    }
    Ok(source)
}
