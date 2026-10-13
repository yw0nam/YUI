//! The page snapshot the model reads, its caps, and the ref table later actions are checked against.

use serde::Serialize;
use std::collections::HashMap;

const URL_CAP: usize = 2_000;
const TITLE_CAP: usize = 300;
const NAME_CAP: usize = 200;
const TEXT_CAP: usize = 4_000;
const ELEMENT_CAP: usize = 300;
const BUDGET_BYTES: usize = 64 * 1024;

const INTERACTIVE_ROLES: [&str; 12] = [
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "menuitem",
    "tab",
    "option",
    "slider",
    "switch",
];

/// One accessibility node as the snapshot reads it.
#[derive(Debug, Clone, Default)]
pub struct AxItem {
    pub role: String,
    pub name: String,
    pub ignored: bool,
    pub backend_id: Option<i64>,
    pub frame: Option<String>,
    pub focused: bool,
    pub checked: bool,
    pub disabled: bool,
    pub expanded: bool,
}

/// A returned element's node and its untruncated role and name.
#[derive(Debug, Clone)]
pub struct RefEntry {
    pub backend_id: i64,
    pub role: String,
    pub name: String,
    frame: Option<String>,
}

impl RefEntry {
    pub fn same_identity(&self, role: &str, name: &str) -> bool {
        self.role == role && self.name == name
    }
}

/// The refs of the latest snapshot, valid only for its page_id and revision.
#[derive(Debug, Default)]
pub struct RefTable {
    page_id: String,
    revision: u64,
    loader: String,
    entries: HashMap<String, RefEntry>,
}

impl RefTable {
    pub fn resolve(&self, page_id: &str, revision: u64, r: &str) -> Option<RefEntry> {
        if page_id != self.page_id || revision != self.revision {
            return None;
        }
        self.entries.get(r).cloned()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// A main-frame navigation to another document invalidates every ref.
    pub fn on_main_navigation(&mut self, loader: &str) {
        if loader != self.loader {
            self.clear();
        }
    }

    pub fn drop_frame(&mut self, frame: &str) {
        self.entries
            .retain(|_, e| e.frame.as_deref() != Some(frame));
    }
}

#[derive(Serialize)]
struct Element<'a> {
    #[serde(rename = "ref")]
    r: String,
    role: &'a str,
    name: String,
    states: Vec<&'static str>,
}

#[derive(Serialize)]
struct Snapshot<'a> {
    page_id: &'a str,
    revision: u64,
    url: String,
    title: String,
    text: String,
    elements: Vec<Element<'a>>,
    truncated: bool,
}

pub struct Built {
    pub json: String,
    pub refs: RefTable,
}

fn cap(s: &str, limit: usize, cut: &mut bool) -> String {
    if s.chars().count() <= limit {
        return s.to_string();
    }
    *cut = true;
    s.chars().take(limit).collect()
}

fn states(item: &AxItem) -> Vec<&'static str> {
    [
        (item.focused, "focused"),
        (item.checked, "checked"),
        (item.disabled, "disabled"),
        (item.expanded, "expanded"),
    ]
    .into_iter()
    .filter_map(|(on, state)| on.then_some(state))
    .collect()
}

fn page_text(items: &[AxItem]) -> String {
    let mut text = String::new();
    let mut last = "";
    for item in items
        .iter()
        .filter(|i| !i.ignored && i.role == "StaticText")
    {
        let part = item.name.trim();
        if part.is_empty() || part == last {
            continue;
        }
        if !text.is_empty() {
            text.push(' ');
        }
        text.push_str(part);
        last = part;
        // Past this many bytes the text holds more than TEXT_CAP characters.
        if text.len() > TEXT_CAP * 4 {
            break;
        }
    }
    text
}

fn interactive(items: &[AxItem]) -> impl Iterator<Item = (&AxItem, i64)> {
    items
        .iter()
        .filter(|i| !i.ignored && INTERACTIVE_ROLES.contains(&i.role.as_str()))
        .filter_map(|i| i.backend_id.map(|id| (i, id)))
}

pub fn interactive_count(items: &[AxItem]) -> usize {
    interactive(items).count()
}

