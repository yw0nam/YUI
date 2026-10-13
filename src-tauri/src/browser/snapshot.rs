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
