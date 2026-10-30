//! Files the operating system asks the app to open.
//!
//! There are three ways a path arrives, and before this module only one of
//! them was listened to:
//!
//! - **macOS** sends an Apple Event — `openDocuments` — for a double-click in
//!   Finder, "Open With", or a file dropped on the Dock icon. It is not in
//!   `argv`, ever. Tauri hands it over as [`tauri::RunEvent::Opened`], which
//!   only reaches an app that runs with an event callback.
//! - **Windows and Linux** start a process with the path in `argv`.
//! - **Windows and Linux, app already running**: the shell starts a *second*
//!   process with the path in its `argv`. The single-instance plugin stops it
//!   and hands its arguments to the first.
//!
//! All three come down to [`arrive`], and from there to one queue.
//!
//! The queue exists because of a race the old code lost half the time. The
//! path is known in Rust long before there is a page to give it to: the event
//! arrives while the webview is still loading. The old answer was to wait four
//! hundred milliseconds and emit into the dark. Now a window asks for its
//! paths when it is ready to act on them — [`claim_open_requests`] — and gets
//! whatever has arrived for it by then. Anything that arrives later goes to it
//! as an event, because by then it is listening.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;

use crate::{trail, AppError};

/// The label Tauri gives the window `tauri.conf.json` describes, which in
/// every Orangery app is the only one that exists at launch.
pub const MAIN_WINDOW: &str = "main";

/// The event a ready window is sent a path on.
pub const OPEN_EVENT: &str = "launch:open";

/// What a window is, as far as deciding where a file goes.
#[derive(Debug, Clone)]
struct Window {
    /// It has asked for its paths, so it is listening for more.
    ready: bool,
    /// It holds no document: the welcome screen, or a failed open. A file can
    /// go into it without anything being displaced.
    vacant: bool,
    /// Paths that arrived for it before it was ready.
    pending: VecDeque<String>,
}

impl Window {
    fn new() -> Self {
        Self {
            ready: false,
            vacant: true,
            pending: VecDeque::new(),
        }
    }
}

/// What to do about one path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    /// Kept for a window that has not asked yet. It will get it when it does.
    Queued { label: String },
    /// Send to this window, which is ready and holds nothing.
    Deliver { label: String, path: String },
    /// Every window is busy with a document of its own: open one for this.
    NewWindow { path: String },
}

/// Which window each arriving file goes to.
///
/// Knows nothing about Tauri, so the race can be tested without starting one.
/// The rule, in order:
///
/// 1. a window still loading, with nothing queued for it, takes the file — at
///    launch that is the main window, and it is how a cold double-click opens
///    straight into the file instead of past a welcome screen;
/// 2. a window that is ready and holds nothing takes it — the welcome screen
///    a person left open;
/// 3. otherwise the file gets a window of its own. A window with a document in
///    it is never asked to give it up, saved or not.
#[derive(Debug, Default)]
pub struct Launches {
    windows: HashMap<String, Window>,
    /// The order windows were made in, so "a vacant window" is a fixed one
    /// rather than whichever a hash map visits first.
    order: Vec<String>,
}

impl Launches {
    /// The state at launch: the main window exists and has not loaded.
    pub fn at_launch() -> Self {
        let mut launches = Self::default();
        launches.register(MAIN_WINDOW);
        launches
    }

    /// A window has been made.
    pub fn register(&mut self, label: &str) {
        if !self.windows.contains_key(label) {
            self.order.push(label.to_string());
        }
        self.windows.insert(label.to_string(), Window::new());
    }

    /// A window has gone.
    pub fn closed(&mut self, label: &str) {
        self.windows.remove(label);
        self.order.retain(|one| one != label);
    }

    /// Puts a path in a particular window's queue — the one made for it.
    pub fn queue_for(&mut self, label: &str, path: String) {
        let window = self
            .windows
            .entry(label.to_string())
            .or_insert_with(Window::new);
        window.vacant = false;
        window.pending.push_back(path);
    }

