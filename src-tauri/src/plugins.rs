//! Tauri plugins the app registers before it is built.

use tauri::{Builder, Runtime};
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

pub fn register<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    let builder = builder
        // Window.fetch routed to Rust → CORS bypass + SSE streaming support (plugin-http doesn't support streaming).
        .plugin(tauri_plugin_cors_fetch::init())
        // Opens the picked VRM: a path on desktop, a content URI on Android.
        .plugin(tauri_plugin_fs::init())
        // OS file picker — bring-your-own VRM import.
        .plugin(tauri_plugin_dialog::init())
        // Bubble links (target=_blank) open in the default browser.
        .plugin(tauri_plugin_opener::init());
    // Global hotkey — registration/removal handled by JS guest binding (input summon hotkey).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    // Size and position by window label, restored when a window is ready and written at exit;
    // only the character windows take part, the message and settings windows place themselves.
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
            .with_filter(|label| label == "main" || label.starts_with("pet-"))
            .build(),
    );
    // Unauthenticated WebDriver server on 127.0.0.1:4445 that drives the verify bundle.
    #[cfg(all(feature = "verify", desktop))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
}