/// Builds the snapshot JSON for one capture and the ref table of the elements it returns.
pub fn build(page_id: &str, revision: u64, loader: &str, url: &str, items: &[AxItem]) -> Built {
    let mut cut = false;
    let title = items
        .iter()
        .find(|i| i.role == "RootWebArea")
        .map_or("", |i| i.name.as_str());
    let mut picked: Vec<(&AxItem, i64)> = interactive(items).collect();
    if picked.len() > ELEMENT_CAP {
        cut = true;
        picked.truncate(ELEMENT_CAP);
    }
    let elements = picked
        .iter()
        .map(|(item, id)| Element {
            r: format!("e{id}"),
            role: &item.role,
            name: cap(&item.name, NAME_CAP, &mut cut),
            states: states(item),
        })
        .collect();
    let url = cap(url, URL_CAP, &mut cut);
    let title = cap(title, TITLE_CAP, &mut cut);
    let text = cap(&page_text(items), TEXT_CAP, &mut cut);
    let mut snapshot = Snapshot {
        page_id,
        revision,
        url,
        title,
        text,
        elements,
        truncated: cut,
    };
    let mut json = serde_json::to_string(&snapshot).unwrap_or_default();
    if json.len() > BUDGET_BYTES {
        snapshot.truncated = true;
        let sizes: Vec<usize> = snapshot
            .elements
            .iter()
            .map(|e| serde_json::to_string(e).map_or(0, |s| s.len()))
            .collect();
        let mut len = serde_json::to_string(&snapshot).map_or(0, |s| s.len());
        while len > BUDGET_BYTES && !snapshot.elements.is_empty() {
            snapshot.elements.pop();
            let comma = usize::from(!snapshot.elements.is_empty());
            len -= sizes[snapshot.elements.len()] + comma;
        }
        json = serde_json::to_string(&snapshot).unwrap_or_default();
    }
    let entries = picked
        .iter()
        .take(snapshot.elements.len())
        .map(|(item, id)| {
            let entry = RefEntry {
                backend_id: *id,
                role: item.role.clone(),
                name: item.name.clone(),
                frame: item.frame.clone(),
            };
            (format!("e{id}"), entry)
        })
        .collect();
    Built {
        json,
        refs: RefTable {
            page_id: page_id.to_string(),
            revision,
            loader: loader.to_string(),
            entries,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn item(role: &str, name: &str, id: i64) -> AxItem {
        AxItem {
            role: role.to_string(),
            name: name.to_string(),
            backend_id: Some(id),
            ..AxItem::default()
        }
    }

    fn page(title: &str, text: &str, elements: impl IntoIterator<Item = AxItem>) -> Vec<AxItem> {
        let mut items = vec![item("RootWebArea", title, 1), item("StaticText", text, 2)];
        items.extend(elements);
        items
    }

    fn parsed(built: &Built) -> Value {
        serde_json::from_str(&built.json).unwrap()
    }

    fn chars(v: &Value) -> usize {
        v.as_str().unwrap().chars().count()
    }

    #[test]
    fn a_small_page_is_not_truncated() {
        let built = build(
            "s1-AB",
            4,
            "L1",
            "https://example.com/",
            &page("Form", "Hello", [item("button", "Submit", 42)]),
        );
        let v = parsed(&built);
        assert_eq!(v["page_id"], "s1-AB");
        assert_eq!(v["revision"], 4);
        assert_eq!(v["title"], "Form");
        assert_eq!(v["text"], "Hello");
        assert_eq!(v["elements"][0]["ref"], "e42");
        assert_eq!(v["elements"][0]["role"], "button");
        assert_eq!(v["truncated"], false);
        assert!(built.refs.resolve("s1-AB", 4, "e42").is_some());
    }

    #[test]
    fn caps_cut_url_title_names_text_and_element_count() {
        let long_name = "n".repeat(300);
        let elements =
            (0..350).map(|i| item("link", if i == 0 { &long_name } else { "x" }, 100 + i));
        let url = format!("https://example.com/{}", "u".repeat(3000));
        let built = build(
            "s1-AB",
            1,
            "L1",
            &url,
            &page(&"t".repeat(500), &"w".repeat(5000), elements),
        );
        let v = parsed(&built);
        assert_eq!(chars(&v["url"]), 2000);
        assert_eq!(chars(&v["title"]), 300);
        assert_eq!(chars(&v["text"]), 4000);
        assert_eq!(chars(&v["elements"][0]["name"]), 200);
        assert_eq!(v["elements"].as_array().unwrap().len(), 300);
        assert_eq!(v["truncated"], true);
        assert_eq!(
            built.refs.resolve("s1-AB", 1, "e100").unwrap().name,
            long_name
        );
        assert!(built.refs.resolve("s1-AB", 1, "e399").is_some());
        assert!(built.refs.resolve("s1-AB", 1, "e400").is_none());
    }

    #[test]
    fn trailing_elements_drop_until_the_result_fits_64_kib() {
        let name = "한".repeat(200);
        let built = build(
            "s1-AB",
            1,
            "L1",
            "https://example.com/",
            &page("T", "x", (0..300).map(|i| item("button", &name, 1000 + i))),
        );
        assert!(built.json.len() <= 64 * 1024);
        let v = parsed(&built);
        let kept = v["elements"].as_array().unwrap();
        assert!(!kept.is_empty() && kept.len() < 300);
        assert_eq!(kept[0]["ref"], "e1000");
        assert_eq!(v["truncated"], true);
        let last = 1000 + kept.len() as i64 - 1;
        assert!(built
            .refs
            .resolve("s1-AB", 1, &format!("e{last}"))
            .is_some());
        assert!(built
            .refs
            .resolve("s1-AB", 1, &format!("e{}", last + 1))
            .is_none());
    }

    #[test]
    fn a_ref_from_another_page_or_revision_is_stale() {
        let built = build(
            "s1-AB",
            3,
            "L1",
            "https://example.com/",
            &page("T", "x", [item("textbox", "Name", 7)]),
        );
        assert!(built.refs.resolve("s1-AB", 3, "e7").is_some());
        assert!(built.refs.resolve("s2-CD", 3, "e7").is_none());
        assert!(built.refs.resolve("s1-AB", 2, "e7").is_none());
        assert!(built.refs.resolve("s1-AB", 3, "e8").is_none());
    }

    #[test]
    fn a_re_resolved_node_with_another_role_or_name_does_not_match() {
        let built = build(
            "s1-AB",
            3,
            "L1",
            "https://example.com/",
            &page("T", "x", [item("textbox", "Name", 7)]),
        );
        let entry = built.refs.resolve("s1-AB", 3, "e7").unwrap();
        assert!(entry.same_identity("textbox", "Name"));
        assert!(!entry.same_identity("textbox", "Email"));
        assert!(!entry.same_identity("button", "Name"));
    }
}