    /// A path has arrived from the operating system.
    pub fn arrive(&mut self, path: String) -> Route {
        let loading = self.order.iter().find(|label| {
            self.windows
                .get(*label)
                .is_some_and(|window| !window.ready && window.vacant && window.pending.is_empty())
        });

        if let Some(label) = loading.cloned() {
            self.queue_for(&label, path);
            return Route::Queued { label };
        }

        let idle = self.order.iter().find(|label| {
            self.windows
                .get(*label)
                .is_some_and(|window| window.ready && window.vacant)
        });

        if let Some(label) = idle.cloned() {
            if let Some(window) = self.windows.get_mut(&label) {
                // Taken now rather than when the page says so, or a second
                // file arriving in the same instant would be sent to it too.
                window.vacant = false;
            }
            return Route::Deliver { label, path };
        }

        Route::NewWindow { path }
    }

    /// A window is ready: hand over what is waiting for it.
    pub fn claim(&mut self, label: &str) -> Vec<String> {
        let window = self
            .windows
            .entry(label.to_string())
            .or_insert_with(Window::new);
        if !self.order.iter().any(|one| one == label) {
            self.order.push(label.to_string());
        }

        window.ready = true;
        window.pending.drain(..).collect()
    }

    /// The page says whether it holds a document.
    pub fn vacancy(&mut self, label: &str, vacant: bool) {
        if let Some(window) = self.windows.get_mut(label) {
            // A file on its way in outranks a page that has not caught up yet.
            window.vacant = vacant && window.pending.is_empty();
        }
    }
}

/// The paths among a process's arguments.
///
/// The program itself and anything that looks like a flag are not paths. A
/// relative path is relative to where the process was started, which for a
/// second instance is not where this one was.
pub fn paths_from_arguments<I, S>(arguments: I, directory: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    arguments
        .into_iter()
        .skip(1)
        .filter_map(|argument| {
            let argument = argument.as_ref();
            if argument.is_empty() || argument.starts_with('-') {
                return None;
            }
            let path = PathBuf::from(argument);
            let absolute = if path.is_absolute() {
                path
            } else {
                directory.join(path)
            };
            Some(absolute.to_string_lossy().into_owned())
        })
        .collect()
}

/// The state, shared by everything in this module.
pub struct LaunchState(pub Mutex<Launches>);

impl Default for LaunchState {
    fn default() -> Self {
        Self(Mutex::new(Launches::at_launch()))
    }
}

/// Wires this module into an app.
///
/// The single-instance plugin is registered here, first, as it has to be: a
/// plugin added before it would initialise in the second process too, before
/// that process is told to stop. macOS does not need it — LaunchServices
/// starts one process per app and sends it `Opened` instead.
pub fn install<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, arguments, directory| {
            let paths = paths_from_arguments(&arguments, Path::new(&directory));
            if paths.is_empty() {
                // Started again with nothing to open: the person wants the app,
                // and the app is already here.
                focus_any(app);
            }
            for path in paths {
                arrive(app, path);
            }
        },
    ));

    builder
        .manage(LaunchState::default())
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                trail::event(&format!("webview {} loaded", webview.label()));
            }
        })
}

/// Reads the paths this process was started with. Called once, from `setup`.
///
/// On macOS a Finder double-click never puts the path here, but running the
/// binary from a terminal does, so it is read everywhere.
pub fn start<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let directory = std::env::current_dir().unwrap_or_default();
    let paths = paths_from_arguments(std::env::args(), &directory);
    trail::event(&format!("setup; argv carries {} file(s)", paths.len()));
    for path in paths {
        arrive(app, path);
    }
}

/// For the app's `run` callback: the Apple Event, and windows closing.
pub fn on_run_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &tauri::RunEvent) {
    match event {
        tauri::RunEvent::Ready => trail::event("ready"),
        tauri::RunEvent::ExitRequested { code, .. } => {
            trail::ending(&format!("exit requested, code {code:?}"));
        }
        tauri::RunEvent::Exit => trail::clean_exit(),
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { .. },
            ..
        } => trail::ending(&format!("window {label}: close requested")),
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => trail::event(&format!("reopen, visible windows: {has_visible_windows}")),
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Opened { urls } => {
            trail::event(&format!("opened (Apple Event), {} url(s)", urls.len()));
            for url in urls {
                // A file URL is a file. Anything else — a custom scheme — is
                // not a document and is not ours to open.
                if let Ok(path) = url.to_file_path() {
                    arrive(app, path.to_string_lossy().into_owned());
                }
            }
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } => {
            trail::ending(&format!("window {label}: destroyed"));
            if let Some(state) = app.try_state::<LaunchState>() {
                state.0.lock().expect("launch state").closed(label);
            }
        }
        _ => {}
    }
}

