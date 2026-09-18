//! Orangery Slides, the native side.
//!
//! Everything that is not about presentations — atomic writes, autosave, the
//! menu builder, diagnostics — comes from `orangery-tauri-shared`. What is here
//! is this app's own wiring.

mod show;

use orangery_tauri_shared::{diagnostics, document, menu};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            menu::set_command_menu,
            document::read_document,
            document::write_document,
            document::document_key,
            document::write_autosave,
            document::read_autosave,
            document::clear_autosave,
            document::list_autosaves,
            document::confirm_close,
            document::open_window,
            diagnostics::write_diagnostic,
            diagnostics::read_diagnostics,
            diagnostics::clear_diagnostics,
            show::start_show,
            show::show_source,
            show::end_show,
        ])
        .manage(show::ShowState::default())
        .setup(|app| {
            document::emit_launch_paths(app.handle());

            // A placeholder menu so the window never appears bare; the frontend
            // replaces it with the registry-driven one as soon as it mounts.
            app.set_menu(menu::build_bootstrap(app.handle())?)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The frontend owns "is there anything unsaved?", so a close request
            // is handed to it rather than answered here. It calls back through
            // `confirm_close` once the user has chosen.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if document::close_is_confirmed(window.label()) {
                    return;
                }
                api.prevent_close();
                let _ = tauri::Emitter::emit(window, "window:close-requested", window.label());
            }
        })
        .on_menu_event(|app, event| {
            // Menu items are registry command ids — the frontend looks them up
            // and runs them, so the logic lives in exactly one place.
            let _ = tauri::Emitter::emit(app, "menu:command", event.id().0.as_str());
        })
        .run(tauri::generate_context!())
        .expect("error while running Orangery Slides");
}
