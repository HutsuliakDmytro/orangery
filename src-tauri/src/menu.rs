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

use serde::Deserialize;
use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

use crate::AppError;

/// Mirrors `CommandDescriptor` in `src/editor/commands/types.ts`.
#[derive(Debug, Clone, Deserialize)]
pub struct CommandDescriptor {
    pub id: String,
    pub label: String,
    pub group: String,
    pub shortcut: Option<String>,
    pub enabled: bool,
    /// `Some` for a command that is a toggle, and says whether it is on. A
    /// toggle without a tick in the menu gives no way to tell.
    #[serde(default)]
    pub active: Option<bool>,
}

/// Menu-bar order. A group with no commands is still rendered when it carries
/// predefined items (Edit, View), and skipped otherwise.
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
    let grouped = group_items(descriptors);

    let app_menu = Submenu::with_items(
        app,
        "Orangery Docs",
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
    )?;

    let mut submenus: Vec<Submenu<R>> = Vec::new();

    for (group, title) in GROUP_ORDER {
        let commands = grouped.get(group).cloned().unwrap_or_default();

        // Items the OS must own, appended after the registry-driven ones.
        let trailing: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = match group {
            "file" => vec![Box::new(PredefinedMenuItem::close_window(
                app,
                Some("Close Window"),
            )?)],
            "edit" => vec![
                Box::new(PredefinedMenuItem::cut(app, None)?),
                Box::new(PredefinedMenuItem::copy(app, None)?),
                Box::new(PredefinedMenuItem::paste(app, None)?),
            ],
            "view" => vec![Box::new(PredefinedMenuItem::fullscreen(app, None)?)],
            _ => Vec::new(),
        };

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

    let mut refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = vec![&app_menu];
    refs.extend(
        submenus
            .iter()
            .map(|s| s as &dyn tauri::menu::IsMenuItem<R>),
    );
    refs.push(&help_menu);

    Menu::with_items(app, &refs).map_err(Into::into)
}

/// Rebuilds the menu bar from the registry. Called on startup and whenever the
/// frontend's enabled-state changes (selection moved, history became non-empty).
#[tauri::command]
pub async fn set_command_menu<R: Runtime>(
    app: AppHandle<R>,
    descriptors: Vec<CommandDescriptor>,
) -> Result<(), AppError> {
    let menu = build(&app, &descriptors)?;
    app.set_menu(menu)?;
    Ok(())
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
        }
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