/// A path from any of the three ways in, sent where it belongs.
pub fn arrive<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: String) {
    let Some(state) = app.try_state::<LaunchState>() else {
        return;
    };
    let route = state.0.lock().expect("launch state").arrive(path);
    trail::event(&format!("arrive → {route:?}"));

    match route {
        Route::Queued { .. } => {}
        Route::Deliver { label, path } => {
            let _ =
                tauri::Emitter::emit_to(app, tauri::EventTarget::labeled(&label), OPEN_EVENT, path);
            if let Some(window) = app.get_webview_window(&label) {
                bring_forward(&window);
            }
        }
        Route::NewWindow { path } => {
            if let Err(error) = new_window(app, Some(path)) {
                eprintln!("could not open a window for a file: {error}");
            }
        }
    }
}

/// Makes a window, and queues `path` for it if there is one.
///
/// One window holds one document, so "New Window" and "open a second file"
/// are the same operation. The label has to be unique per window; a counter
/// is enough, and it keeps labels short for the close-confirmation
/// bookkeeping.
pub fn new_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: Option<String>,
) -> Result<String, AppError> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT_LABEL: AtomicU32 = AtomicU32::new(1);

    let label = format!("win-{}", NEXT_LABEL.fetch_add(1, Ordering::Relaxed));

    // Registered, and the path queued, before the window exists: the page
    // can load and ask before `build` has returned, and must find it there.
    if let Some(state) = app.try_state::<LaunchState>() {
        let mut launches = state.0.lock().expect("launch state");
        launches.register(&label);
        if let Some(path) = path {
            launches.queue_for(&label, path);
        }
    }

    let built =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title(app.package_info().name.as_str())
            .inner_size(1280.0, 840.0)
            .min_inner_size(720.0, 480.0)
            .build();

    match built {
        Ok(window) => {
            trail::event(&format!("window {label} created"));
            bring_forward(&window);
            Ok(label)
        }
        Err(error) => {
            if let Some(state) = app.try_state::<LaunchState>() {
                state.0.lock().expect("launch state").closed(&label);
            }
            Err(error.into())
        }
    }
}

fn bring_forward<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.set_focus();
}

#[cfg(not(target_os = "macos"))]
fn focus_any<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.webview_windows().values().next() {
        bring_forward(window);
    }
}

/// The page is ready to open files: what has arrived for it so far.
///
/// After this, anything for this window comes as [`OPEN_EVENT`]. The page
/// listens before it asks, so nothing falls between the two.
#[tauri::command]
pub fn claim_open_requests(
    window: tauri::Window,
    state: tauri::State<'_, LaunchState>,
) -> Vec<String> {
    let paths = state.0.lock().expect("launch state").claim(window.label());
    trail::event(&format!(
        "window {} claimed {} file(s)",
        window.label(),
        paths.len()
    ));
    paths
}

/// The page says whether it holds a document, so a file arriving while it
/// shows the welcome screen goes into it rather than into a new window.
#[tauri::command]
pub fn report_vacancy(window: tauri::Window, state: tauri::State<'_, LaunchState>, vacant: bool) {
    trail::event(&format!("window {} vacant: {vacant}", window.label()));
    state
        .0
        .lock()
        .expect("launch state")
        .vacancy(window.label(), vacant);
}

