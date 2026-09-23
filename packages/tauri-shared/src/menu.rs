//! Native menu bar, built from descriptors the frontend sends.
//!
//! The command registry (`src/editor/commands/registry.ts`) is the single source of
//! truth for actions — see `docs/adr/0002-command-registry.md`. Rust owns none of
//! that logic: it receives a flat list of descriptors, renders them as menu items,
//! and emits the clicked id back so the frontend runs the command.
//!
//! Predefined items (Quit, Hide, Services, Copy/Paste, Fullscreen) stay on the Rust
//! side because they need OS wiring the webview cannot provide.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{
    AboutMetadata, CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Manager, Runtime};

use crate::AppError;

/// Mirrors `CommandDescriptor` in `src/editor/commands/types.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct CommandDescriptor {
    pub id: String,
    pub label: String,
    pub group: String,
    pub shortcut: Option<String>,
    /// Whether the command can be run right now.
    ///
    /// Absent means yes. A command says when it cannot be run, not when it
    /// can, and a descriptor that forgot to say is a command with nothing
    /// standing in its way — the opposite default greys out the menu bar of an
    /// app whose registry never said anything was wrong.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// `Some` for a command that is a toggle, and says whether it is on. A
    /// toggle without a tick in the menu gives no way to tell.
    #[serde(default)]
    pub active: Option<bool>,
}

fn yes() -> bool {
    true
}

/// What a command's menu item should show, without rebuilding anything.
///
/// The small half of a descriptor: everything that changes as somebody works,
/// and nothing that decides what the menu bar looks like. Sent many times a
/// second where the descriptors are sent once.
#[derive(Debug, Clone, Deserialize)]
pub struct CommandState {
    pub id: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub active: Option<bool>,
}

/// The items of each window's menu bar, by command id.
///
/// Kept so that a change of state is `set_enabled` on the item that changed
/// rather than a new menu bar. Rebuilding one is visible on macOS — the bar
/// blinks — and it happened on every selection move.
///
/// By window, because each window has its own document and its own idea of
/// what can be done to it. On macOS the menu bar belongs to the application
/// rather than to a window, so the one on screen is the focused window's and
/// `focus_menu` is what swaps it.
#[derive(Default)]
pub struct MenuBars<R: Runtime> {
    windows: Mutex<HashMap<String, WindowMenu<R>>>,
}

struct WindowMenu<R: Runtime> {
    menu: Menu<R>,
    items: HashMap<String, MenuItemKind<R>>,
}

impl<R: Runtime> MenuBars<R> {
    pub fn new() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }
}

/// Menu-bar order. A group with no commands is still rendered when it carries
/// predefined items (Edit, View), and skipped otherwise.
/// An item the operating system owns rather than the command registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trailing {
    CloseWindow,
    Separator,
    Quit,
    Cut,
    Copy,
    Paste,
    Fullscreen,
}

/// Which OS-owned items a menu gets, and where.
///
/// Stated apart from the building so the platform rule can be checked without a
/// running application — it is the part that differs between machines, and so
/// the part least likely to be noticed when it is wrong.
pub fn trailing_items(group: &str, on_macos: bool) -> Vec<Trailing> {
    match group {
        "file" => {
            let mut items = vec![Trailing::CloseWindow];

            // Without the application submenu there is nowhere else for it.
            if !on_macos {
                items.push(Trailing::Separator);
                items.push(Trailing::Quit);
            }

            items
        }
        "edit" => vec![Trailing::Cut, Trailing::Copy, Trailing::Paste],
        // Full screen is a macOS menu item; elsewhere the window manager owns
        // it and the menu entry does nothing.
        "view" if on_macos => vec![Trailing::Fullscreen],
        _ => Vec::new(),
    }
}

/// Whether this build runs on macOS.
///
/// A constant rather than `#[cfg]` around the code that uses it: both branches
/// are then compiled everywhere, so a mistake in the one this machine does not
/// run still fails the build here rather than only on somebody else's.
const ON_MACOS: bool = cfg!(target_os = "macos");

