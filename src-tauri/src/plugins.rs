//! Tauri plugins the app registers before it is built.

use tauri::{Builder, Runtime};

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
    // Unauthenticated WebDriver server on 127.0.0.1:4445 that drives the verify bundle.
    #[cfg(feature = "verify")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    builder
}

#[cfg(test)]
mod tests {
    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn default_build_leaves_out_the_webdriver_server() {
        assert!(!cfg!(feature = "verify"));
    }
}
