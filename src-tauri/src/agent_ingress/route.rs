use super::payload::{
    cap_detail, cap_summary, parse_avatar_request, parse_request, parse_signals_request,
    AgentEventPayload, AvatarRoute, SignalsPayload,
};
use crate::os_event_watcher::epoch_ms;
use std::collections::HashSet;

#[derive(Debug)]
pub(super) enum Target {
    Main,
    Preset(String),
}
#[derive(Debug)]
pub(super) enum RouteKind {
    AgentEvent(AgentEventPayload),
    Signals(SignalsPayload),
    Avatar(AvatarRoute),
}
#[derive(Debug)]
pub(super) struct Route {
    pub target: Target,
    pub kind: RouteKind,
}

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
        "/avatar/state" | "/avatar/perch-targets" | "/avatar/command" => {
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

pub(super) fn resolve_target(
    target: &Target,
    window_exists: bool,
    ids: &HashSet<String>,
) -> Result<String, u16> {
    match target {
        Target::Main => Ok("main".into()),
        Target::Preset(id) if window_exists => Ok(format!("pet-{id}")),
        Target::Preset(id) if ids.contains(id) => Err(503),
        Target::Preset(_) => Err(404),
    }
}

#[derive(Debug)]
pub(super) struct Dispatch {
    pub label: String,
    pub kind: RouteKind,
}

pub(super) fn dispatch(
    method: &str,
    url: &str,
    body: &str,
    ids: &HashSet<String>,
    window_exists: impl Fn(&str) -> bool,
) -> Result<Dispatch, u16> {
    let route = parse_route(method, url, body)?;
    let exists = match &route.target {
        Target::Main => false,
        Target::Preset(id) => window_exists(&format!("pet-{id}")),
    };
    Ok(Dispatch {
        label: resolve_target(&route.target, exists, ids)?,
        kind: route.kind,
    })
}

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
            assert_eq!(
                dispatch(method, &url, body, &ids, |_| false).unwrap_err(),
                404
            );
            assert_eq!(
                dispatch(method, &url, body, &ids, |label| label == "pet-abc12345")
                    .unwrap()
                    .label,
                "pet-abc12345"
            );
            let ids = HashSet::from(["abc12345".into()]);
            assert_eq!(
                dispatch(method, &url, body, &ids, |_| false).unwrap_err(),
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
