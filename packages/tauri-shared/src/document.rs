//! Document file I/O.
//!
//! "Documents are sacred" (CLAUDE.md): a save must never be able to leave a
//! half-written file behind, and must never destroy the previous version without
//! keeping a copy. Every write here is temp → fsync → rename, which is atomic on
//! every filesystem we target, and the previous contents are moved to `.bak`
//! first.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::AppError;

#[derive(Debug, Serialize)]
pub struct LoadedDocument {
    /// File bytes, handed to the OOXML layer in the frontend.
    pub bytes: Vec<u8>,
    pub path: String,
    /// Modification time as milliseconds since the epoch, for staleness checks.
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveResult {
    pub path: String,
    pub backup_path: Option<String>,
}

fn to_string_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn modified_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as u64)
}

#[tauri::command]
pub async fn read_document(path: String) -> Result<LoadedDocument, AppError> {
    let path = PathBuf::from(path);
    let bytes = fs::read(&path)?;

    Ok(LoadedDocument {
        bytes,
        path: to_string_path(&path),
        modified_ms: modified_ms(&path),
    })
}

/// Writes `bytes` to `path` atomically, keeping one `.bak` of the previous file.
///
/// The temp file is created in the *destination directory* rather than the system
/// temp dir, because `rename` is only atomic within a filesystem — a temp file on
/// another volume would turn the final step into a copy, which is exactly the
/// non-atomic write we are avoiding.
#[tauri::command]
pub async fn write_document(
    path: String,
    bytes: Vec<u8>,
    keep_backup: bool,
) -> Result<SaveResult, AppError> {
    let destination = PathBuf::from(&path);

    let directory = destination
        .parent()
        .ok_or_else(|| AppError::Other(format!("cannot determine a directory for {path}")))?;
    fs::create_dir_all(directory)?;

    let file_name = destination
        .file_name()
        .ok_or_else(|| AppError::Other(format!("{path} has no file name")))?
        .to_string_lossy()
        .into_owned();

    let temporary = directory.join(format!(".{file_name}.tmp"));

    {
        let mut file = File::create(&temporary)?;
        file.write_all(&bytes)?;
        // Without this the rename can land before the data does, and a crash
        // leaves a correctly named file with no contents.
        file.sync_all()?;
    }

    let mut backup_path = None;
    if keep_backup && destination.exists() {
        let backup = destination.with_extension(match destination.extension() {
            Some(extension) => format!("{}.bak", extension.to_string_lossy()),
            None => "bak".to_string(),
        });
        // Copy rather than rename: renaming would leave no file at `destination`
        // for a moment, and a crash in that window loses the document entirely.
        fs::copy(&destination, &backup)?;
        backup_path = Some(to_string_path(&backup));
    }

    fs::rename(&temporary, &destination)?;

    Ok(SaveResult {
        path: to_string_path(&destination),
        backup_path,
    })
}

/// Stable key for a document's autosave directory.
///
/// Hashing the path keeps the directory name filesystem-safe and of bounded
/// length. An unsaved document has no path, so the frontend passes its session id.
#[tauri::command]
pub fn document_key(path: String) -> String {
    let digest = Sha256::digest(path.as_bytes());
    // 16 hex characters is plenty to avoid collisions among one user's documents.
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tauri::command]
pub async fn write_autosave(
    directory: String,
    name: String,
    contents: String,
) -> Result<(), AppError> {
    let directory = PathBuf::from(directory);
    fs::create_dir_all(&directory)?;

    let destination = directory.join(&name);
    let temporary = directory.join(format!(".{name}.tmp"));

    {
        let mut file = File::create(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&temporary, &destination)?;

    Ok(())
}

#[tauri::command]
pub async fn read_autosave(directory: String, name: String) -> Result<Option<String>, AppError> {
    let path = PathBuf::from(directory).join(name);
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(path)?))
}

