use serde::{Deserialize, Serialize};

const TEXT_MAX_CHARS: usize = 16384;
const SOURCE_MAX_CHARS: usize = 64;

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
pub struct Thread {
    pub id: String,
    pub source: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub state: ThreadState,
    pub entries: Vec<Entry>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub read: bool,
    /// How many entries were ever appended; `entries` keeps only the newest 50.
    #[serde(default)]
    pub entry_count: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct InputEntry {
    pub role: Role,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Upsert {
    pub source: String,
    pub title: String,
    pub label: Option<String>,
    pub state: ThreadState,
    #[serde(default, deserialize_with = "null_as_default")]
    pub entries: Vec<InputEntry>,
}

fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn bounded(value: &str, max: usize) -> Result<(), u16> {
    if value.is_empty() || value.chars().count() > max {
        Err(400)
    } else {
        Ok(())
    }
}

pub fn parse_upsert(body: &str) -> Result<Upsert, u16> {
    // Read as a map first: an array is no Thread body, and a repeated key keeps its last value.
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(body).map_err(|_| 400u16)?;
    let mut upsert: Upsert = serde_json::from_value(map.into()).map_err(|_| 400u16)?;
    bounded(&upsert.source, SOURCE_MAX_CHARS)?;
    bounded(&upsert.title, 200)?;
    if let Some(s) = &mut upsert.label {
        if s.chars().count() > 120 {
            *s = s.chars().take(119).chain(std::iter::once('…')).collect();
        }
    }
    if upsert.entries.len() > 20 {
        return Err(400);
    }
    for entry in &upsert.entries {
        bounded(&entry.text, TEXT_MAX_CHARS)?;
    }
    Ok(upsert)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::{json, Value};

    pub fn body() -> Value {
        json!({"source":"codex","title":"Build","state":"input-required",
            "entries":[{"role":"agent","text":"Allow?"}]})
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
        for field in ["label", "entries"] {
            let mut null = body();
            null[field] = Value::Null;
            let parsed = parse_upsert(&null.to_string());
            assert!(parsed.is_ok(), "null {field} is absent: {parsed:?}");
            let parsed = parsed.unwrap();
            assert_eq!(parsed.label, None);
            assert_eq!(parsed.entries.is_empty(), field == "entries");
        }
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
        for field in ["source", "title", "state"] {
            let mut v = body();
            v.as_object_mut().unwrap().remove(field);
            assert_eq!(
                parse_upsert(&v.to_string()).err(),
                Some(400),
                "missing {field}"
            );
        }
        assert_eq!(parse_upsert("{").unwrap_err(), 400);
    }
}