const GROUP_ORDER: [(&str, &str); 5] = [
    ("file", "File"),
    ("edit", "Edit"),
    ("format", "Format"),
    ("insert", "Insert"),
    ("view", "View"),
];

fn group_items(descriptors: &[CommandDescriptor]) -> HashMap<&str, Vec<&CommandDescriptor>> {
    let mut grouped: HashMap<&str, Vec<&CommandDescriptor>> = HashMap::new();
    for descriptor in descriptors {
        grouped
            .entry(descriptor.group.as_str())
            .or_default()
            .push(descriptor);
    }
    grouped
}

/// Tauri accelerators use `CmdOrCtrl+Shift+P`; descriptors arrive already resolved
/// to `Cmd+…` or `Ctrl+…` by `src/platform/keys.ts`, which is accepted as-is.
fn accelerator(descriptor: &CommandDescriptor) -> Option<&str> {
    descriptor.shortcut.as_deref()
}

pub fn build<R: Runtime>(
    app: &AppHandle<R>,
    descriptors: &[CommandDescriptor],
) -> Result<Menu<R>, AppError> {
    Ok(build_with_items(app, descriptors)?.0)
}

/// The menu bar, and the item of each command in it.
///
/// The items are what makes a state change cheap: `set_enabled` on the one
/// that changed, rather than a new menu bar for the whole application.
fn build_with_items<R: Runtime>(
    app: &AppHandle<R>,
    descriptors: &[CommandDescriptor],
) -> Result<(Menu<R>, HashMap<String, MenuItemKind<R>>), AppError> {
    let mut items: HashMap<String, MenuItemKind<R>> = HashMap::new();
    let grouped = group_items(descriptors);

    // The submenu named after the application is a macOS convention, and the
    // items in it — Services, Hide Others, Show All — do nothing anywhere else.
    // On Windows and Linux there is no such menu and Quit belongs in File.
    //
    // The name comes from the app's own package info rather than a literal, so
    // each app in the suite names its own menu and neither can drift from what
    // its tauri.conf.json says.
    let app_menu = if ON_MACOS {
        Some(Submenu::with_items(
            app,
            app.package_info().name.as_str(),
            true,
            &[
                &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?)
    } else {
        None
    };

    let mut submenus: Vec<Submenu<R>> = Vec::new();

    for (group, title) in GROUP_ORDER {
        let commands = grouped.get(group).cloned().unwrap_or_default();

        // Items the OS must own, appended after the registry-driven ones.
        let mut trailing: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
        for item in trailing_items(group, ON_MACOS) {
            trailing.push(match item {
                Trailing::CloseWindow => {
                    Box::new(PredefinedMenuItem::close_window(app, Some("Close Window"))?)
                }
                Trailing::Separator => Box::new(PredefinedMenuItem::separator(app)?),
                Trailing::Quit => Box::new(PredefinedMenuItem::quit(app, None)?),
                Trailing::Cut => Box::new(PredefinedMenuItem::cut(app, None)?),
                Trailing::Copy => Box::new(PredefinedMenuItem::copy(app, None)?),
                Trailing::Paste => Box::new(PredefinedMenuItem::paste(app, None)?),
                Trailing::Fullscreen => Box::new(PredefinedMenuItem::fullscreen(app, None)?),
            });
        }

        if commands.is_empty() && trailing.is_empty() {
            continue;
        }

        let submenu = Submenu::new(app, title, true)?;

        for descriptor in &commands {
            match descriptor.active {
                Some(checked) => {
                    let item = CheckMenuItem::with_id(
                        app,
                        &descriptor.id,
                        &descriptor.label,
                        descriptor.enabled,
                        checked,
                        accelerator(descriptor),
                    )?;
                    submenu.append(&item)?;
                    items.insert(descriptor.id.clone(), MenuItemKind::Check(item));
                }
                None => {
                    let item = MenuItem::with_id(
                        app,
                        &descriptor.id,
                        &descriptor.label,
                        descriptor.enabled,
                        accelerator(descriptor),
                    )?;
                    submenu.append(&item)?;
                    items.insert(descriptor.id.clone(), MenuItemKind::MenuItem(item));
                }
            }
        }

        if !commands.is_empty() && !trailing.is_empty() {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
        }

        for item in &trailing {
            submenu.append(item.as_ref())?;
        }

        submenus.push(submenu);
    }

    let help_menu = Submenu::with_items(app, "Help", true, &[])?;

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = Vec::new();
    if let Some(menu) = &app_menu {
        refs.push(menu);
    }
    refs.extend(
        submenus
            .iter()
            .map(|s| s as &dyn tauri::menu::IsMenuItem<R>),
    );
    refs.push(&help_menu);

    let menu = Menu::with_items(app, &refs)?;
    Ok((menu, items))
}

/// Builds this window's menu bar from the registry.
///
/// Called when the shape changes — a window opens, a document brings different
/// commands with it — and not when a command merely becomes available:
/// `sync_command_menu` does that without building anything.
///
/// Not `async`: a command declared async is run on a worker thread, and a menu
/// bar is the main thread's. The work is a few hundred microseconds.
#[tauri::command]
pub fn set_command_menu<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    descriptors: Vec<CommandDescriptor>,
) -> Result<(), AppError> {
    let (menu, items) = build_with_items(&app, &descriptors)?;

    if let Some(bars) = app.try_state::<MenuBars<R>>() {
        if let Ok(mut windows) = bars.windows.lock() {
            windows.insert(
                window.label().to_string(),
                WindowMenu {
                    menu: menu.clone(),
                    items,
                },
            );
        }
    }

    show(&app, &window, &menu)
}

/// Puts a menu on screen for the window it belongs to.
///
/// On macOS the menu bar belongs to the application and shows whatever the
/// focused window last put there; everywhere else it belongs to the window and
/// is set on it.
fn show<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::Window<R>,
    menu: &Menu<R>,
) -> Result<(), AppError> {
    if ON_MACOS {
        if window.is_focused().unwrap_or(true) {
            app.set_menu(menu.clone())?;
        }
    } else {
        window.set_menu(menu.clone())?;
    }

    Ok(())
}

