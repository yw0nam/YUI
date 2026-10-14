//! The CDP session with the owned Chrome: the connection, the controlled tab, snapshots and page actions.

use super::args::{Request, Target};
use super::gate::{Halt, Instant, Op};
use super::keys::{releases, KeyEvent};
use super::lifecycle::{Launched, OwnedChild, ProfileLock};
use super::outcome::{
    setup_failed, unknown, untrusted, DONE_NO_SNAPSHOT, PAGE_CHANGED, SETUP_FAILED, STALE_REF,
};
use super::snapshot::{build, interactive_count, AxItem, RefEntry, RefTable};
use chromiumoxide::cdp::browser_protocol::accessibility::{
    AxNode, AxPropertyName, AxValue, GetFullAxTreeParams, GetPartialAxTreeParams,
};
use chromiumoxide::cdp::browser_protocol::browser::{
    SetDownloadBehaviorBehavior, SetDownloadBehaviorParams,
};
use chromiumoxide::cdp::browser_protocol::dom::{
    BackendNodeId, DescribeNodeParams, FocusParams, GetContentQuadsParams, ResolveNodeParams,
    ScrollIntoViewIfNeededParams,
};
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchMouseEventParams, DispatchMouseEventType, InsertTextParams, MouseButton,
};
use chromiumoxide::cdp::browser_protocol::page::{
    EventFrameDetached, EventFrameNavigated, GetFrameTreeParams, NavigateParams,
};
use chromiumoxide::cdp::browser_protocol::target::{
    EventTargetCrashed, EventTargetDestroyed, TargetId,
};
use chromiumoxide::cdp::js_protocol::runtime::{CallArgument, CallFunctionOnParams};
use chromiumoxide::handler::HandlerConfig;
use chromiumoxide::listeners::EventStream;
use chromiumoxide::types::Command;
use chromiumoxide::{Browser, Page};
use futures::StreamExt;
use serde_json::Value;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const CLOSE_BOUND: Duration = Duration::from_secs(2);
const EXIT_GRACE: Duration = Duration::from_secs(3);
const OPEN_SETTLE: Duration = Duration::from_secs(15);
const ACTION_SETTLE: Duration = Duration::from_secs(5);
/// Spacing of the stabilization reads; the prototype measured stable counts with 700 ms.
const SETTLE_POLL: Duration = Duration::from_millis(700);
/// Left before the work deadline for the last read of a settle loop.
const SNAPSHOT_RESERVE: Duration = Duration::from_secs(1);
const RELEASE_BOUND: Duration = Duration::from_millis(500);

/// Selects the element's content so inserted text replaces it; `clear` deletes it instead.
const SELECT_CONTENTS: &str = "function (clear) {
  if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
    this.select();
  } else {
    const range = document.createRange();
    range.selectNodeContents(this);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (clear) document.execCommand('delete');
}";

enum Fail {
    Halt(Halt),
    Cdp,
    Stale,
    PageChanged,
}

impl From<Halt> for Fail {
    fn from(halt: Halt) -> Self {
        Fail::Halt(halt)
    }
}

/// A failure while resolving a ref: anything but a halt means the element is not the one captured.
fn stale(fail: Fail) -> Fail {
    match fail {
        Fail::Halt(halt) => Fail::Halt(halt),
        _ => Fail::Stale,
    }
}

/// Whether a click cut after its first `completed` steps (move, press, release) may have left the button down.
fn mouse_pressed(completed: usize) -> bool {
    completed >= 1
}

/// A failure after the effect started.
fn interrupted(op: &Op, fail: Fail) -> String {
    match fail {
        Fail::Halt(halt) => op.halted(halt),
        _ => unknown(op.action()),
    }
}

async fn call<T: Command>(op: &Op, page: &Page, command: T) -> Result<T::Response, Fail> {
    match op.guard(page.execute(command)).await? {
        Ok(response) => Ok(response.result),
        Err(_) => Err(Fail::Cdp),
    }
}

fn lock(refs: &Mutex<RefTable>) -> MutexGuard<'_, RefTable> {
    refs.lock().unwrap_or_else(|e| e.into_inner())
}

