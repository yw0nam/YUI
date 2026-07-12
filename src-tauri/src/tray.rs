use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, PartialEq, Eq)]
enum TrayAction {
    ToggleVisibility,
    OpenSettings,
    Quit,
}

fn action_for(menu_id: &str) -> Option<TrayAction> {
    match menu_id {
        "toggle-visibility" => Some(TrayAction::ToggleVisibility),
        "settings" => Some(TrayAction::OpenSettings),
        "quit" => Some(TrayAction::Quit),
        _ => None,
    }
}

fn toggle_visibility(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("tray main window not found");
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            if let Err(error) = window.hide() {
                log::warn!("tray failed to hide main window: {error}");
            }
        }
        Ok(false) => {
            if let Err(error) = window.show() {
                log::warn!("tray failed to show main window: {error}");
            }
        }
        Err(error) => log::warn!("tray failed to read main window visibility: {error}"),
    }
}

fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        if let Err(error) = window.show() {
            log::warn!("tray failed to show settings window: {error}");
        }
        if let Err(error) = window.set_focus() {
            log::warn!("tray failed to focus settings window: {error}");
        }
        return;
    }

    // Window params mirror src/io/settings-window.ts — keep both in sync.
    let handle = app.clone();
    if let Err(error) = std::thread::Builder::new()
        .name("yui-settings-window".into())
        .spawn(move || {
            if let Err(error) = WebviewWindowBuilder::new(
                &handle,
                "settings",
                WebviewUrl::App("settings.html".into()),
            )
            .title("YUI 설정")
            .inner_size(480.0, 660.0)
            .min_inner_size(380.0, 480.0)
            .resizable(true)
            .decorations(true)
            .transparent(false)
            .build()
            {
                log::warn!("tray failed to create settings window: {error}");
            }
        })
    {
        log::warn!("tray failed to spawn settings window thread: {error}");
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(
        app,
        "toggle-visibility",
        "Show / Hide Character",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit YUI", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &settings, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match action_for(event.id().as_ref()) {
            Some(TrayAction::ToggleVisibility) => toggle_visibility(app),
            Some(TrayAction::OpenSettings) => open_settings(app),
            Some(TrayAction::Quit) => app.exit(0),
            None => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    } else {
        log::warn!("tray default window icon not found");
    }

    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_for_maps_toggle_visibility() {
        assert_eq!(
            action_for("toggle-visibility"),
            Some(TrayAction::ToggleVisibility)
        );
    }

    #[test]
    fn action_for_maps_settings() {
        assert_eq!(action_for("settings"), Some(TrayAction::OpenSettings));
    }

    #[test]
    fn action_for_maps_quit() {
        assert_eq!(action_for("quit"), Some(TrayAction::Quit));
    }

    #[test]
    fn action_for_rejects_unknown_and_empty_ids() {
        assert_eq!(action_for("unknown"), None);
        assert_eq!(action_for(""), None);
    }
}
