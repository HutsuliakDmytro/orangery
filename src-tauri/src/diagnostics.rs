//! Local crash and error logging.
//!
//! Strictly local: the log is written to the app's own data directory and never
//! sent anywhere. CLAUDE.md rules out telemetry in the MVP, and a word processor
//! that phones home about a document is a worse problem than a lost stack trace.
//!
//! The log is capped and rotated, because a crash loop would otherwise fill the
//! user's disk — which is exactly what happened to us during development.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::AppError;

/// Kept small deliberately: this is for the last few failures, not history.
const MAX_LOG_BYTES: u64 = 512 * 1024;

pub const LOG_FILE_NAME: &str = "orangery.log";

fn log_path(directory: &Path) -> PathBuf {
    directory.join(LOG_FILE_NAME)
}

/// Moves the log aside once it grows past the cap, keeping one previous file.
fn rotate_if_needed(path: &Path) -> Result<(), AppError> {
    let size = match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(_) => return Ok(()),
    };

    if size < MAX_LOG_BYTES {
        return Ok(());
    }

    let previous = path.with_extension("log.1");
    // Replaces the older rotation rather than accumulating them.
    let _ = fs::remove_file(&previous);
    fs::rename(path, previous)?;
    Ok(())
}

fn timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("{now}")
}

#[tauri::command]
pub async fn write_diagnostic(
    directory: String,
    level: String,
    message: String,
) -> Result<(), AppError> {
    let directory = PathBuf::from(directory);
    fs::create_dir_all(&directory)?;

    let path = log_path(&directory);
    rotate_if_needed(&path)?;

    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    // One line per entry so the file stays greppable.
    writeln!(
        file,
        "{} [{}] {}",
        timestamp(),
        level,
        message.replace('\n', " ")
    )?;

    Ok(())
}

/// The log contents, for the "copy diagnostics" action in Settings.
#[tauri::command]
pub async fn read_diagnostics(directory: String) -> Result<String, AppError> {
    let path = log_path(&PathBuf::from(directory));
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(fs::read_to_string(path)?)
}

#[tauri::command]
pub async fn clear_diagnostics(directory: String) -> Result<(), AppError> {
    let path = log_path(&PathBuf::from(directory));
    let _ = fs::remove_file(path.with_extension("log.1"));
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_dir(name: &str) -> PathBuf {
        let directory = env::temp_dir().join(format!("orangery-diag-{name}"));
        let _ = fs::remove_dir_all(&directory);
        fs::create_dir_all(&directory).expect("create");
        directory
    }

    #[tokio::test]
    async fn writes_one_line_per_entry() {
        let directory = temp_dir("lines");
        let path = directory.to_string_lossy().into_owned();

        write_diagnostic(path.clone(), "error".into(), "first".into())
            .await
            .expect("write");
        write_diagnostic(path.clone(), "warn".into(), "second".into())
            .await
            .expect("write");

        let contents = read_diagnostics(path).await.expect("read");
        assert_eq!(contents.lines().count(), 2);
        assert!(contents.contains("[error] first"));
    }

    #[tokio::test]
    async fn flattens_multi_line_messages() {
        let directory = temp_dir("flatten");
        let path = directory.to_string_lossy().into_owned();

        write_diagnostic(path.clone(), "error".into(), "line one\nline two".into())
            .await
            .expect("write");

        let contents = read_diagnostics(path).await.expect("read");
        assert_eq!(contents.lines().count(), 1);
    }

    #[tokio::test]
    async fn rotates_once_past_the_cap() {
        let directory = temp_dir("rotate");
        let path = directory.to_string_lossy().into_owned();

        // One oversized entry is enough to trigger the next write to rotate.
        let big = "x".repeat((MAX_LOG_BYTES as usize) + 1);
        write_diagnostic(path.clone(), "error".into(), big)
            .await
            .expect("write");
        write_diagnostic(path.clone(), "error".into(), "after".into())
            .await
            .expect("write");

        assert!(log_path(&directory).with_extension("log.1").exists());
        let contents = read_diagnostics(path).await.expect("read");
        assert!(contents.contains("after"));
        assert!(contents.len() < MAX_LOG_BYTES as usize);
    }

    #[tokio::test]
    async fn keeps_only_one_rotation() {
        let directory = temp_dir("one-rotation");
        let path = directory.to_string_lossy().into_owned();
        let big = "x".repeat((MAX_LOG_BYTES as usize) + 1);

        for _ in 0..3 {
            write_diagnostic(path.clone(), "error".into(), big.clone())
                .await
                .expect("write");
        }

        let rotations = fs::read_dir(&directory)
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().contains(".log."))
            .count();
        assert_eq!(rotations, 1);
    }

    #[tokio::test]
    async fn reading_a_missing_log_is_not_an_error() {
        let directory = temp_dir("missing");
        let contents = read_diagnostics(directory.to_string_lossy().into_owned())
            .await
            .expect("read");
        assert!(contents.is_empty());
    }

    #[tokio::test]
    async fn clearing_removes_both_files() {
        let directory = temp_dir("clear");
        let path = directory.to_string_lossy().into_owned();
        let big = "x".repeat((MAX_LOG_BYTES as usize) + 1);

        write_diagnostic(path.clone(), "error".into(), big)
            .await
            .expect("write");
        write_diagnostic(path.clone(), "error".into(), "after".into())
            .await
            .expect("write");

        clear_diagnostics(path.clone()).await.expect("clear");
        assert!(read_diagnostics(path).await.expect("read").is_empty());
        assert!(!log_path(&directory).with_extension("log.1").exists());
    }
}
