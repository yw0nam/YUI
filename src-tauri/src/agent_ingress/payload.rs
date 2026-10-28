use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::time::Duration;

pub const SIGNALS_INBOX_CHANNEL: &str = "signals-inbox";
pub const AVATAR_RPC_CHANNEL: &str = "avatar-rpc";
pub const INGRESS_DEAD_CHANNEL: &str = "ingress-dead";

/// Deadline for a webview answer to a read-only avatar query.
const AVATAR_QUERY_TIMEOUT: Duration = Duration::from_secs(2);
/// Deadline for a webview answer to an avatar command — a gesture takes real time.
const AVATAR_COMMAND_TIMEOUT: Duration = Duration::from_secs(15);

/// Hard body read ceiling; prevents OOM on oversized payloads.
pub(super) const BODY_CEILING_BYTES: usize = 65536;
/// One signal item's ceiling; a request holding a larger item is refused whole.
const ITEM_CEILING_BYTES: usize = 16 * 1024;

/// The `/relations` record limits, as `docs/reference/signals-ingress.md` states them.
const VALUE_RANGE: std::ops::RangeInclusive<i64> = -20..=20;
const DELTA_RANGE: std::ops::RangeInclusive<i64> = -40..=40;
const LOG_LENGTH: usize = 20;
const WHY_CHARS: usize = 80;
const NOTE_CHARS: usize = 200;

/// `signals-inbox` event payload — fired when the remote n8n workflow posts to
/// `/signals`. `signals` is treated as opaque JSON; the client does not
/// interpret its contents. An `envelope` is required.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct SignalsPayload {
    pub signals: Vec<serde_json::Value>,
    pub envelope: serde_json::Value,
    pub ts: i64, // server epoch ms — n8n does not send a timestamp
}

/// Wire shape of a `/signals` POST body, before the server stamps `ts`.
#[derive(Deserialize, Debug)]
pub(super) struct SignalsRequest {
    pub(super) signals: Vec<serde_json::Value>,
    pub(super) envelope: Option<serde_json::Value>,
}

/// Side of a window the avatar peeks from.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PeekSide {
    Left,
    Right,
}

/// Named screen spot `move_to` targets.
#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MoveSpot {
    Center,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Body of a `/avatar/command` POST. The verb set is closed: anything else is a 400.
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum AvatarCommand {
    SitOnWindow {
        app: String,
    },
    Peek {
        side: PeekSide,
    },
    MoveTo {
        spot: MoveSpot,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        monitor: Option<u32>,
    },
    Stand,
    GoToBed,
}

/// One logged change of a `/relations` record.
#[derive(Deserialize, Serialize, Debug)]
#[serde(deny_unknown_fields)]
struct RelationChange {
    at: u64,
    delta: i64,
    why: String,
}

/// One target's record in a `/relations` body.
#[derive(Deserialize, Serialize, Debug)]
#[serde(deny_unknown_fields)]
struct RelationRecord {
    value: i64,
    updated_at: u64,
    log: Vec<RelationChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

impl RelationRecord {
    fn in_range(&self) -> bool {
        VALUE_RANGE.contains(&self.value)
            && self.log.len() <= LOG_LENGTH
            && self
                .note
                .as_ref()
                .is_none_or(|n| n.chars().count() <= NOTE_CHARS)
            && self.log.iter().all(|c| {
                c.delta != 0 && DELTA_RANGE.contains(&c.delta) && c.why.chars().count() <= WHY_CHARS
            })
    }
}

/// Validates a `PUT /relations` body; `Err(400)` for a shape or range the contract refuses.
fn parse_relations(body: &str) -> Result<serde_json::Value, u16> {
    let records: BTreeMap<String, RelationRecord> =
        serde_json::from_str(body).map_err(|_| 400u16)?;
    if !records.values().all(RelationRecord::in_range) {
        return Err(400);
    }
    serde_json::to_value(records).map_err(|_| 400u16)
}

/// A parsed `/avatar/*` or `/relations` request, ready to bridge into the webview.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum AvatarRoute {
    State,
    PerchTargets,
    Command(AvatarCommand),
    RelationsGet,
    /// The validated body that replaces the window's relation store.
    RelationsPut(serde_json::Value),
}

