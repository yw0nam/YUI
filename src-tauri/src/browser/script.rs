//! The script handed to `ego-browser nodejs`: a deadline, the task space, a `screenshot` helper, then the caller's code.

use std::path::Path;

/// Wraps `code` so it starts on line 6, runs in task space `space`, and stops itself after `deadline_ms`.
pub fn build_script(space: &str, shot_dir: &Path, code: &str, deadline_ms: u64) -> String {
    let space = serde_json::to_string(space).expect("a string serializes");
    let shot_dir = serde_json::to_string(&shot_dir.to_string_lossy()).expect("a string serializes");
    format!(
        r#"const __yuiDeadline = setTimeout(() => {{ console.error("[yui] deadline"); process.exit(124); }}, {deadline_ms});
try {{
  const task = await taskSpace({space});
  let __yuiShot = 0;
  const screenshot = (page) => page.screenshot({{ path: `${{{shot_dir}}}/${{String(++__yuiShot).padStart(3, "0")}}.png` }});
{code}
}} catch (e) {{
  console.error(String(e?.stack ?? e));
  process.exit(1);
}} finally {{
  clearTimeout(__yuiDeadline);
}}
"#
    )
}