/// Brings the items of a window's menu up to date, without rebuilding it.
///
/// `false` means the menu bar does not have these commands in it — the window
/// has not built one yet, or the registry has changed shape since it did — and
/// the caller should send descriptors instead.
#[tauri::command]
pub fn sync_command_menu<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    states: Vec<CommandState>,
) -> Result<bool, AppError> {
    let Some(bars) = app.try_state::<MenuBars<R>>() else {
        return Ok(false);
    };
    let Ok(windows) = bars.windows.lock() else {
        return Ok(false);
    };
    let Some(built) = windows.get(window.label()) else {
        return Ok(false);
    };

    for state in &states {
        let Some(item) = built.items.get(&state.id) else {
            // A command the menu bar has never heard of: its shape has changed
            // and the states are about a bar that no longer exists.
            return Ok(false);
        };

        match item {
            MenuItemKind::MenuItem(item) => item.set_enabled(state.enabled)?,
            MenuItemKind::Check(item) => {
                item.set_enabled(state.enabled)?;
                if let Some(active) = state.active {
                    item.set_checked(active)?;
                }
            }
            _ => {}
        }
    }

    Ok(true)
}

/// Shows the menu bar of the window that has just been focused.
///
/// macOS only in effect: elsewhere each window carries its own bar and nothing
/// needs swapping. Two windows of the same app hold different documents, and
/// the bar has to say what can be done to the one in front.
#[tauri::command]
pub fn focus_command_menu<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
) -> Result<bool, AppError> {
    let Some(bars) = app.try_state::<MenuBars<R>>() else {
        return Ok(false);
    };
    let Ok(windows) = bars.windows.lock() else {
        return Ok(false);
    };
    let Some(built) = windows.get(window.label()) else {
        return Ok(false);
    };

    if ON_MACOS {
        app.set_menu(built.menu.clone())?;
    }

    Ok(true)
}