impl AvatarRoute {
    /// RPC method name + params carried by the `avatar-rpc` event.
    pub(super) fn into_rpc(self) -> (&'static str, Option<serde_json::Value>) {
        match self {
            AvatarRoute::State => ("state", None),
            AvatarRoute::PerchTargets => ("perch_targets", None),
            AvatarRoute::Command(cmd) => ("command", serde_json::to_value(cmd).ok()),
            AvatarRoute::RelationsGet => ("relations_get", None),
            AvatarRoute::RelationsPut(body) => ("relations_put", Some(body)),
        }
    }

    pub(super) fn timeout(&self) -> Duration {
        match self {
            AvatarRoute::Command(_) => AVATAR_COMMAND_TIMEOUT,
            _ => AVATAR_QUERY_TIMEOUT,
        }
    }
}

/// `avatar-rpc` event payload — one in-flight request the webview must answer by id.
#[derive(Serialize, Clone, Debug)]
pub struct AvatarRpcRequest {
    pub id: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/// Validates and parses a raw HTTP request into a `signals` array and its
/// `envelope`.
///
/// Returns `Err(405)` when the method is not POST, and `Err(400)` when the path
/// (before any query string) is not `/signals`, the body is not valid JSON
/// shaped `{"signals": [...]}`, the `envelope` is missing or null, or an item
/// exceeds `ITEM_CEILING_BYTES`. Each element of `signals` is passed through as
/// opaque JSON.
pub(super) fn parse_signals_request(
    method: &str,
    path: &str,
    body: &str,
) -> Result<SignalsRequest, u16> {
    if method != "POST" {
        return Err(405);
    }
    let path_only = path.split('?').next().unwrap_or(path);
    if path_only != "/signals" {
        return Err(400);
    }
    let request = serde_json::from_str::<SignalsRequest>(body).map_err(|_| 400u16)?;
    request.envelope.as_ref().ok_or(400u16)?;
    for item in &request.signals {
        let bytes = serde_json::to_vec(item).map_err(|_| 400u16)?;
        if bytes.len() > ITEM_CEILING_BYTES {
            return Err(400);
        }
    }
    Ok(request)
}

/// Validates and parses a raw HTTP request into an `AvatarRoute`.
///
/// Returns `Err(405)` for a known `/avatar/*` or `/relations` path with the wrong method,
/// `Err(404)` for an unknown `/avatar/*` path, and `Err(400)` when the command or relations
/// body does not fit the route.
pub(super) fn parse_avatar_request(
    method: &str,
    path: &str,
    body: &str,
) -> Result<AvatarRoute, u16> {
    let path_only = path.split('?').next().unwrap_or(path);
    match path_only {
        "/avatar/state" => method_gate(method, "GET").map(|()| AvatarRoute::State),
        "/avatar/perch-targets" => method_gate(method, "GET").map(|()| AvatarRoute::PerchTargets),
        "/avatar/command" => method_gate(method, "POST").and_then(|()| {
            serde_json::from_str::<AvatarCommand>(body)
                .map(AvatarRoute::Command)
                .map_err(|_| 400u16)
        }),
        "/relations" => match method {
            "GET" => Ok(AvatarRoute::RelationsGet),
            "PUT" => parse_relations(body).map(AvatarRoute::RelationsPut),
            _ => Err(405),
        },
        _ => Err(404),
    }
}

fn method_gate(method: &str, expected: &str) -> Result<(), u16> {
    if method == expected {
        Ok(())
    } else {
        Err(405)
    }
}

/// A method mismatch on an existing path is routine (reachability probes); other rejections are not.
pub(super) fn rejected_level(code: u16) -> log::Level {
    if code == 405 {
        log::Level::Debug
    } else {
        log::Level::Warn
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::os_event_watcher::epoch_ms;

    // ── parse_signals_request ─────────────────────────────────────────────────

    fn valid_signals_body() -> &'static str {
        r#"{"signals":[{"kind":"reminder","payload":{"foo":"bar"}},{"kind":"alert"}],"envelope":{"source":"n8n","event_type":"workflow_done","delivery":"batched","event_id":"run-1","occurred_at":1787449000000}}"#
    }

    #[test]
    fn parse_signals_request_valid_returns_signals() {
        let request = parse_signals_request("POST", "/signals", valid_signals_body()).unwrap();
        assert_eq!(request.signals.len(), 2);
        assert_eq!(request.signals[0]["kind"], "reminder");
        assert_eq!(request.signals[1]["kind"], "alert");
        assert_eq!(request.envelope.unwrap()["source"], "n8n");
    }

    #[test]
    fn parse_signals_request_wrong_method_returns_405() {
        assert_eq!(
            parse_signals_request("GET", "/signals", valid_signals_body()).unwrap_err(),
            405
        );
    }

    #[test]
    fn parse_signals_request_wrong_path_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/other", valid_signals_body()).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_signals_request_malformed_json_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/signals", "not json").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_signals_request_missing_signals_key_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/signals", r#"{"other":[]}"#).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_signals_request_path_with_query_string_is_accepted() {
        let request =
            parse_signals_request("POST", "/signals?foo=bar", valid_signals_body()).unwrap();
        assert_eq!(request.signals.len(), 2);
    }

    #[test]
    fn parse_signals_request_empty_array_is_accepted() {
        let request = parse_signals_request(
            "POST",
            "/signals",
            r#"{"signals":[],"envelope":{"source":"n8n","event_type":"workflow_done","delivery":"batched","event_id":"run-1","occurred_at":1787449000000}}"#,
        )
        .unwrap();
        assert!(request.signals.is_empty());
    }

    #[test]
    fn parse_signals_request_forwards_envelope_verbatim() {
        let request = parse_signals_request(
            "POST",
            "/signals",
            r#"{"signals":[{"id":1}],"envelope":{"source":"n8n","event_type":"workflow_done","delivery":"batched","event_id":"run-8812","occurred_at":1787449000000,"extra":{"opaque":true}}}"#,
        )
        .unwrap();
        assert_eq!(
            request.envelope.unwrap(),
            serde_json::json!({
                "source": "n8n",
                "event_type": "workflow_done",
                "delivery": "batched",
                "event_id": "run-8812",
                "occurred_at": 1787449000000_i64,
                "extra": { "opaque": true }
            })
        );
    }

    #[test]
    fn parse_signals_request_forwards_non_object_envelope_verbatim() {
        let request = parse_signals_request(
            "POST",
            "/signals",
            r#"{"signals":[{"id":1}],"envelope":"bad"}"#,
        )
        .unwrap();
        assert_eq!(request.envelope.unwrap(), serde_json::json!("bad"));
    }

    #[test]
    fn parse_signals_request_absent_envelope_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/signals", r#"{"signals":[{"id":1}]}"#).unwrap_err(),
            400u16
        );
    }

    #[test]
    fn parse_signals_request_null_envelope_returns_400() {
        assert_eq!(
            parse_signals_request(
                "POST",
                "/signals",
                r#"{"signals":[{"id":1}],"envelope":null}"#
            )
            .unwrap_err(),
            400u16
        );
    }

    // ── handle_request routing (/signals emits signals-inbox) ────────────────

    #[test]
    fn handle_request_routes_signals_and_stamps_ts() {
        let request = parse_signals_request("POST", "/signals", valid_signals_body()).unwrap();
        let payload = SignalsPayload {
            signals: request.signals,
            envelope: request.envelope.unwrap(),
            ts: epoch_ms(),
        };
        assert_eq!(payload.signals.len(), 2);
        assert!(payload.ts > 0);
    }

    #[test]
    fn unknown_path_returns_400() {
        assert_eq!(
            parse_signals_request("POST", "/unknown", valid_signals_body()).unwrap_err(),
            400
        );
    }

    // ── parse_avatar_request ─────────────────────────────────────────────────

    #[test]
    fn parse_avatar_state_requires_get() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/state", "").unwrap(),
            AvatarRoute::State
        );
        assert_eq!(
            parse_avatar_request("POST", "/avatar/state", "").unwrap_err(),
            405
        );
    }

    #[test]
    fn parse_avatar_perch_targets_requires_get() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/perch-targets", "").unwrap(),
            AvatarRoute::PerchTargets
        );
        assert_eq!(
            parse_avatar_request("POST", "/avatar/perch-targets", "").unwrap_err(),
            405
        );
    }

    #[test]
    fn parse_avatar_query_path_with_query_string_is_accepted() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/state?foo=bar", "").unwrap(),
            AvatarRoute::State
        );
    }

    #[test]
    fn parse_avatar_unknown_path_returns_404() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/nope", "").unwrap_err(),
            404
        );
    }

    #[test]
    fn parse_avatar_known_path_wrong_method_returns_405() {
        // The route exists, the method does not — a method mismatch, not a missing resource.
        assert_eq!(
            parse_avatar_request("DELETE", "/avatar/state", "").unwrap_err(),
            405
        );
    }

    #[test]
    fn parse_avatar_command_requires_post() {
        assert_eq!(
            parse_avatar_request("GET", "/avatar/command", r#"{"action":"stand"}"#).unwrap_err(),
            405
        );
    }

    #[test]
    fn parse_avatar_command_sit_on_window() {
        let route = parse_avatar_request(
            "POST",
            "/avatar/command",
            r#"{"action":"sit_on_window","app":"Notes"}"#,
        )
        .unwrap();
        assert_eq!(
            route,
            AvatarRoute::Command(AvatarCommand::SitOnWindow {
                app: "Notes".into()
            })
        );
    }

    #[test]
    fn parse_avatar_command_peek_sides() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"peek","side":"left"}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::Peek {
                side: PeekSide::Left
            })
        );
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"peek","side":"right"}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::Peek {
                side: PeekSide::Right
            })
        );
    }

    #[test]
    fn parse_avatar_command_rejects_unknown_peek_side() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"peek","side":"up"}"#
            )
            .unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_move_to_with_and_without_monitor() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"move_to","spot":"center"}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::MoveTo {
                spot: MoveSpot::Center,
                monitor: None
            })
        );
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"move_to","spot":"bottom-right","monitor":1}"#
            )
            .unwrap(),
            AvatarRoute::Command(AvatarCommand::MoveTo {
                spot: MoveSpot::BottomRight,
                monitor: Some(1)
            })
        );
    }

    #[test]
    fn parse_avatar_command_rejects_unknown_spot() {
        assert_eq!(
            parse_avatar_request(
                "POST",
                "/avatar/command",
                r#"{"action":"move_to","spot":"middle"}"#
            )
            .unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_stand() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"stand"}"#).unwrap(),
            AvatarRoute::Command(AvatarCommand::Stand)
        );
    }

    #[test]
    fn parse_avatar_command_go_to_bed() {
        let route =
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"go_to_bed"}"#).unwrap();
        assert_eq!(route, AvatarRoute::Command(AvatarCommand::GoToBed));
        let (method, params) = route.into_rpc();
        assert_eq!(method, "command");
        assert_eq!(params.unwrap()["action"], "go_to_bed");
    }

    #[test]
    fn parse_avatar_command_rejects_unknown_action() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"dance"}"#).unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_rejects_malformed_json() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", "not json").unwrap_err(),
            400
        );
    }

    #[test]
    fn parse_avatar_command_rejects_missing_app() {
        assert_eq!(
            parse_avatar_request("POST", "/avatar/command", r#"{"action":"sit_on_window"}"#)
                .unwrap_err(),
            400
        );
    }

    // ── rejected_level ──────────────────────────────────────────────────

    #[test]
    fn rejected_level_is_debug_for_a_method_mismatch_and_warn_otherwise() {
        assert_eq!(rejected_level(405), log::Level::Debug);
        assert_eq!(rejected_level(400), log::Level::Warn);
        assert_eq!(rejected_level(404), log::Level::Warn);
    }

    // ── RPC request payload ───────────────────────────────────────────────────

    const RELATIONS_BODY: &str = r#"{"user":{"value":5,"updated_at":1787449000000,"log":[{"at":1787449000000,"delta":2,"why":"asked how my day was before the bug"}]},"aaaa0001":{"value":-6,"updated_at":1787430000000,"log":[],"note":"trusts the work, doubts the promises"}}"#;

    #[test]
    fn parse_avatar_relations_get_and_put() {
        assert_eq!(
            parse_avatar_request("GET", "/relations", "").unwrap(),
            AvatarRoute::RelationsGet
        );
        assert_eq!(
            parse_avatar_request("PUT", "/relations", RELATIONS_BODY).unwrap(),
            AvatarRoute::RelationsPut(serde_json::from_str(RELATIONS_BODY).unwrap())
        );
        assert_eq!(
            parse_avatar_request("POST", "/relations", RELATIONS_BODY).unwrap_err(),
            405
        );
    }

    #[test]
    fn parse_avatar_relations_put_rejects_out_of_range() {
        use serde_json::json;
        let change = |delta: i64, why: String| json!({"at": 1, "delta": delta, "why": why});
        let at_limits = json!({"user": {"value": -20, "updated_at": 1,
            "log": vec![change(-40, "x".repeat(80)); 20], "note": "x".repeat(200)}});
        assert!(parse_avatar_request("PUT", "/relations", &at_limits.to_string()).is_ok());
        for body in [
            json!({"user": {"value": 25, "updated_at": 1, "log": []}}),
            json!({"user": {"value": 1, "updated_at": 1, "log": [change(41, "x".into())]}}),
            json!({"user": {"value": 1, "updated_at": 1, "log": [change(0, "x".into())]}}),
            json!({"user": {"value": 1, "updated_at": 1, "log": [change(1, "x".repeat(81))]}}),
            json!({"user": {"value": 1, "updated_at": 1, "log": [], "note": "x".repeat(201)}}),
            json!({"user": {"value": 1, "updated_at": 1, "log": vec![change(1, "x".into()); 21]}}),
            json!({"user": {"value": 1, "updated_at": 1, "log": [], "mood": "x"}}),
            json!("x"),
        ] {
            assert_eq!(
                parse_avatar_request("PUT", "/relations", &body.to_string()).unwrap_err(),
                400,
                "{body}"
            );
        }
    }

    #[test]
    fn avatar_route_maps_to_method_and_params() {
        let (method, params) = AvatarRoute::State.into_rpc();
        assert_eq!(method, "state");
        assert!(params.is_none());

        let (method, params) = AvatarRoute::PerchTargets.into_rpc();
        assert_eq!(method, "perch_targets");
        assert!(params.is_none());

        let (method, params) = AvatarRoute::Command(AvatarCommand::Peek {
            side: PeekSide::Right,
        })
        .into_rpc();
        assert_eq!(method, "command");
        let params = params.unwrap();
        assert_eq!(params["action"], "peek");
        assert_eq!(params["side"], "right");

        let (method, params) = AvatarRoute::RelationsGet.into_rpc();
        assert_eq!(method, "relations_get");
        assert!(params.is_none());

        let body: serde_json::Value = serde_json::from_str(RELATIONS_BODY).unwrap();
        let (method, params) = AvatarRoute::RelationsPut(body.clone()).into_rpc();
        assert_eq!(method, "relations_put");
        assert_eq!(params, Some(body));
    }

    #[test]
    fn avatar_route_timeout_is_shorter_for_queries() {
        assert_eq!(AvatarRoute::State.timeout(), AVATAR_QUERY_TIMEOUT);
        assert_eq!(AvatarRoute::PerchTargets.timeout(), AVATAR_QUERY_TIMEOUT);
        assert_eq!(
            AvatarRoute::Command(AvatarCommand::Stand).timeout(),
            AVATAR_COMMAND_TIMEOUT
        );
        assert!(AVATAR_QUERY_TIMEOUT < AVATAR_COMMAND_TIMEOUT);
    }

    #[test]
    fn move_to_params_omit_absent_monitor() {
        let (_, params) = AvatarRoute::Command(AvatarCommand::MoveTo {
            spot: MoveSpot::TopLeft,
            monitor: None,
        })
        .into_rpc();
        let params = params.unwrap();
        assert_eq!(params["spot"], "top-left");
        assert!(params.get("monitor").is_none());
    }
}
