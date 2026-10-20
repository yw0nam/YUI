#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_all_families_and_preserves_payloads() {
        for (method, path, body) in [
            ("POST", "/signals", r#"{"signals":[1],"envelope":{"x":1}}"#),
            (
                "POST",
                "/agent-event",
                r#"{"tool":"test","project":"test","cwd":"/tmp","phase":"done","summary":"done","ts":0}"#,
            ),
            ("GET", "/avatar/state", ""),
            ("GET", "/avatar/perch-targets", ""),
            ("POST", "/avatar/command", r#"{"action":"stand"}"#),
        ] {
            assert!(matches!(
                parse_route(method, path, body).unwrap().target,
                Target::Main
            ));
            let route =
                parse_route(method, &format!("/presets/abc12345{path}?probe=1"), body).unwrap();
            assert!(matches!(route.target, Target::Preset(ref id) if id == "abc12345"));
            let url = format!("/presets/abc12345{path}");
            let ids = HashSet::new();
            assert_eq!(dispatch(method, &url, body, &ids, |_| false).unwrap_err(), 404);
            assert_eq!(dispatch(method, &url, body, &ids, |label| label == "pet-abc12345").unwrap().label, "pet-abc12345");
            let ids = HashSet::from(["abc12345".into()]);
            assert_eq!(dispatch(method, &url, body, &ids, |_| false).unwrap_err(), 503);
            if let RouteKind::Signals(payload) = route.kind {
                assert_eq!(payload.signals, vec![serde_json::json!(1)]);
                assert_eq!(payload.envelope, serde_json::json!({"x":1}));
                assert!(payload.ts > 0);
            }
            assert_eq!(
                parse_route("DELETE", &format!("/presets/x{path}"), "").unwrap_err(),
                405
            );
        }
    }
    #[test]
    fn rejects_malformed_routes_and_payloads() {
        for path in [
            "/presets",
            "/presets/",
            "/presets//signals",
            "/presets/a%2fb/signals",
            "/presets/a/signals/",
            "/presets/a/b/signals",
            "/presets/a/unknown",
        ] {
            assert_eq!(parse_route("POST", path, "{}").unwrap_err(), 404, "{path}");
        }
        assert_eq!(
            parse_route("POST", "/presets/x/signals", r#"{"signals":[]}"#).unwrap_err(),
            400
        );
        assert_eq!(parse_route("POST", "/unknown", "").unwrap_err(), 400);
        assert_eq!(parse_route("GET", "/avatar/unknown", "").unwrap_err(), 404);
    }
    #[test]
    fn resolves_by_window_then_registry_without_main_fallback() {
        let mut ids = std::collections::HashSet::new();
        let target = Target::Preset("abc12345".into());
        assert_eq!(
            resolve_target(&target, true, &ids),
            Ok("pet-abc12345".into())
        );
        assert_eq!(resolve_target(&target, false, &ids), Err(404));
        ids.insert("abc12345".into());
        assert_eq!(resolve_target(&target, false, &ids), Err(503));
        assert_eq!(
            resolve_target(&Target::Main, false, &ids),
            Ok("main".into())
        );
    }
}
