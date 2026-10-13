//! The `browser` tool's argument checks, answered with the tool's own error strings.

use super::keys::{chord, KeyEvent};
use super::outcome::{invalid, missing};
use serde_json::Value;

/// A ref named against the snapshot that produced it.
pub struct Target {
    pub page_id: String,
    pub revision: u64,
    pub r#ref: String,
}

pub enum Request {
    Open { url: String },
    Read,
    Click { target: Target },
    Type { target: Target, text: String },
    PressKey { events: Vec<KeyEvent> },
}

impl Request {
    pub fn action(&self) -> &'static str {
        match self {
            Request::Open { .. } => "open",
            Request::Read => "read",
            Request::Click { .. } => "click",
            Request::Type { .. } => "type",
            Request::PressKey { .. } => "press_key",
        }
    }
}

fn field<'a>(args: &'a Value, name: &str) -> Result<&'a Value, String> {
    match args.get(name) {
        None | Some(Value::Null) => Err(missing(name)),
        Some(v) => Ok(v),
    }
}

fn string(args: &Value, name: &str) -> Result<String, String> {
    field(args, name)?
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| invalid(name))
}

fn target(args: &Value) -> Result<Target, String> {
    let page_id = string(args, "page_id")?;
    let revision = field(args, "revision")?
        .as_u64()
        .ok_or_else(|| invalid("revision"))?;
    let r#ref = string(args, "ref")?;
    Ok(Target {
        page_id,
        revision,
        r#ref,
    })
}

/// The serialization of a valid http or https URL, the exact URL Chrome navigates to.
fn web_url(raw: String) -> Result<String, String> {
    match url::Url::parse(&raw) {
        Ok(u) if matches!(u.scheme(), "http" | "https") && u.has_host() => Ok(u.into()),
        _ => Err(invalid("url")),
    }
}

/// Parses one call; `mac` resolves `ControlOrMeta`.
pub fn parse(action: &str, args: &Value, mac: bool) -> Result<Request, String> {
    match action {
        "open" => Ok(Request::Open {
            url: web_url(string(args, "url")?)?,
        }),
        "read" => Ok(Request::Read),
        "click" => Ok(Request::Click {
            target: target(args)?,
        }),
        "type" => Ok(Request::Type {
            target: target(args)?,
            text: string(args, "text")?,
        }),
        "press_key" => Ok(Request::PressKey {
            events: chord(&string(args, "key")?, mac).ok_or_else(|| invalid("key"))?,
        }),
        "" => Err(missing("action")),
        _ => Err(invalid("action")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn open(url: &str) -> Result<Request, String> {
        parse("open", &json!({ "url": url }), false)
    }

    #[test]
    fn open_takes_http_and_https_urls_only() {
        assert!(open("http://example.com/").is_ok());
        assert!(open("https://httpbin.org/forms/post").is_ok());
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "chrome://settings",
        ] {
            assert_eq!(
                open(url).err().unwrap(),
                "error: invalid field url",
                "{url}"
            );
        }
        assert_eq!(
            parse("open", &json!({}), false).err().unwrap(),
            "error: missing field url"
        );
    }

    #[test]
    fn open_navigates_to_the_url_it_validated() {
        let Request::Open { url } = open("HTTPS://Example.COM/a b").unwrap() else {
            panic!("not an open request");
        };
        assert_eq!(url, "https://example.com/a%20b");
    }

    #[test]
    fn press_key_rejects_an_unknown_key_name() {
        assert!(parse("press_key", &json!({ "key": "Enter" }), false).is_ok());
        assert_eq!(
            parse("press_key", &json!({ "key": "Foo" }), false)
                .err()
                .unwrap(),
            "error: invalid field key"
        );
    }
}
