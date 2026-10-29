use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub const TEXT_MAX_CHARS: usize = 16384;
const ASK_ID_MAX_CHARS: usize = 128;

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
    #[serde(default, deserialize_with = "null_as_default")]
    pub choices: Vec<Choice>,
    pub text: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct AnswerInput {
    pub ask_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub choice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Answer {
    #[serde(flatten)]
    pub input: AnswerInput,
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
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub answered_ask_ids: BTreeSet<String>,
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

fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn bounded(value: &str, max: usize, empty: bool) -> Result<(), u16> {
    if (!empty && value.is_empty()) || value.chars().count() > max {
        Err(400)
    } else {
        Ok(())
    }
}

fn optional_string(
    value: &serde_json::Value,
    key: &str,
    max: usize,
) -> Result<Option<String>, u16> {
    value
        .get(key)
        .filter(|v| !v.is_null())
        .map(|v| {
            let s = v.as_str().ok_or(400u16)?;
            bounded(s, max, true)?;
            Ok(s.to_owned())
        })
        .transpose()
}

fn parse_ask(value: &serde_json::Value) -> Result<Ask, u16> {
    let ask: Ask = serde_json::from_value(value.clone()).map_err(|_| 400u16)?;
    bounded(&ask.ask_id, ASK_ID_MAX_CHARS, false)?;
    bounded(&ask.prompt, 500, false)?;
    optional_string(value, "placeholder", 200)?;
    if ask.choices.len() > 6 {
        return Err(400);
    }
    let mut ids = std::collections::HashSet::new();
    for choice in &ask.choices {
        bounded(&choice.id, 64, false)?;
        bounded(&choice.label, 64, false)?;
        if !ids.insert(&choice.id) {
            return Err(400);
        }
    }
    Ok(ask)
}

pub fn parse_upsert(body: &str) -> Result<Upsert, u16> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| 400u16)?;
    let source = value.get("source").and_then(|v| v.as_str()).ok_or(400u16)?;
    let title = value.get("title").and_then(|v| v.as_str()).ok_or(400u16)?;
    bounded(source, 64, false)?;
    bounded(title, 200, false)?;
    let mut label = optional_string(&value, "label", usize::MAX)?;
    if let Some(s) = &mut label {
        if s.chars().count() > 120 {
            *s = s.chars().take(119).chain(std::iter::once('…')).collect();
        }
    }
    let state =
        serde_json::from_value(value.get("state").ok_or(400u16)?.clone()).map_err(|_| 400u16)?;
    let entries: Vec<InputEntry> = value
        .get("entries")
        .filter(|v| !v.is_null())
        .map(|v| serde_json::from_value(v.clone()).map_err(|_| 400u16))
        .transpose()?
        .unwrap_or_default();
    if entries.len() > 20 {
        return Err(400);
    }
    for entry in &entries {
        bounded(&entry.text, TEXT_MAX_CHARS, false)?;
    }
    let ask = match value.get("ask") {
        None => AskUpdate::Keep,
        Some(serde_json::Value::Null) => AskUpdate::Close,
        Some(v) => AskUpdate::Set(parse_ask(v)?),
    };
    Ok(Upsert {
        source: source.into(),
        title: title.into(),
        label,
        state,
        entries,
        ask,
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
    fn optional_null_fields_are_absent() {
        for path in [
            vec!["label"],
            vec!["entries"],
            vec!["ask", "placeholder"],
            vec!["ask", "choices"],
            vec!["ask", "choices", "0", "tone"],
        ] {
            let mut null = body();
            let last = path.last().unwrap();
            let mut n = &mut null;
            for key in &path[..path.len() - 1] {
                if *key == "0" {
                    n = &mut n[0];
                } else {
                    n = &mut n[*key];
                }
            }
            n[*last] = Value::Null;
            let parsed = parse_upsert(&null.to_string());
            assert!(parsed.is_ok(), "null {path:?} is absent: {parsed:?}");
            let parsed = parsed.unwrap();
            match path.as_slice() {
                ["label"] => assert_eq!(parsed.label, None),
                ["entries"] => assert!(parsed.entries.is_empty()),
                _ => {
                    let AskUpdate::Set(ask) = parsed.ask else {
                        panic!("ask remains open");
                    };
                    match path.as_slice() {
                        ["ask", "placeholder"] => assert_eq!(ask.placeholder, None),
                        ["ask", "choices"] => assert_eq!(ask.choices, vec![]),
                        _ => assert_eq!(ask.choices[0].tone, None),
                    }
                }
            }
        }
        let mut value = body();
        value["ask"] = Value::Null;
        assert!(matches!(
            parse_upsert(&value.to_string()).unwrap().ask,
            AskUpdate::Close
        ));
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
            for value in [json!(3), json!("x".repeat(max + 1))]
                .into_iter()
                .chain((field != "placeholder").then_some(Value::Null))
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
            for value in [json!(3), json!(""), json!("x".repeat(65))]
                .into_iter()
                .chain((field != "tone").then_some(Value::Null))
            {
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
