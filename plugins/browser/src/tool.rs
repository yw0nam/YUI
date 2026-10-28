//! The `browser` tool definition: name, description, input schema, and `_meta`.

use rmcp::model::Tool;
use serde_json::json;

pub const NAME: &str = "browser";

const DESCRIPTION: &str =
    "Run JavaScript against the ego lite browser SDK in this character's own task space of the \
ego lite browser on the user's computer. These rules take precedence over the guide. code is \
the body of an async function that runs after the client's prelude: top-level await works; \
static import does not, use await import() instead; the names task and screenshot and every \
name starting with __yui are reserved; variables start fresh on every call. Use the injected \
task; do not call taskSpace(); do not finish the space. Print observations with console.log; \
the output is text. await screenshot(page) attaches an image of the page's viewport. Images \
need an image-capable model. screenshot restores a minimized ego lite window before it captures. A \
space the user took over fails with EGO_TASK_SPACE_NAME_IN_USE until the user hands it back \
in ego lite. Error line numbers are 5 more than the line in code. Call with guide: true to \
read the full guide.";

pub fn tool() -> Tool {
    serde_json::from_value(json!({
        "name": NAME,
        "description": DESCRIPTION,
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "the JavaScript to run: the body of an async function"
                },
                "guide": {
                    "type": "boolean",
                    "description": "true returns the full guide instead of running code"
                }
            },
            "additionalProperties": false
        },
        "_meta": {
            // The relay kills the CLI at 28 s; the wait covers it and the image collection after it.
            "io.github.yw0nam.yui/wait_ms": 32_000,
            "io.github.yw0nam.yui/summary": "Run JavaScript in this character's own ego lite browser task space; screenshot attaches page images."
        }
    }))
    .expect("the literal is a valid tool")
}
