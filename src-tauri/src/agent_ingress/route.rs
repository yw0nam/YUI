//! Parses ingress routes and resolves their recipient without owning application state.

use super::payload::{
    cap_detail, cap_summary, parse_avatar_request, parse_request, parse_signals_request,
    AgentEventPayload, AvatarRoute, SignalsPayload,
};
use super::INGRESS_WINDOW;
use crate::os_event_watcher::epoch_ms;

/// Builds the shared pet-window label for one preset id.
fn pet_label(id: &str) -> String {
    format!("pet-{id}")
}

/// The main window or one preset-addressed pet window.
#[derive(Debug)]
pub(super) enum Target {
    Main,
    Preset(String),
}
/// A validated ingress payload ready for its recipient.
#[derive(Debug)]
pub(super) enum RouteKind {
    AgentEvent(AgentEventPayload),
    Signals(SignalsPayload),
    Avatar(AvatarRoute),
}
/// A parsed target and its validated payload.
#[derive(Debug)]
pub(super) struct Route {
    pub target: Target,
    pub kind: RouteKind,
}

/// Validates the raw path, method and payload without decoding preset ids.
pub(super) fn parse_route(method: &str, url: &str, body: &str) -> Result<Route, u16> {
    let path = url.split('?').next().unwrap_or(url);
    let (target, path) = if let Some(rest) = path.strip_prefix("/presets/") {
        let (id, rest) = rest.split_once('/').ok_or(404u16)?;
        if id.is_empty()
            || !id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err(404);
        }
        (Target::Preset(id.into()), format!("/{rest}"))
    } else if path == "/presets" {
        return Err(404);
    } else {
        (Target::Main, path.to_string())
    };
    let kind = match path.as_str() {
        // Deprecated: removed in v0.6.0. Use POST /signals.
        "/agent-event" => {
            RouteKind::AgentEvent(cap_detail(cap_summary(parse_request(method, &path, body)?)))
        }
        "/signals" => {
            let request = parse_signals_request(method, &path, body)?;
            RouteKind::Signals(SignalsPayload {
                signals: request.signals,
                envelope: request.envelope.ok_or(400u16)?,
                ts: epoch_ms(),
            })
        }
        "/avatar/state" | "/avatar/perch-targets" | "/avatar/command" | "/relations" => {
            RouteKind::Avatar(parse_avatar_request(method, &path, body)?)
        }
        _ => {
            return Err(
                if matches!(target, Target::Preset(_)) || path.starts_with("/avatar/") {
                    404
                } else {
                    400
                },
            )
        }
    };
    Ok(Route { target, kind })
}

/// Resolves open windows first and checks registry membership only when needed.
pub(super) fn resolve_target(
    target: &Target,
    window_exists: bool,
    is_known: impl Fn(&str) -> Result<bool, u16>,
) -> Result<String, u16> {
    match target {
        Target::Main => Ok(INGRESS_WINDOW.into()),
        Target::Preset(id) if window_exists => Ok(pet_label(id)),
        Target::Preset(id) => Err(if is_known(id)? { 503 } else { 404 }),
    }
}

/// The resolved window label and payload to emit.
#[derive(Debug)]
pub(super) struct Dispatch {
    pub label: String,
    pub kind: RouteKind,
}

