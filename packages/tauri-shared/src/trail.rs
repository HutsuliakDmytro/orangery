//! What the app was doing when it stopped.
//!
//! Written for one particular mystery: a process that was there and then was
//! not, with no crash report from macOS and nothing in the system log. A panic
//! leaves a crash report, and so does a segfault. Neither appeared, which
//! leaves a quiet exit, or a death no handler can see — a `SIGKILL`, a
//! watchdog — and the only way to tell those apart afterwards is to have been
//! writing things down beforehand.
//!
//! So three things, all under `<appdata>/logs/`:
//!
//! - **`launch.log`** — every lifecycle event in the first ten seconds of a
//!   run, which is where the mystery happened, and every event about the run
//!   ending, whenever it comes. Rotated, so a crash loop cannot fill a disk.
//! - **`crash-<seconds>.log`** — a panic's message, place and stack, written
//!   by the panic hook before the process goes. The release profile aborts on
//!   panic, and the hook runs first.
//! - **`running`** — a marker made at start and removed on a clean exit. If
//!   it is still there at the next start, the last run did not end cleanly,
//!   whatever killed it. This is the part that catches what no hook can.
//!
//! Strictly local, like `diagnostics`: nothing here is sent anywhere.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// How long after start every event is written down. Long enough for a cold
/// launch onto a file, short enough that a day's use does not fill the log.
pub const WINDOW: Duration = Duration::from_secs(10);

/// One log's worth before it is moved aside. A launch is a few dozen lines.
const MAX_LOG_BYTES: u64 = 256 * 1024;

pub const LAUNCH_LOG: &str = "launch.log";
const RUNNING: &str = "running";

/// The run before this one, if it did not end cleanly.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviousRun {
    /// What the marker said: the process and when it started.
    pub marker: String,
    /// Where its events are.
    pub launch_log: String,
    /// The panic, if there was one.
    pub crash_log: Option<String>,
}

struct Trail {
    directory: PathBuf,
    started: Instant,
    previous: Option<PreviousRun>,
    /// Serialises writes: the panic hook and the run loop can both be writing.
    lock: Mutex<()>,
}

static TRAIL: OnceLock<Trail> = OnceLock::new();

/// Where the logs go: `logs` under the directory Tauri calls app data, worked
/// out the same way Tauri does, because the panic hook has to know it before
/// there is an app to ask.
pub fn directory_for(identifier: &str) -> Option<PathBuf> {
    dirs::data_dir().map(|data| data.join(identifier).join("logs"))
}

fn seconds_since_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn millis_since_epoch() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// Moves a log aside once it is past the cap, keeping one previous file.
fn rotate(path: &Path) {
    if fs::metadata(path).is_ok_and(|metadata| metadata.len() >= MAX_LOG_BYTES) {
        let older = path.with_extension("log.1");
        let _ = fs::remove_file(&older);
        let _ = fs::rename(path, older);
    }
}

fn append(path: &Path, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
        // A process about to die does not flush for anybody.
        let _ = file.sync_data();
    }
}

/// The newest crash log written since `since`, if any.
fn crash_since(directory: &Path, since: u64) -> Option<PathBuf> {
    fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stamp: u64 = name
                .strip_prefix("crash-")?
                .strip_suffix(".log")?
                .parse()
                .ok()?;
            (stamp >= since).then_some((stamp, entry.path()))
        })
        .max_by_key(|(stamp, _)| *stamp)
        .map(|(_, path)| path)
}

/// Looks at what the last run left behind, and starts this one's marker.
///
/// Pure enough to test: it touches only the directory it is given.
pub fn open_directory(directory: &Path) -> Option<PreviousRun> {
    let _ = fs::create_dir_all(directory);
    let marker_path = directory.join(RUNNING);
    let launch_log = directory.join(LAUNCH_LOG);

    let previous = fs::read_to_string(&marker_path).ok().map(|marker| {
        // `started=<seconds>` is in the marker; a crash log from after that
        // is this run's predecessor's.
        let started = marker
            .split_whitespace()
            .find_map(|field| field.strip_prefix("started="))
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        PreviousRun {
            marker: marker.trim().to_string(),
            launch_log: launch_log.to_string_lossy().into_owned(),
            crash_log: crash_since(directory, started)
                .map(|path| path.to_string_lossy().into_owned()),
        }
    });

    rotate(&launch_log);
    let marker = format!(
        "pid={} started={}",
        std::process::id(),
        seconds_since_epoch()
    );
    let _ = fs::write(&marker_path, &marker);
    append(&launch_log, &format!("=== launch {marker}"));
    if let Some(previous) = &previous {
        append(
            &launch_log,
            &format!(
                "    the run before this one did not exit cleanly ({})",
                previous.marker
            ),
        );
    }

    previous
}

/// Starts the trail for this run. Called first thing in each app's `run`.
///
/// Installs the panic hook, so it has to come before anything that could
/// panic; and it reads the previous run's marker before writing this one's.
pub fn begin(identifier: &str) {
    let Some(directory) = directory_for(identifier) else {
        return;
    };
    let previous = open_directory(&directory);

    let trail = Trail {
        directory,
        started: Instant::now(),
        previous,
        lock: Mutex::new(()),
    };
    if TRAIL.set(trail).is_err() {
        return;
    }

    let earlier = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Taken apart here rather than handed on, so the type of `info` is
        // never named: it was renamed in Rust 1.81, and the workspace builds
        // on 1.77.
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|text| (*text).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "a panic with no message".to_string());
        let place = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_default();
        record_panic(&message, &place);
        earlier(info);
    }));
}

