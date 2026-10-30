//! The panic hook, for real: a panic leaves a crash log behind.
//!
//! Its own test binary, because `trail::begin` installs a hook for the whole
//! process and can only be called once in it.

use std::fs;

use orangery_tauri_shared::trail;

#[test]
fn a_panic_is_written_down_before_the_process_goes() {
    let identifier = format!("orangery-trail-test-{}", std::process::id());
    let directory = trail::directory_for(&identifier).expect("a data directory");
    let _ = fs::remove_dir_all(directory.parent().expect("app data"));

    trail::begin(&identifier);
    trail::event("before the panic");

    // Caught, so the test can look afterwards. The hook runs before the
    // unwinding does, which is the same moment as in a release build where
    // the panic aborts instead.
    let caught = std::panic::catch_unwind(|| panic!("the thing that went wrong"));
    assert!(caught.is_err());

    let crash = fs::read_dir(&directory)
        .expect("logs")
        .filter_map(Result::ok)
        .find(|entry| entry.file_name().to_string_lossy().starts_with("crash-"))
        .expect("a crash log");
    let written = fs::read_to_string(crash.path()).expect("crash log contents");
    assert!(written.contains("the thing that went wrong"));
    assert!(written.contains("panic_trail.rs"));

    let launch = fs::read_to_string(directory.join(trail::LAUNCH_LOG)).expect("launch log");
    assert!(launch.contains("before the panic"));
    assert!(launch.contains("panic: the thing that went wrong"));

    // And a run that exits cleanly takes its marker with it.
    trail::clean_exit();
    assert!(!directory.join("running").exists());
    assert!(fs::read_to_string(directory.join(trail::LAUNCH_LOG))
        .expect("launch log")
        .contains("clean exit"));

    let _ = fs::remove_dir_all(directory.parent().expect("app data"));
}
