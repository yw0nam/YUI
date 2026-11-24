//! The four herdr tools: definitions, argument checks, and CLI calls.

use rmcp::model::{CallToolResult, ContentBlock, JsonObject, Tool};
use std::path::PathBuf;

pub const NAMES: [&str; 4] = ["herdr_agents", "herdr_read", "herdr_prompt", "herdr_keys"];

pub fn list() -> Vec<Tool> {
    Vec::new()
}

pub async fn call(
    _name: &str,
    _args: &JsonObject,
    _locate: fn() -> Option<PathBuf>,
) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text("stub")])
}