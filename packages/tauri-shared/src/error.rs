use serde::Serialize;

/// Every Tauri command returns `Result<T, AppError>` — see CLAUDE.md.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn io_errors_convert_into_app_error() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "missing.docx");
        let err: AppError = io.into();
        assert!(err.to_string().contains("missing.docx"));
    }

    #[test]
    fn app_error_serializes_to_its_message() {
        let err = AppError::Other("bad document".into());
        let json = serde_json::to_string(&err).expect("serialize");
        assert_eq!(json, "\"bad document\"");
    }
}
