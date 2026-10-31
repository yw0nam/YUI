//! The script handed to `ego-browser nodejs`: a deadline, the task space, a `screenshot` helper, then the caller's code.

use std::path::Path;

/// The line the prelude prints when its deadline stops the script.
const DEADLINE_MARKER: &str = "[yui] deadline";

/// The error a capture that outlasts its wait rejects with.
const STALLED: &str = "[yui] capture stalled";

/// Whether `stderr` holds the line the prelude prints when its deadline fires.
pub fn names_deadline(stderr: &str) -> bool {
    stderr
        .lines()
        .any(|line| line.trim().ends_with(DEADLINE_MARKER))
}

/// Wraps `code` to start on line 6 in task space `space`, stopping after `deadline_ms`; macOS stops rendering a minimized window, so `screenshot` restores it, and a capture that outlasts `capture_wait_ms` cycles the window once.
pub fn build_script(
    space: &str,
    shot_dir: &Path,
    code: &str,
    deadline_ms: u64,
    capture_wait_ms: u64,
) -> String {
    let marker = serde_json::to_string(DEADLINE_MARKER).expect("a string serializes");
    let stalled = serde_json::to_string(STALLED).expect("a string serializes");
    let space = serde_json::to_string(space).expect("a string serializes");
    let shot_dir = serde_json::to_string(&shot_dir.to_string_lossy()).expect("a string serializes");
    format!(
        r#"const __yuiDeadline = setTimeout(() => {{ console.error({marker}); process.exit(124); }}, {deadline_ms});
try {{
  const task = await taskSpace({space});
  let __yuiShot = 0;
  const screenshot = (page) => __yuiScreenshot(page, `${{{shot_dir}}}/${{String(++__yuiShot).padStart(3, "0")}}.png`);
{code}
  function __yuiBound(work) {{
    work.catch(() => {{}});
    let timer;
    const limit = new Promise((_, reject) => {{
      timer = setTimeout(() => reject(new Error({stalled})), {capture_wait_ms});
    }});
    return Promise.race([work, limit]).finally(() => clearTimeout(timer));
  }}
  function __yuiCapture(page, path) {{
    return __yuiBound(page.screenshot({{ path }}));
  }}
  async function __yuiScreenshot(page, path) {{
    const stalledError = () => new Error("screenshot stalled: ego lite did not capture in time; read the page with page.snapshot() instead");
    let didStall = false;
    try {{
      return await __yuiCapture(page, path);
    }} catch (e) {{
      const message = String(e?.message ?? e);
      didStall = message === {stalled};
      if (!didStall && !message.includes("while the window is minimized")) throw e;
    }}
    if (didStall) {{
      try {{
        await __yuiBound((async () => {{
          const {{ windowId }} = await task.cdp("Browser.getWindowForTarget", {{ targetId: page.targetId }});
          const {{ bounds }} = await task.cdp("Browser.getWindowBounds", {{ windowId }});
          const was = bounds.windowState;
          if (was === "fullscreen") await task.cdp("Browser.setWindowBounds", {{ windowId, bounds: {{ windowState: "normal" }} }});
          await task.cdp("Browser.setWindowBounds", {{ windowId, bounds: {{ windowState: "minimized" }} }});
          await task.cdp("Browser.setWindowBounds", {{ windowId, bounds: {{ windowState: "normal" }} }});
          if (was === "maximized" || was === "fullscreen") await task.cdp("Browser.setWindowBounds", {{ windowId, bounds: {{ windowState: was }} }});
        }})());
      }} catch {{
        throw stalledError();
      }}
      try {{
        return await __yuiCapture(page, path);
      }} catch (e) {{
        throw String(e?.message ?? e) === {stalled} ? stalledError() : e;
      }}
    }}
    const {{ windowId }} = await task.cdp("Browser.getWindowForTarget", {{ targetId: page.targetId }});
    await task.cdp("Browser.setWindowBounds", {{ windowId, bounds: {{ windowState: "normal" }} }});
    for (let tries = 1; ; tries++) {{
      await new Promise((r) => setTimeout(r, 100));
      try {{
        return await __yuiCapture(page, path);
      }} catch (e) {{
        if (String(e?.message ?? e) === {stalled}) throw stalledError();
        if (tries === 20) throw e;
      }}
    }}
  }}
}} catch (e) {{
  console.error(String(e?.stack ?? e));
  process.exit(1);
}} finally {{
  clearTimeout(__yuiDeadline);
}}
"#
    )
}
