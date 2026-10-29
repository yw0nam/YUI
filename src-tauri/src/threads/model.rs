use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ThreadState {
    Working,
    InputRequired,
    Completed,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Agent,
    User,
    System,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Entry {
    pub role: Role,
    pub text: String,
    pub at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Primary,
    Danger,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Choice {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<Tone>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Ask {
    pub ask_id: String,
    pub prompt: String,
    #[serde(default)]
    pub choices: Vec<Choice>,
    pub text: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Answer {
    pub ask_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<bool>,
    pub at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Thread {
    pub id: String,
    pub source: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub state: ThreadState,
    pub entries: Vec<Entry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ask: Option<Ask>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct InputEntry {
    pub role: Role,
    pub text: String,
}

#[derive(Clone, Debug)]
pub enum AskUpdate {
    Keep,
    Close,
    Set(Ask),
}

#[derive(Clone, Debug)]
pub struct Upsert {
    pub source: String,
    pub title: String,
    pub label: Option<String>,
    pub state: ThreadState,
    pub entries: Vec<InputEntry>,
    pub ask: AskUpdate,
}

pub fn parse_upsert(body: &str) -> Result<Upsert, u16> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| 400u16)?;
    let object = value.as_object().ok_or(400u16)?;
    Ok(Upsert {
        source: object
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .into(),
        title: object
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .into(),
        label: object
            .get("label")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        state: ThreadState::Working,
        entries: vec![],
        ask: AskUpdate::Keep,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::{json, Value};

    pub fn body() -> Value {
        json!({"source":"codex","title":"Build","state":"input-required",
            "entries":[{"role":"agent","text":"Allow?"}],
            "ask":{"ask_id":"a","prompt":"Allow?","text":true,
                "choices":[{"id":"yes","label":"Allow","tone":"primary"}]}})
    }

    #[test]
    fn valid_body_and_unicode_label() {
        let mut value = body();
        value["label"] = json!("한".repeat(120));
        value["unknown"] = json!(true);
        let parsed = parse_upsert(&value.to_string());
        assert!(parsed.is_ok(), "a valid Thread body must parse");
        assert_eq!(parsed.unwrap().label, Some("한".repeat(120)));
        value["label"] = json!("한".repeat(121));
        assert_eq!(
            parse_upsert(&value.to_string()).unwrap().label,
            Some(format!("{}…", "한".repeat(119)))
        );
    }

    #[test]
    fn rejects_each_put_rule() {
        let mut cases = vec![("", json!(null)), ("", json!([]))];
        for (field, max) in [("source", 64), ("title", 200)] {
            for value in [json!(null), json!(3), json!(""), json!("x".repeat(max + 1))] {
                cases.push((field, value));
            }
        }
        cases.extend([
            ("state", json!("waiting")),
            ("state", json!(null)),
            ("label", json!(2)),
            ("label", json!(null)),
            ("entries", json!(null)),
        ]);
        cases.extend([
            (
                "entries",
                json!(vec![json!({"role":"agent","text":"x"}); 21]),
            ),
            ("entries", json!([{"role":"bot","text":"x"}])),
            ("entries", json!([{"role":"agent","text":""}])),
            (
                "entries",
                json!([{"role":"agent","text":"x".repeat(16385)}]),
            ),
            ("entries", json!([{"role":"agent"}])),
            ("ask", json!(false)),
        ]);
        for (field, value) in cases {
            let mut v = body();
            if field.is_empty() {
                v = value;
            } else {
                v[field] = value;
            }
            assert_eq!(parse_upsert(&v.to_string()).unwrap_err(), 400, "{v}");
        }
        for (field, max) in [("ask_id", 128), ("prompt", 500), ("placeholder", 200)] {
            for value in [json!(3), json!(null), json!("x".repeat(max + 1))]
                .into_iter()
                .chain((field != "placeholder").then(|| json!("")))
            {
                let mut v = body();
                v["ask"][field] = value;
                assert_eq!(
                    parse_upsert(&v.to_string()).unwrap_err(),
                    400,
                    "ask.{field}"
                );
            }
        }
        for (field, value) in [
            ("text", json!(null)),
            ("text", json!("yes")),
            ("choices", json!(null)),
            ("choices", json!(vec![json!({"id":"a","label":"A"}); 7])),
            (
                "choices",
                json!([{"id":"a","label":"A"},{"id":"a","label":"B"}]),
            ),
        ] {
            let mut v = body();
            v["ask"][field] = value;
            assert_eq!(parse_upsert(&v.to_string()).err(), Some(400), "ask.{field}");
        }
        for field in ["id", "label", "tone"] {
            for value in [json!(null), json!(3), json!(""), json!("x".repeat(65))] {
                let mut v = body();
                v["ask"]["choices"][0][field] = value;
                assert_eq!(
                    parse_upsert(&v.to_string()).unwrap_err(),
                    400,
                    "choice.{field}"
                );
            }
        }
        for field in ["source", "title", "state"] {
            let mut v = body();
            v.as_object_mut().unwrap().remove(field);
            assert_eq!(
                parse_upsert(&v.to_string()).err(),
                Some(400),
                "missing {field}"
            );
        }
        for field in ["ask_id", "prompt", "text"] {
            let mut v = body();
            v["ask"].as_object_mut().unwrap().remove(field);
            assert_eq!(
                parse_upsert(&v.to_string()).err(),
                Some(400),
                "missing ask.{field}"
            );
        }
        assert_eq!(parse_upsert("{").unwrap_err(), 400);
    }
}
