use crate::threads::model::{parse_upsert, Upsert};

const THREAD_ID_MAX_BYTES: usize = 128;

#[derive(Debug)]
pub(in crate::agent_ingress) enum ThreadRoute {
    Upsert { id: String, body: Upsert },
}

pub(in crate::agent_ingress) fn parse(
    method: &str,
    path: &str,
    body: &str,
) -> Result<ThreadRoute, u16> {
    let rest = path.strip_prefix("/threads/").ok_or(404u16)?;
    if rest.is_empty()
        || rest.len() > THREAD_ID_MAX_BYTES
        || !rest
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-.:".contains(&c))
    {
        return Err(404);
    }
    if method != "PUT" {
        return Err(405);
    }
    Ok(ThreadRoute::Upsert {
        id: rest.into(),
        body: parse_upsert(body)?,
    })
}
