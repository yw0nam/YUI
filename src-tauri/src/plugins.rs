//! Tauri plugins the app registers before it is built.

use tauri::{Builder, Runtime};

pub fn register<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder
        // Window.fetch routed to Rust → CORS bypass + SSE streaming support (plugin-http doesn't support streaming).
        .plugin(tauri_plugin_cors_fetch::init())
        // OS file picker — bring-your-own VRM import.
        .plugin(tauri_plugin_dialog::init())
        // Global hotkey — registration/removal handled by JS guest binding (input summon hotkey).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // Bubble links (target=_blank) open in the default browser.
        .plugin(tauri_plugin_opener::init())
}