fn record_panic(message: &str, place: &str) {
    let Some(trail) = TRAIL.get() else { return };
    // Not `lock()`: a panic while the lock is held would wait on itself.
    let _guard = trail.lock.try_lock();

    let thread = std::thread::current()
        .name()
        .unwrap_or("unnamed")
        .to_string();
    // Addresses only in a release build, which strips symbols: still enough
    // to match against an unstripped build of the same commit.
    let stack = std::backtrace::Backtrace::force_capture();

    let path = trail
        .directory
        .join(format!("crash-{}.log", seconds_since_epoch()));
    append(
        &path,
        &format!("panic on thread '{thread}' at {place}\n{message}\n\n{stack}"),
    );
    append(
        &trail.directory.join(LAUNCH_LOG),
        &format!(
            "{:>7} ms  panic: {message} ({place}) — see {}",
            trail.started.elapsed().as_millis(),
            path.display()
        ),
    );
}

/// Writes down a lifecycle event, if this run is young enough for it to be
/// worth having.
pub fn event(what: &str) {
    let Some(trail) = TRAIL.get() else { return };
    let elapsed = trail.started.elapsed();
    if elapsed > WINDOW {
        return;
    }
    write(trail, elapsed, what);
}

/// Writes down an event however late in the run it comes: the ones about
/// the run ending, which are the end of the story whenever it ends.
pub fn ending(what: &str) {
    let Some(trail) = TRAIL.get() else { return };
    write(trail, trail.started.elapsed(), what);
}

fn write(trail: &Trail, elapsed: Duration, what: &str) {
    let _guard = trail.lock.lock();
    append(
        &trail.directory.join(LAUNCH_LOG),
        &format!(
            "{:>7} ms  {what}  (t={})",
            elapsed.as_millis(),
            millis_since_epoch()
        ),
    );
}

/// The run is ending the way it is meant to. The marker goes, so the next
/// start does not mistake this for a crash.
pub fn clean_exit() {
    let Some(trail) = TRAIL.get() else { return };
    ending("clean exit");
    let _ = fs::remove_file(trail.directory.join(RUNNING));
}

/// For the page: the run before this one, if it did not end cleanly. Asked
/// once; the answer is the same every time it is asked in this run.
#[tauri::command]
pub fn previous_run() -> Option<PreviousRun> {
    TRAIL.get().and_then(|trail| trail.previous.clone())
}

/// Shows a log in the file manager, selected, so it can be attached to a
/// report without anybody typing a path.
#[tauri::command]
pub fn reveal_log(path: String) -> Result<(), crate::AppError> {
    let path = PathBuf::from(path);
    // Only files this module wrote: a command that opens arbitrary paths in
    // a file manager is not one to leave lying around.
    let inside = TRAIL
        .get()
        .is_some_and(|trail| path.starts_with(&trail.directory));
    if !inside {
        return Err(crate::AppError::Other("not one of the app's logs".into()));
    }

    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open")
        .arg(path.parent().unwrap_or(&path))
        .status();

    status.map(|_| ()).map_err(crate::AppError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "orangery-trail-{name}-{}-{}",
            std::process::id(),
            millis_since_epoch()
        ));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn a_first_run_has_nothing_before_it() {
        let directory = directory("first");
        assert_eq!(open_directory(&directory), None);
        assert!(directory.join(RUNNING).exists());
    }

    #[test]
    fn a_run_that_left_its_marker_behind_did_not_exit_cleanly() {
        let directory = directory("killed");
        open_directory(&directory);

        // Killed: nothing removed the marker.
        let previous = open_directory(&directory).expect("the run before");
        assert!(previous.marker.starts_with("pid="));
        assert!(previous.launch_log.ends_with(LAUNCH_LOG));
        assert_eq!(previous.crash_log, None);
    }

    #[test]
    fn a_run_that_removed_its_marker_exited_cleanly() {
        let directory = directory("clean");
        open_directory(&directory);
        fs::remove_file(directory.join(RUNNING)).expect("clean exit");

        assert_eq!(open_directory(&directory), None);
    }

    #[test]
    fn a_crash_log_from_that_run_is_pointed_at() {
        let directory = directory("panicked");
        open_directory(&directory);
        let crash = directory.join(format!("crash-{}.log", seconds_since_epoch()));
        fs::write(&crash, "panic").expect("crash log");

        let previous = open_directory(&directory).expect("the run before");
        assert_eq!(
            previous.crash_log,
            Some(crash.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn a_crash_log_from_an_older_run_is_not_blamed_on_this_one() {
        let directory = directory("stale");
        fs::create_dir_all(&directory).expect("directory");
        fs::write(directory.join("crash-1.log"), "a long time ago").expect("old crash");
        open_directory(&directory);

        let previous = open_directory(&directory).expect("the run before");
        assert_eq!(previous.crash_log, None);
    }

    #[test]
    fn every_launch_is_headed_in_the_log() {
        let directory = directory("headed");
        open_directory(&directory);
        open_directory(&directory);

        let log = fs::read_to_string(directory.join(LAUNCH_LOG)).expect("log");
        assert_eq!(log.matches("=== launch pid=").count(), 2);
        assert!(log.contains("did not exit cleanly"));
    }

    #[test]
    fn a_full_log_is_moved_aside_rather_than_grown() {
        let directory = directory("rotated");
        fs::create_dir_all(&directory).expect("directory");
        let log = directory.join(LAUNCH_LOG);
        fs::write(&log, vec![b'x'; MAX_LOG_BYTES as usize]).expect("full log");

        open_directory(&directory);

        assert!(directory.join("launch.log.1").exists());
        assert!(fs::metadata(&log).expect("new log").len() < 1024);
    }
}
