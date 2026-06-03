//! OS event watcher — Tauri main(Rust) 측 OS API 접근 전담 stub.
//!
//! 근거: docs/event-dispatcher.md §1 (Process Boundary), §3.3 (os_event_watcher),
//!       §10 (Rust → Webview handoff `os_event` channel).
//!
//! 이 모듈은 **시그니처/배선만** 제공하는 placeholder다. 실제 OS API 호출
//! (active app / OS-wide idle / fullscreen / camera)과 emit 로직은 **M1**에서 구현한다.
//! 지금 목표는 `cargo check` 통과 + IPC contract 형태를 코드로 박아두는 것.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Rust → Webview 단방향 IPC 채널 이름 (event-dispatcher.md §1/§10).
pub const OS_EVENT_CHANNEL: &str = "os_event";

/// `os_event` 채널 payload — event-dispatcher.md §10 "Rust → Webview" handoff와 1:1.
///
/// Webview(TS)는 이 payload를 받아 event_bus envelope로 정규화한다.
/// 필드 명명은 spec의 `data` 블록을 그대로 따른다.
#[derive(Debug, Clone, Serialize)]
pub struct OsEventPayload {
    /// "active_app_changed" | "window_focus_changed" | "fullscreen_entered"
    /// | "fullscreen_exited" | "os_idle_tick" | "camera_in_use"
    pub event_name: String,
    /// client epoch ms.
    pub ts: i64,
    pub data: OsEventData,
}

/// event-dispatcher.md §10 `data` 블록. 전부 optional — 각 event_name이 채우는 필드가 다르다.
#[derive(Debug, Clone, Default, Serialize)]
pub struct OsEventData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_fullscreen: Option<bool>,
    /// OS-wide idle (ms). macOS `CGEventSourceSecondsSinceLastEventType` 등 (A1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_idle_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_in_use: Option<bool>,
}

/// Webview로 OS event 한 건을 emit한다 (fire-and-forget, event-dispatcher.md §10).
///
/// TODO(M1): 실제 호출부에서 OS 폴링 결과를 payload로 만들어 이 함수로 흘린다.
#[allow(dead_code)]
pub fn emit_os_event(app: &AppHandle, payload: OsEventPayload) -> tauri::Result<()> {
    app.emit(OS_EVENT_CHANNEL, payload)
}

/// OS 감시 루프 시작 — Tauri `setup`에서 1회 호출 예정.
///
/// TODO(M1): 아래를 백그라운드 task/thread로 구현 (event-dispatcher.md §3.3, A1/A2/A5):
///   - active app / active window title 변경 감지 (debounce 5s) → `active_app_changed`
///   - 5s 주기 OS-wide idle 보고 → `os_idle_tick` (macOS/Win/Linux capability table)
///   - fullscreen 진입/종료 → `fullscreen_entered` / `fullscreen_exited`
///   - camera 사용 best-effort → `camera_in_use`
/// 현재는 no-op (컴파일만 통과).
#[allow(dead_code)]
pub fn start(_app: &AppHandle) {
    // TODO(M1): spawn OS polling loop and call `emit_os_event` per detected change.
}