fn ax_string(value: &Option<AxValue>) -> String {
    value
        .as_ref()
        .and_then(|v| v.value.as_ref())
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn ax_true(value: &AxValue) -> bool {
    match &value.value {
        Some(Value::Bool(on)) => *on,
        Some(Value::String(s)) => s == "true",
        _ => false,
    }
}

fn ax_item(node: &AxNode) -> AxItem {
    let mut item = AxItem {
        role: ax_string(&node.role),
        name: ax_string(&node.name),
        ignored: node.ignored,
        backend_id: node.backend_dom_node_id.map(|id| *id.inner()),
        frame: node.frame_id.as_ref().map(|f| f.inner().clone()),
        ..AxItem::default()
    };
    for property in node.properties.iter().flatten() {
        let on = ax_true(&property.value);
        match property.name {
            AxPropertyName::Focused => item.focused = on,
            AxPropertyName::Checked => item.checked = on,
            AxPropertyName::Disabled => item.disabled = on,
            AxPropertyName::Expanded => item.expanded = on,
            _ => {}
        }
    }
    item
}

struct Capture {
    loader: String,
    url: String,
    items: Vec<AxItem>,
}

/// The controlled tab; its watcher keeps the ref table fresh and fires `gone` when the tab ends.
struct Tab {
    page: Page,
    page_id: String,
    refs: Arc<Mutex<RefTable>>,
    gone: CancellationToken,
    watcher: JoinHandle<()>,
}

async fn watch_tab(
    id: TargetId,
    refs: Arc<Mutex<RefTable>>,
    gone: CancellationToken,
    mut navigated: EventStream<EventFrameNavigated>,
    mut detached: EventStream<EventFrameDetached>,
    mut destroyed: EventStream<EventTargetDestroyed>,
    mut crashed: EventStream<EventTargetCrashed>,
) {
    loop {
        tokio::select! {
            Some(event) = navigated.next() => {
                if event.frame.parent_id.is_none() {
                    lock(&refs).on_main_navigation(event.frame.loader_id.inner());
                }
            }
            Some(event) = detached.next() => lock(&refs).drop_frame(event.frame_id.inner()),
            Some(event) = destroyed.next() => {
                if event.target_id == id {
                    break;
                }
            }
            Some(event) = crashed.next() => {
                if event.target_id == id {
                    break;
                }
            }
            else => break,
        }
    }
    lock(&refs).clear();
    gone.cancel();
}

impl Tab {
    async fn main_frame(&self, op: &Op) -> Result<(String, String), Fail> {
        let frame = call(op, &self.page, GetFrameTreeParams::default())
            .await?
            .frame_tree
            .frame;
        let url = frame.url + frame.url_fragment.as_deref().unwrap_or_default();
        Ok((frame.loader_id.inner().clone(), url))
    }

    /// Reads the accessibility tree between two equal main-frame records, retaking once.
    async fn capture(&self, op: &Op) -> Result<Capture, Fail> {
        for _ in 0..2 {
            let before = self.main_frame(op).await?;
            let tree = call(op, &self.page, GetFullAxTreeParams::default()).await?;
            if self.main_frame(op).await? == before {
                let (loader, url) = before;
                let items = tree.nodes.iter().map(ax_item).collect();
                return Ok(Capture { loader, url, items });
            }
        }
        Err(Fail::PageChanged)
    }

    fn publish(&self, capture: &Capture, revision: &mut u64) -> String {
        *revision += 1;
        let built = build(
            &self.page_id,
            *revision,
            &capture.loader,
            &capture.url,
            &capture.items,
        );
        *lock(&self.refs) = built.refs;
        untrusted(&built.json)
    }

    async fn read(&self, op: &Op, revision: &mut u64) -> String {
        match self.capture(op).await {
            Ok(capture) => self.publish(&capture, revision),
            Err(Fail::Halt(halt)) => op.halted(halt),
            Err(_) => PAGE_CHANGED.to_string(),
        }
    }

    /// Re-reads until two consecutive reads of the wanted document give the same interactive count, or `limit` passes.
    async fn settle(
        &self,
        op: &Op,
        loader: Option<&str>,
        limit: Duration,
        revision: &mut u64,
    ) -> String {
        let latest = op
            .deadline()
            .checked_sub(SNAPSHOT_RESERVE)
            .unwrap_or_else(Instant::now);
        let until = (Instant::now() + limit).min(latest);
        let mut last: Option<(String, usize)> = None;
        loop {
            let capture = match self.capture(op).await {
                Ok(capture) => capture,
                Err(fail @ Fail::Halt(_)) => return interrupted(op, fail),
                Err(_) => return DONE_NO_SNAPSHOT.to_string(),
            };
            let wanted = loader.is_none_or(|l| l == capture.loader);
            let key = (capture.loader.clone(), interactive_count(&capture.items));
            if (wanted && last.as_ref() == Some(&key)) || Instant::now() + SETTLE_POLL >= until {
                return self.publish(&capture, revision);
            }
            last = wanted.then_some(key);
            if let Err(halt) = op.guard(tokio::time::sleep(SETTLE_POLL)).await {
                return op.halted(halt);
            }
        }
    }

    /// Resolves a ref against the current table and invalidates the table for the mutating action.
    fn take_ref(&self, target: &Target) -> Option<RefEntry> {
        let mut refs = lock(&self.refs);
        let entry = refs.resolve(&target.page_id, target.revision, &target.r#ref)?;
        refs.clear();
        Some(entry)
    }

    /// Checks that the captured node still exists with the captured role and name.
    async fn verify(&self, op: &Op, entry: &RefEntry) -> Result<BackendNodeId, Fail> {
        let id = BackendNodeId::new(entry.backend_id);
        let describe = DescribeNodeParams::builder().backend_node_id(id).build();
        call(op, &self.page, describe).await.map_err(stale)?;
        let partial = GetPartialAxTreeParams::builder()
            .backend_node_id(id)
            .fetch_relatives(false)
            .build();
        let tree = call(op, &self.page, partial).await.map_err(stale)?;
        let node = tree
            .nodes
            .iter()
            .find(|n| n.backend_dom_node_id == Some(id))
            .map(ax_item);
        match node {
            Some(node) if entry.same_identity(&node.role, &node.name) => Ok(id),
            _ => Err(Fail::Stale),
        }
    }

    async fn center(&self, op: &Op, id: BackendNodeId) -> Result<(f64, f64), Fail> {
        let scroll = ScrollIntoViewIfNeededParams::builder()
            .backend_node_id(id)
            .build();
        call(op, &self.page, scroll).await.map_err(stale)?;
        let quads = GetContentQuadsParams::builder().backend_node_id(id).build();
        let quads = call(op, &self.page, quads).await.map_err(stale)?.quads;
        match quads.first().map(|q| q.inner().as_slice()) {
            Some(&[x1, y1, x2, y2, x3, y3, x4, y4, ..]) => {
                Ok(((x1 + x2 + x3 + x4) / 4.0, (y1 + y2 + y3 + y4) / 4.0))
            }
            _ => Err(Fail::Stale),
        }
    }

    async fn open(&self, op: &mut Op, url: &str, revision: &mut u64) -> String {
        lock(&self.refs).clear();
        op.effect();
        let loader = match call(op, &self.page, NavigateParams::new(url)).await {
            Ok(navigated) => navigated.loader_id.map(|l| l.inner().clone()),
            Err(fail) => return interrupted(op, fail),
        };
        self.settle(op, loader.as_deref(), OPEN_SETTLE, revision)
            .await
    }

    fn mouse(kind: DispatchMouseEventType, x: f64, y: f64) -> DispatchMouseEventParams {
        let mut event = DispatchMouseEventParams::new(kind.clone(), x, y);
        if kind != DispatchMouseEventType::MouseMoved {
            event.button = Some(MouseButton::Left);
            event.click_count = Some(1);
        }
        event
    }

    async fn click(&self, op: &mut Op, target: &Target, revision: &mut u64) -> String {
        let Some(entry) = self.take_ref(target) else {
            return STALE_REF.to_string();
        };
        let point = match self.verify(op, &entry).await {
            Ok(id) => self.center(op, id).await,
            Err(fail) => Err(fail),
        };
        let (x, y) = match point {
            Ok(point) => point,
            Err(Fail::Halt(halt)) => return op.halted(halt),
            Err(_) => return STALE_REF.to_string(),
        };
        op.effect();
        let steps = [
            DispatchMouseEventType::MouseMoved,
            DispatchMouseEventType::MousePressed,
            DispatchMouseEventType::MouseReleased,
        ];
        for (completed, kind) in steps.into_iter().enumerate() {
            if let Err(fail) = call(op, &self.page, Self::mouse(kind, x, y)).await {
                if mouse_pressed(completed) {
                    let release = Self::mouse(DispatchMouseEventType::MouseReleased, x, y);
                    let _ = tokio::time::timeout(RELEASE_BOUND, self.page.execute(release)).await;
                }
                return interrupted(op, fail);
            }
        }
        self.settle(op, None, ACTION_SETTLE, revision).await
    }

    async fn type_text(
        &self,
        op: &mut Op,
        target: &Target,
        text: &str,
        revision: &mut u64,
    ) -> String {
        let Some(entry) = self.take_ref(target) else {
            return STALE_REF.to_string();
        };
        let resolved = match self.verify(op, &entry).await {
            Ok(id) => {
                let resolve = ResolveNodeParams::builder().backend_node_id(id).build();
                call(op, &self.page, resolve)
                    .await
                    .map(|r| (id, r.object.object_id))
                    .map_err(stale)
            }
            Err(fail) => Err(fail),
        };
        let (id, object_id) = match resolved {
            Ok((id, Some(object_id))) => (id, object_id),
            Err(Fail::Halt(halt)) => return op.halted(halt),
            _ => return STALE_REF.to_string(),
        };
        op.effect();
        let mut select = CallFunctionOnParams::new(SELECT_CONTENTS);
        select.object_id = Some(object_id);
        select.arguments = Some(vec![CallArgument {
            value: Some(Value::Bool(text.is_empty())),
            ..CallArgument::default()
        }]);
        let shared: &Op = op;
        let steps = async {
            let focus = FocusParams::builder().backend_node_id(id).build();
            call(shared, &self.page, focus).await?;
            let selected = call(shared, &self.page, select).await?;
            if selected.exception_details.is_some() {
                return Err(Fail::Cdp);
            }
            if !text.is_empty() {
                call(shared, &self.page, InsertTextParams::new(text)).await?;
            }
            Ok::<(), Fail>(())
        };
        if let Err(fail) = steps.await {
            return interrupted(op, fail);
        }
        self.settle(op, None, ACTION_SETTLE, revision).await
    }

    async fn press_key(&self, op: &mut Op, events: &[KeyEvent], revision: &mut u64) -> String {
        lock(&self.refs).clear();
        op.effect();
        for (completed, event) in events.iter().enumerate() {
            if let Err(fail) = call(op, &self.page, event.params()).await {
                for up in releases(events, completed) {
                    let _ =
                        tokio::time::timeout(RELEASE_BOUND, self.page.execute(up.params())).await;
                }
                return interrupted(op, fail);
            }
        }
        self.settle(op, None, ACTION_SETTLE, revision).await
    }
}

/// The owned Chrome: its process, profile lock, CDP connection and controlled tab.
pub struct Running {
    browser: Browser,
    handler: JoinHandle<()>,
    child: OwnedChild,
    closed: CancellationToken,
    lock: ProfileLock,
    session: u64,
    revision: u64,
    tab: Option<Tab>,
}

impl Running {
    /// Connects to the launched Chrome and denies downloads before any navigation.
    pub async fn start(op: &Op, launched: Launched, session: u64) -> Result<Self, String> {
        let Launched {
            child,
            lock,
            ws_url,
        } = launched;
        let config = HandlerConfig {
            ignore_https_errors: false,
            ..HandlerConfig::default()
        };
        let (browser, mut handler) =
            match op.guard(Browser::connect_with_config(ws_url, config)).await {
                Ok(Ok(connected)) => connected,
                Ok(Err(_)) => {
                    child.stop(Duration::ZERO).await;
                    return Err(setup_failed("connect"));
                }
                Err(halt) => {
                    child.stop(Duration::ZERO).await;
                    return Err(op.halted(halt));
                }
            };
        let closed = child.exited().child_token();
        let disconnected = closed.clone();
        let handler = tokio::spawn(async move {
            while let Some(Ok(())) = handler.next().await {}
            disconnected.cancel();
        });
        let running = Self {
            browser,
            handler,
            child,
            closed,
            lock,
            session,
            revision: 0,
            tab: None,
        };
        let deny = SetDownloadBehaviorParams::new(SetDownloadBehaviorBehavior::Deny);
        let failed = match op.guard(running.browser.execute(deny)).await {
            Ok(Ok(_)) => {
                log::info!("browser_launched pid={}", running.child.pid());
                return Ok(running);
            }
            Ok(Err(_)) => setup_failed("deny_downloads"),
            Err(halt) => op.halted(halt),
        };
        running.shutdown(false).await;
        Err(failed)
    }

    /// Fires when the owned process exits or the CDP connection fails.
    pub fn closed(&self) -> CancellationToken {
        self.closed.clone()
    }

    pub fn is_closed(&self) -> bool {
        self.closed.is_cancelled()
    }

    /// Closes the browser within a bound when `graceful`, waits for its exit only after a clean close, then kills
    /// and reaps the owned process and releases the profile lock.
    pub async fn shutdown(mut self, graceful: bool) {
        if let Some(tab) = self.tab.take() {
            tab.watcher.abort();
        }
        let graceful = graceful
            && !self.closed.is_cancelled()
            && matches!(
                tokio::time::timeout(CLOSE_BOUND, self.browser.close()).await,
                Ok(Ok(_))
            );
        let grace = if graceful { EXIT_GRACE } else { Duration::ZERO };
        let pid = self.child.pid();
        self.child.stop(grace).await;
        log::info!("browser_stopped pid={pid} graceful={graceful}");
        self.handler.abort();
        drop(self.lock);
    }

    async fn ensure_tab(&mut self, op: &Op) -> Result<(), Fail> {
        if let Some(tab) = self.tab.take_if(|t| t.gone.is_cancelled()) {
            tab.watcher.abort();
        }
        if self.tab.is_some() {
            return Ok(());
        }
        let page = op
            .guard(self.browser.new_page("about:blank"))
            .await?
            .map_err(|_| Fail::Cdp)?;
        let navigated = op
            .guard(page.event_listener())
            .await?
            .map_err(|_| Fail::Cdp)?;
        let detached = op
            .guard(page.event_listener())
            .await?
            .map_err(|_| Fail::Cdp)?;
        let destroyed = op
            .guard(self.browser.event_listener())
            .await?
            .map_err(|_| Fail::Cdp)?;
        let crashed = op
            .guard(self.browser.event_listener())
            .await?
            .map_err(|_| Fail::Cdp)?;
        let id = page.target_id().clone();
        let page_id = format!(
            "s{}-{}",
            self.session,
            id.inner().chars().take(12).collect::<String>()
        );
        let refs = Arc::new(Mutex::new(RefTable::default()));
        let gone = CancellationToken::new();
        let watcher = tokio::spawn(watch_tab(
            id,
            refs.clone(),
            gone.clone(),
            navigated,
            detached,
            destroyed,
            crashed,
        ));
        self.tab = Some(Tab {
            page,
            page_id,
            refs,
            gone,
            watcher,
        });
        Ok(())
    }

    /// Runs one request on the controlled tab, opening a tab first when there is none.
    pub async fn act(&mut self, op: &mut Op, request: Request) -> String {
        match self.ensure_tab(op).await {
            Ok(()) => {}
            Err(Fail::Halt(halt)) => return op.halted(halt),
            Err(_) => return setup_failed("open_tab"),
        }
        let Some(tab) = self.tab.as_ref() else {
            return SETUP_FAILED.to_string();
        };
        let revision = &mut self.revision;
        match request {
            Request::Read => tab.read(op, revision).await,
            Request::Open { url } => tab.open(op, &url, revision).await,
            Request::Click { target } => tab.click(op, &target, revision).await,
            Request::Type { target, text } => tab.type_text(op, &target, &text, revision).await,
            Request::PressKey { events } => tab.press_key(op, &events, revision).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cut_click_releases_the_button_once_the_press_was_sent() {
        assert!(!mouse_pressed(0));
        assert!(mouse_pressed(1));
        assert!(mouse_pressed(2));
    }

    #[test]
    fn the_controlled_page_emulates_focus() {
        use chromiumoxide::types::Method;
        let command = focus_emulation();
        assert_eq!(
            command.identifier().as_ref(),
            "Emulation.setFocusEmulationEnabled"
        );
        assert_eq!(
            serde_json::to_value(&command).unwrap(),
            serde_json::json!({ "enabled": true })
        );
    }
}
