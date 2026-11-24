//! The herdr socket API client: connect, request, response, subscribe.

use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::net::UnixStream;

const SETUP_WAIT: Duration = Duration::from_secs(10);
const CONNECT_RETRY: Duration = Duration::from_millis(100);

/// One socket connection read line by line; `next_line` is cancel-safe for the select loop.
pub type Conn = Lines<BufReader<UnixStream>>;

/// Connects, retrying until the deadline so a fresh ssh forward has time to accept.
pub async fn connect(sock: &Path) -> Result<Conn, String> {
    let deadline = tokio::time::Instant::now() + SETUP_WAIT;
    loop {
        match UnixStream::connect(sock).await {
            Ok(stream) => return Ok(BufReader::new(stream).lines()),
            Err(e) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!("connect failed: {e}"));
                }
                tokio::time::sleep(CONNECT_RETRY).await;
            }
        }
    }
}

pub async fn write_line(conn: &mut Conn, value: &Value) -> Result<(), String> {
    let mut line = value.to_string();
    line.push('\n');
    conn.get_mut()
        .get_mut()
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

pub enum ReadFail {
    Timeout,
    Other(String),
}

/// The first response line carrying an id, within the setup wait.
pub async fn read_response(conn: &mut Conn) -> Result<Value, ReadFail> {
    let deadline = tokio::time::Instant::now() + SETUP_WAIT;
    loop {
        let line = tokio::time::timeout_at(deadline, conn.next_line())
            .await
            .map_err(|_| ReadFail::Timeout)?
            .map_err(|e| ReadFail::Other(e.to_string()))?;
        let Some(line) = line else {
            return Err(ReadFail::Other("connection closed".into()));
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("id").is_some() {
            if value.get("error").is_some() {
                return Err(ReadFail::Other(format!("error response: {line}")));
            }
            return Ok(value);
        }
    }
}

pub enum SubscribeFail {
    /// herdr rejected the set (a listed pane closed meanwhile) and closed the connection.
    Rejected,
    Failed(String),
}

pub async fn subscribe(conn: &mut Conn, subscriptions: &[Value]) -> Result<(), SubscribeFail> {
    let request =
        json!({"id": 1, "method": "events.subscribe", "params": {"subscriptions": subscriptions}});
    write_line(conn, &request)
        .await
        .map_err(|_| SubscribeFail::Rejected)?;
    let response = match read_response(conn).await {
        Ok(response) => response,
        Err(ReadFail::Timeout) => {
            return Err(SubscribeFail::Failed("subscription timed out".into()))
        }
        Err(ReadFail::Other(_)) => return Err(SubscribeFail::Rejected),
    };
    if response.pointer("/result/type").and_then(Value::as_str) != Some("subscription_started") {
        return Err(SubscribeFail::Rejected);
    }
    Ok(())
}

/// One `agent.list` round trip on its own connection.
pub async fn agent_list(sock: &Path) -> Result<Value, String> {
    let mut conn = connect(sock).await?;
    write_line(
        &mut conn,
        &json!({"id": 1, "method": "agent.list", "params": {}}),
    )
    .await?;
    read_response(&mut conn).await.map_err(|e| match e {
        ReadFail::Timeout => "agent list timed out".to_string(),
        ReadFail::Other(e) => e,
    })
}
