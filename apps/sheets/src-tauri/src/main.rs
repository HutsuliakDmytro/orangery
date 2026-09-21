// The Windows subsystem is set so a release build does not open a console
// window behind the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    orangery_sheets_lib::run()
}