/// Minimal menu shown before the frontend has reported its commands, so the
/// window never appears without a menu bar.
pub fn build_bootstrap<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, AppError> {
    build(app, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(id: &str, group: &str) -> CommandDescriptor {
        CommandDescriptor {
            id: id.to_string(),
            label: id.to_string(),
            group: group.to_string(),
            shortcut: None,
            enabled: true,
            active: None,
        }
    }

    fn toggle(id: &str, group: &str, on: bool) -> CommandDescriptor {
        CommandDescriptor {
            active: Some(on),
            ..descriptor(id, group)
        }
    }

    #[test]
    fn quit_sits_in_the_file_menu_where_there_is_no_application_menu() {
        // macOS puts it under the application's own name; Windows and Linux
        // have no such menu, so without this there is no way to quit at all.
        assert!(trailing_items("file", false).contains(&Trailing::Quit));
        assert!(!trailing_items("file", true).contains(&Trailing::Quit));
    }

    #[test]
    fn closing_a_window_is_offered_everywhere() {
        for on_macos in [true, false] {
            assert!(trailing_items("file", on_macos).contains(&Trailing::CloseWindow));
        }
    }

    #[test]
    fn full_screen_is_offered_only_where_the_menu_item_does_something() {
        assert_eq!(trailing_items("view", true), vec![Trailing::Fullscreen]);
        assert!(trailing_items("view", false).is_empty());
    }

    #[test]
    fn the_clipboard_items_are_the_same_on_every_platform() {
        let expected = vec![Trailing::Cut, Trailing::Copy, Trailing::Paste];

        assert_eq!(trailing_items("edit", true), expected);
        assert_eq!(trailing_items("edit", false), expected);
    }

    #[test]
    fn a_menu_the_system_owns_nothing_in_gets_nothing() {
        assert!(trailing_items("format", true).is_empty());
        assert!(trailing_items("insert", false).is_empty());
    }

    #[test]
    fn reads_a_toggle_state_when_the_frontend_sends_one() {
        // A command with no state is a plain item; one with a state is drawn as
        // a check item, which is the only way to see whether it is on.
        assert_eq!(descriptor("file.new", "file").active, None);
        assert_eq!(toggle("format.bold", "format", true).active, Some(true));
    }

    #[test]
    fn defaults_the_toggle_state_when_it_is_absent() {
        let descriptor: CommandDescriptor = serde_json::from_str(
            r#"{"id":"a","label":"A","group":"file","shortcut":null,"enabled":true}"#,
        )
        .expect("a descriptor without a state should still parse");

        assert_eq!(descriptor.active, None);
    }

    #[test]
    fn groups_descriptors_by_menu_and_keeps_order() {
        let descriptors = vec![
            descriptor("file.new", "file"),
            descriptor("edit.undo", "edit"),
            descriptor("file.open", "file"),
        ];

        let grouped = group_items(&descriptors);
        let file: Vec<&str> = grouped["file"].iter().map(|d| d.id.as_str()).collect();

        assert_eq!(file, ["file.new", "file.open"]);
        assert_eq!(grouped["edit"].len(), 1);
    }

    #[test]
    fn descriptors_deserialize_from_the_frontend_shape() {
        let json = r#"[{"id":"format.bold","label":"Bold","group":"format","shortcut":"Cmd+b","enabled":true}]"#;
        let parsed: Vec<CommandDescriptor> = serde_json::from_str(json).expect("parse");

        assert_eq!(parsed[0].id, "format.bold");
        assert_eq!(accelerator(&parsed[0]), Some("Cmd+b"));
    }

    #[test]
    fn a_missing_shortcut_yields_no_accelerator() {
        assert_eq!(accelerator(&descriptor("edit.undo", "edit")), None);
    }
}
