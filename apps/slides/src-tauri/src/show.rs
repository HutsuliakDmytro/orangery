//! The windows a slide show runs in.
//!
//! A show wants the whole of a screen, and a presenter wants a different screen
//! with something else on it. Both are windows of their own rather than states
//! of the editor's window: a webview cannot be in two places, and a presenter
//! view drawn over the editor would be a presenter view the room can see.
//!
//! The deck reaches them as a file on disk. It is already written to disk on
//! every save, so this is a path the app is sure of; sending megabytes of a
//! package through IPC as a JSON array of numbers is not.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use orangery_tauri_shared::AppError;

/// Where a newly opened show window should start from.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShowSource {
    /// The deck, written out so another window can read it.
    pub path: String,
    /// Index of the slide to open on.
    pub at: usize,
}

/// Set before the windows exist, read by them once they do.
///
/// A window cannot be handed anything at the moment it is built — it has no
/// webview yet — so it asks for this on mount instead. That also means a window
/// reloaded mid-show comes back to the same place.
#[derive(Default)]
pub struct ShowState(pub Mutex<Option<ShowSource>>);

const SHOW: &str = "show";
const PRESENTER: &str = "presenter";

/// Which monitor to put the show on: the one the editor is not on, if there is one.
fn other_monitor<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    wanted: Option<usize>,
) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;
    if let Some(index) = wanted {
        return monitors.get(index).cloned();
    }

    let current = app
        .webview_windows()
        .values()
        .next()
        .and_then(|window| window.current_monitor().ok().flatten());

    // With one screen there is no other one, and the show takes the only one
    // there is; a presenter view then has nowhere to go, which `start` decides.
    match current {
        Some(current) => monitors
            .iter()
            .find(|monitor| monitor.position() != current.position())
            .or_else(|| monitors.first())
            .cloned(),
        None => monitors.first().cloned(),
    }
}

fn build<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    route: &str,
    monitor: Option<&tauri::Monitor>,
    fullscreen: bool,
) -> Result<(), AppError> {
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.set_focus();
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(format!("index.html#{route}").into()),
    )
    .title(app.package_info().name.as_str())
    .decorations(!fullscreen);

    if let Some(monitor) = monitor {
        let position = monitor.position();
        // Positioned before it is made fullscreen, which is what decides the
        // screen it fills.
        builder = builder.position(f64::from(position.x), f64::from(position.y));
    }

    let window = builder.build()?;
    if fullscreen {
        let _ = window.set_fullscreen(true);
    }

    Ok(())
}

/// Opens the show, and the presenter view when there is a second screen for it.
#[tauri::command]
pub async fn start_show<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, ShowState>,
    path: String,
    at: usize,
    monitor: Option<usize>,
) -> Result<bool, AppError> {
    *state
        .0
        .lock()
        .map_err(|_| AppError::Other("show state is poisoned".into()))? =
        Some(ShowSource { path, at });

    let screens = app.available_monitors().map(|all| all.len()).unwrap_or(0);
    let target = other_monitor(&app, monitor);

    build(&app, SHOW, SHOW, target.as_ref(), true)?;

    // With one screen the presenter view would be the thing the room sees, so
    // it is simply not opened; the caller is told, and says so.
    let presenter = screens > 1;
    if presenter {
        build(&app, PRESENTER, PRESENTER, None, false)?;
    }

    Ok(presenter)
}

/// What a show window should open: called by that window, on mount.
#[tauri::command]
pub fn show_source(state: tauri::State<'_, ShowState>) -> Option<ShowSource> {
    state.0.lock().ok().and_then(|source| source.clone())
}

/// Closes both windows, from whichever one asked.
#[tauri::command]
pub async fn end_show<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, ShowState>,
) -> Result<(), AppError> {
    if let Ok(mut source) = state.0.lock() {
        *source = None;
    }

    for label in [SHOW, PRESENTER] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.close();
        }
    }

    Ok(())
}
