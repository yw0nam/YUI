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