/// Opens a new window, optionally on a given file.
#[tauri::command]
pub async fn open_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: Option<String>,
) -> Result<String, AppError> {
    new_window(&app, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(name: &str) -> String {
        format!("/Users/somebody/{name}")
    }

    /// Cold launch: the file arrives before the page has loaded.
    mod before_the_page_is_ready {
        use super::*;

        #[test]
        fn the_file_waits_in_the_main_window() {
            let mut launches = Launches::at_launch();

            assert_eq!(
                launches.arrive(path("report.docx")),
                Route::Queued {
                    label: MAIN_WINDOW.into()
                }
            );
            assert_eq!(launches.claim(MAIN_WINDOW), vec![path("report.docx")]);
        }

        #[test]
        fn nothing_is_handed_over_twice() {
            let mut launches = Launches::at_launch();
            launches.arrive(path("report.docx"));

            launches.claim(MAIN_WINDOW);
            assert!(launches.claim(MAIN_WINDOW).is_empty());
        }

        #[test]
        fn a_page_with_nothing_waiting_is_told_so_and_shows_the_welcome() {
            let mut launches = Launches::at_launch();
            assert!(launches.claim(MAIN_WINDOW).is_empty());
        }

        #[test]
        fn a_second_file_in_the_same_launch_gets_its_own_window() {
            // Three files selected in Finder and opened together: one window
            // each, the first in the one that already exists.
            let mut launches = Launches::at_launch();

            assert!(matches!(
                launches.arrive(path("a.docx")),
                Route::Queued { .. }
            ));
            assert_eq!(
                launches.arrive(path("b.docx")),
                Route::NewWindow {
                    path: path("b.docx")
                }
            );
        }

        #[test]
        fn a_page_reporting_itself_empty_too_early_does_not_lose_the_file() {
            // The welcome screen renders, says "vacant", and only then asks.
            let mut launches = Launches::at_launch();
            launches.arrive(path("report.docx"));

            launches.vacancy(MAIN_WINDOW, true);
            assert_eq!(launches.claim(MAIN_WINDOW), vec![path("report.docx")]);
        }
    }

    /// Warm: the app is running and somebody double-clicks another file.
    mod after_the_page_is_ready {
        use super::*;

        fn running() -> Launches {
            let mut launches = Launches::at_launch();
            launches.claim(MAIN_WINDOW);
            launches
        }

        #[test]
        fn a_welcome_screen_takes_the_file() {
            let mut launches = running();

            assert_eq!(
                launches.arrive(path("report.docx")),
                Route::Deliver {
                    label: MAIN_WINDOW.into(),
                    path: path("report.docx")
                }
            );
        }

        #[test]
        fn a_window_holding_a_document_is_never_asked_to_give_it_up() {
            let mut launches = running();
            launches.vacancy(MAIN_WINDOW, false);

            assert_eq!(
                launches.arrive(path("report.docx")),
                Route::NewWindow {
                    path: path("report.docx")
                }
            );
        }

        #[test]
        fn two_files_in_one_instant_do_not_both_go_to_the_welcome_screen() {
            let mut launches = running();

            assert!(matches!(
                launches.arrive(path("a.docx")),
                Route::Deliver { .. }
            ));
            assert!(matches!(
                launches.arrive(path("b.docx")),
                Route::NewWindow { .. }
            ));
        }

        #[test]
        fn a_window_made_for_a_file_gets_that_file_and_no_other() {
            let mut launches = running();
            launches.vacancy(MAIN_WINDOW, false);

            launches.register("win-1");
            launches.queue_for("win-1", path("a.docx"));

            // A second file while the first window is still loading goes to a
            // window of its own, not into the queue of one already spoken for.
            assert_eq!(
                launches.arrive(path("b.docx")),
                Route::NewWindow {
                    path: path("b.docx")
                }
            );
            assert_eq!(launches.claim("win-1"), vec![path("a.docx")]);
        }

        #[test]
        fn a_window_that_closed_is_not_sent_anything() {
            let mut launches = running();
            launches.closed(MAIN_WINDOW);

            assert_eq!(
                launches.arrive(path("report.docx")),
                Route::NewWindow {
                    path: path("report.docx")
                }
            );
        }

        #[test]
        fn a_document_closed_back_to_the_welcome_screen_can_take_one_again() {
            let mut launches = running();
            launches.vacancy(MAIN_WINDOW, false);
            launches.vacancy(MAIN_WINDOW, true);

            assert!(matches!(
                launches.arrive(path("report.docx")),
                Route::Deliver { .. }
            ));
        }
    }

    mod arguments {
        use super::*;

        #[test]
        fn the_program_and_the_flags_are_not_files() {
            let found = paths_from_arguments(
                [
                    "/Applications/orangery-docs",
                    "--flag",
                    "-psn_0_12345",
                    "/tmp/a.docx",
                ],
                Path::new("/"),
            );
            assert_eq!(found, vec!["/tmp/a.docx".to_string()]);
        }

        #[test]
        fn a_relative_path_is_relative_to_where_the_process_started() {
            let found = paths_from_arguments(["orangery-docs", "a.docx"], Path::new("/work"));
            assert_eq!(
                found,
                vec![Path::new("/work")
                    .join("a.docx")
                    .to_string_lossy()
                    .into_owned()]
            );
        }

        #[test]
        fn no_arguments_is_no_files() {
            assert!(paths_from_arguments(["orangery-docs"], Path::new("/")).is_empty());
        }
    }
}