/// Parses and resolves a request through injected window and registry lookups. A relations
/// body may only name `user` and preset ids the registry holds.
pub(super) fn dispatch(
    method: &str,
    url: &str,
    body: &str,
    is_known: impl Fn(&str) -> Result<bool, u16>,
    window_exists: impl Fn(&str) -> bool,
) -> Result<Dispatch, u16> {
    let route = parse_route(method, url, body)?;
    let exists = match &route.target {
        Target::Main => false,
        Target::Preset(id) => window_exists(&pet_label(id)),
    };
    let label = resolve_target(&route.target, exists, &is_known)?;
    if let RouteKind::Avatar(AvatarRoute::RelationsPut(body)) = &route.kind {
        for key in body
            .as_object()
            .into_iter()
            .flat_map(|records| records.keys())
        {
            if key != "user" && !is_known(key)? {
                return Err(400);
            }
        }
    }
    Ok(Dispatch {
        label,
        kind: route.kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
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
            ("GET", "/relations", ""),
            (
                "PUT",
                "/relations",
                r#"{"user":{"value":1,"updated_at":1,"log":[]}}"#,
            ),
        ] {
            assert!(matches!(
                parse_route(method, path, body).unwrap().target,
                Target::Main
            ));
            let route =
                parse_route(method, &format!("/presets/abc12345{path}?probe=1"), body).unwrap();
            assert!(matches!(route.target, Target::Preset(ref id) if id == "abc12345"));
            let url = format!("/presets/abc12345{path}");
            let ids = HashSet::<String>::new();
            assert_eq!(
                dispatch(method, &url, body, |id| Ok(ids.contains(id)), |_| false).unwrap_err(),
                404
            );
            assert_eq!(
                dispatch(
                    method,
                    &url,
                    body,
                    |id| Ok(ids.contains(id)),
                    |label| label == "pet-abc12345"
                )
                .unwrap()
                .label,
                "pet-abc12345"
            );
            let ids = HashSet::<String>::from(["abc12345".into()]);
            assert_eq!(
                dispatch(method, &url, body, |id| Ok(ids.contains(id)), |_| false).unwrap_err(),
                503
            );
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
    fn prefixed_agent_event_caps_summary() {
        let body = serde_json::json!({"tool":"test", "project":"test", "cwd":"/tmp", "phase":"done", "summary":"a".repeat(9000), "ts":0}).to_string();
        let route = parse_route("POST", "/presets/x/agent-event", &body).unwrap();
        let RouteKind::AgentEvent(payload) = route.kind else {
            panic!("expected agent event")
        };
        assert!(payload.summary.ends_with("[truncated]"));
        assert_eq!(payload.summary.len(), 8192 + "…[truncated]".len());
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
        let record = r#"{"value":1,"updated_at":1,"log":[]}"#;
        let known = |id: &str| Ok(id == "aaaa0001");
        assert_eq!(
            dispatch(
                "PUT",
                "/relations",
                &format!(r#"{{"ghost":{record}}}"#),
                known,
                |_| false
            )
            .unwrap_err(),
            400
        );
    }
    #[test]
    fn rejects_the_whole_request_when_a_signal_item_exceeds_16_kib() {
        fn item(bytes: usize) -> serde_json::Value {
            let item = serde_json::json!({ "s": "x".repeat(bytes - 8) });
            assert_eq!(serde_json::to_vec(&item).unwrap().len(), bytes);
            item
        }
        for path in ["/signals", "/presets/abc12345/signals"] {
            let over = serde_json::json!({
                "signals": [{ "kind": "small" }, item(16 * 1024 + 1)],
                "envelope": { "event_id": "run-1" }
            });
            assert_eq!(
                parse_route("POST", path, &over.to_string()).unwrap_err(),
                400,
                "{path}"
            );
            let at_cap = serde_json::json!({
                "signals": [item(16 * 1024)],
                "envelope": { "event_id": "run-1" }
            });
            assert!(
                parse_route("POST", path, &at_cap.to_string()).is_ok(),
                "{path}"
            );
        }
    }
    #[test]
    fn dispatches_a_valid_relations_put_to_main() {
        let record = r#"{"value":1,"updated_at":1,"log":[]}"#;
        let known = |id: &str| Ok(id == "aaaa0001");
        assert_eq!(
            dispatch(
                "PUT",
                "/relations",
                &format!(r#"{{"user":{record},"aaaa0001":{record}}}"#),
                known,
                |_| false
            )
            .unwrap()
            .label,
            "main"
        );
    }
    #[test]
    fn resolves_by_window_then_registry_without_main_fallback() {
        let mut ids = HashSet::<String>::new();
        let target = Target::Preset("abc12345".into());
        assert_eq!(
            resolve_target(&target, true, |_| panic!("open windows need no registry")),
            Ok("pet-abc12345".into())
        );
        assert_eq!(
            resolve_target(&target, false, |id| Ok(ids.contains(id))),
            Err(404)
        );
        ids.insert("abc12345".into());
        assert_eq!(
            resolve_target(&target, false, |id| Ok(ids.contains(id))),
            Err(503)
        );
        assert_eq!(
            resolve_target(&Target::Main, false, |_| panic!("main needs no registry")),
            Ok("main".into())
        );
    }
}