#[tauri::command]
pub async fn clear_autosave(directory: String) -> Result<(), AppError> {
    let path = PathBuf::from(directory);
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

/// Autosave directories that still exist, i.e. documents that were not closed
/// cleanly. The frontend offers these on startup as crash recovery.
#[tauri::command]
pub async fn list_autosaves(root: String) -> Result<Vec<String>, AppError> {
    let root = PathBuf::from(root);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut directories = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            directories.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    directories.sort();
    Ok(directories)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_dir(name: &str) -> PathBuf {
        let directory = env::temp_dir().join(format!("orangery-test-{name}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("create temp dir");
        directory
    }

    #[tokio::test]
    async fn writes_and_reads_a_document() {
        let directory = temp_dir("write-read");
        let path = directory.join("doc.docx");

        write_document(to_string_path(&path), b"hello".to_vec(), false)
            .await
            .expect("write");

        let loaded = read_document(to_string_path(&path)).await.expect("read");
        assert_eq!(loaded.bytes, b"hello");
    }

    #[tokio::test]
    async fn keeps_a_backup_of_the_previous_contents() {
        let directory = temp_dir("backup");
        let path = directory.join("doc.docx");

        write_document(to_string_path(&path), b"first".to_vec(), true)
            .await
            .expect("first write");
        let result = write_document(to_string_path(&path), b"second".to_vec(), true)
            .await
            .expect("second write");

        let backup = result.backup_path.expect("backup path");
        assert_eq!(fs::read(&backup).expect("read backup"), b"first");
        assert_eq!(fs::read(&path).expect("read current"), b"second");
    }

    #[tokio::test]
    async fn makes_no_backup_on_the_first_save() {
        let directory = temp_dir("no-backup");
        let path = directory.join("doc.docx");

        let result = write_document(to_string_path(&path), b"only".to_vec(), true)
            .await
            .expect("write");
        assert!(result.backup_path.is_none());
    }

    #[tokio::test]
    async fn leaves_no_temporary_file_behind() {
        let directory = temp_dir("no-temp");
        let path = directory.join("doc.docx");

        write_document(to_string_path(&path), b"x".to_vec(), false)
            .await
            .expect("write");

        let leftovers: Vec<_> = fs::read_dir(&directory)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary file left behind");
    }

    #[tokio::test]
    async fn creates_missing_directories() {
        let directory = temp_dir("nested").join("a").join("b");
        let path = directory.join("doc.docx");

        write_document(to_string_path(&path), b"x".to_vec(), false)
            .await
            .expect("write");
        assert!(path.exists());
    }

    #[test]
    fn document_key_is_stable_and_bounded() {
        let first = document_key("/Users/x/doc.docx".to_string());
        let second = document_key("/Users/x/doc.docx".to_string());
        let other = document_key("/Users/x/other.docx".to_string());

        assert_eq!(first, second);
        assert_ne!(first, other);
        assert_eq!(first.len(), 16);
    }

    #[tokio::test]
    async fn autosave_round_trips_and_clears() {
        let directory = temp_dir("autosave").join("abc");

        write_autosave(
            to_string_path(&directory),
            "snapshot.json".into(),
            "{}".into(),
        )
        .await
        .expect("write autosave");

        let loaded = read_autosave(to_string_path(&directory), "snapshot.json".into())
            .await
            .expect("read autosave");
        assert_eq!(loaded.as_deref(), Some("{}"));

        clear_autosave(to_string_path(&directory))
            .await
            .expect("clear");
        assert!(!directory.exists());
    }

    #[tokio::test]
    async fn reading_a_missing_autosave_is_not_an_error() {
        let directory = temp_dir("missing-autosave");
        let loaded = read_autosave(to_string_path(&directory), "nope.json".into())
            .await
            .expect("read");
        assert!(loaded.is_none());
    }

    #[tokio::test]
    async fn lists_autosave_directories() {
        let root = temp_dir("list-autosaves");
        fs::create_dir_all(root.join("aaa")).expect("create");
        fs::create_dir_all(root.join("bbb")).expect("create");

        let listed = list_autosaves(to_string_path(&root)).await.expect("list");
        assert_eq!(listed, vec!["aaa".to_string(), "bbb".to_string()]);
    }
}

use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::OnceLock;

/// Windows the frontend has cleared for closing.
///
/// A close request is vetoed and handed to the frontend, which asks the user
/// about unsaved changes. When it calls `confirm_close`, the label is recorded
/// here so the second close request — the one the frontend triggers — is allowed
/// straight through instead of looping.
fn confirmed_windows() -> &'static Mutex<HashSet<String>> {
    static CONFIRMED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CONFIRMED.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn close_is_confirmed(label: &str) -> bool {
    confirmed_windows()
        .lock()
        .map(|confirmed| confirmed.contains(label))
        .unwrap_or(false)
}

/// Hands a close request to the window that received it.
///
/// Returns whether the close should be held back. The frontend owns "is there
/// anything unsaved?", because only it knows what is open.
///
/// Addressed to the one window rather than emitted at large. `Emitter::emit`
/// reaches every webview whatever it is called on, so with a second window open
/// closing either would ask both — and the other would answer for itself by
/// closing too.
///
/// By label rather than by `WebviewWindow`: that target only matches a listener
/// the runtime classified the same way, and which of the three kinds a webview's
/// listeners are registered as is not ours to decide. A label matches all of
/// them, and a label is what we mean.
pub fn close_requested<R: tauri::Runtime>(window: &tauri::Window<R>) -> bool {
    if close_is_confirmed(window.label()) {
        return false;
    }

    let _ = tauri::Emitter::emit_to(
        window,
        tauri::EventTarget::labeled(window.label()),
        "window:close-requested",
        window.label(),
    );
    true
}

#[tauri::command]
pub fn confirm_close(window: tauri::Window) -> Result<(), AppError> {
    if let Ok(mut confirmed) = confirmed_windows().lock() {
        confirmed.insert(window.label().to_string());
    }
    window.close().map_err(Into::into)
}

#[cfg(test)]
mod close_tests {
    use super::*;

    #[test]
    fn a_window_is_not_confirmed_until_it_is_recorded() {
        assert!(!close_is_confirmed("never-seen"));
    }

    #[test]
    fn recording_a_window_marks_it_confirmed() {
        confirmed_windows()
            .lock()
            .expect("lock")
            .insert("main-test".to_string());
        assert!(close_is_confirmed("main-test"));
        assert!(!close_is_confirmed("other-test"));
    }
}

/// Paths the OS handed the app at launch: a double-click, "Open With", or a
/// path typed on the command line.
///
/// Emitted rather than acted on, because opening one means parsing OOXML and
/// that lives in the frontend. The delay is not politeness: the event is sent
/// during setup, when there is no webview yet to receive it.
pub fn emit_launch_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let opened: Vec<String> = std::env::args()
        .skip(1)
        .filter(|argument| !argument.starts_with('-'))
        .collect();

    if opened.is_empty() {
        return;
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        let _ = tauri::Emitter::emit(&handle, "document:open-path", opened);
    });
}

/// Opens a new window, optionally on a given file.
///
/// One window holds one document (CLAUDE.md), so "New Window" and "open a second
/// file" are the same operation. The label has to be unique per window; a counter
/// is enough, and it keeps labels short for the close-confirmation bookkeeping.
#[tauri::command]
pub async fn open_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: Option<String>,
) -> Result<String, AppError> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static NEXT_LABEL: AtomicU32 = AtomicU32::new(1);

    let label = format!("win-{}", NEXT_LABEL.fetch_add(1, Ordering::Relaxed));

    let window =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title(app.package_info().name.as_str())
            .inner_size(1280.0, 840.0)
            .min_inner_size(720.0, 480.0)
            .build()?;

    if let Some(path) = path {
        // The webview has to exist before it can receive this.
        let target = window.clone();
        let addressee = label.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            // To the new window and no other. Emitted at large, this would also
            // reach the window that asked for it — which, on being told to open
            // a file it had just handed away, would open another window for it,
            // and another, for as long as anyone watched.
            let _ = tauri::Emitter::emit_to(
                &target,
                tauri::EventTarget::labeled(&addressee),
                "document:open-path",
                vec![path],
            );
        });
    }

    Ok(label)
}
