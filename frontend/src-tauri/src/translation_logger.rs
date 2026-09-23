use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// Maximum log file size before rotation: 5 MB (5 * 1024 * 1024 bytes)
const MAX_LOG_SIZE_BYTES: u64 = 5 * 1024 * 1024;
/// Retain up to 5 rotated backup files: bilingual_translation.1.log to bilingual_translation.5.log
const MAX_BACKUP_FILES: usize = 5;
const LOG_FILE_NAME: &str = "bilingual_translation.log";

static LOG_MUTEX: Mutex<()> = Mutex::new(());

/// Redact known API key patterns and authorization tokens from strings.
pub fn sanitize_log_content(raw: &str) -> String {
    // Redact Groq keys: gsk_[A-Za-z0-9_-]+
    let mut sanitized = raw.to_string();

    // Redact Bearer tokens
    if let Some(idx) = sanitized.find("Bearer ") {
        let after = &sanitized[idx + 7..];
        let token_end = after
            .find(|c: char| c.is_whitespace() || c == '"' || c == ',' || c == '}')
            .unwrap_or(after.len());
        let token = &after[..token_end];
        if !token.is_empty() {
            sanitized = sanitized.replace(token, "[REDACTED_AUTH_TOKEN]");
        }
    }

    // Mask any key starting with gsk_
    while let Some(start) = sanitized.find("gsk_") {
        let tail = &sanitized[start..];
        let end = tail
            .find(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            .unwrap_or(tail.len());
        let key = &tail[..end];
        sanitized = sanitized.replace(key, "[REDACTED_GROQ_KEY]");
    }

    // Mask any key starting with AIza
    while let Some(start) = sanitized.find("AIza") {
        let tail = &sanitized[start..];
        let end = tail
            .find(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            .unwrap_or(tail.len());
        let key = &tail[..end];
        sanitized = sanitized.replace(key, "[REDACTED_GEMINI_KEY]");
    }

    sanitized
}

/// Resolve the directory path for storing translation logs.
pub fn get_log_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let log_dir = app_data.join("logs");
    if !log_dir.exists() {
        fs::create_dir_all(&log_dir)
            .map_err(|e| format!("Failed to create translation log directory: {}", e))?;
    }
    Ok(log_dir)
}

/// Resolve the full path to the active translation log file.
pub fn get_log_file_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let log_dir = get_log_dir(app)?;
    Ok(log_dir.join(LOG_FILE_NAME))
}

/// Perform rotating log maintenance if the current log exceeds 5 MB.
fn rotate_if_needed(log_dir: &Path, active_file: &Path) {
    if let Ok(metadata) = fs::metadata(active_file) {
        if metadata.len() >= MAX_LOG_SIZE_BYTES {
            // Remove oldest backup if it exists
            let oldest = log_dir.join(format!("bilingual_translation.{}.log", MAX_BACKUP_FILES));
            if oldest.exists() {
                let _ = fs::remove_file(&oldest);
            }

            // Shift backups: (N-1) -> N
            for i in (1..MAX_BACKUP_FILES).rev() {
                let src = log_dir.join(format!("bilingual_translation.{}.log", i));
                let dst = log_dir.join(format!("bilingual_translation.{}.log", i + 1));
                if src.exists() {
                    let _ = fs::rename(&src, &dst);
                }
            }

            // Rotate active -> .1
            let first_backup = log_dir.join("bilingual_translation.1.log");
            let _ = fs::rename(active_file, &first_backup);
        }
    }
}

/// Append a sanitized line to the rotating persistent translation log.
pub fn append_log_line<R: Runtime>(app: &AppHandle<R>, line: &str) -> Result<(), String> {
    let log_dir = get_log_dir(app)?;
    let active_file = log_dir.join(LOG_FILE_NAME);

    let sanitized = sanitize_log_content(line);

    let _lock = LOG_MUTEX.lock().map_err(|_| "Failed to acquire log lock".to_string())?;

    rotate_if_needed(&log_dir, &active_file);

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&active_file)
        .map_err(|e| format!("Failed to open translation log file: {}", e))?;

    writeln!(file, "{}", sanitized)
        .map_err(|e| format!("Failed to write to translation log: {}", e))?;

    Ok(())
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Tauri command to append a log line to the persistent diagnostic log.
/// Sanitizes all inputs so secrets are never written to disk.
#[tauri::command]
pub async fn api_write_translation_log_line<R: Runtime>(
    app: AppHandle<R>,
    line: String,
) -> Result<(), String> {
    // Write asynchronously off the main thread to ensure zero UI/ASR impact
    tokio::task::spawn_blocking(move || {
        append_log_line(&app, &line)
    })
    .await
    .map_err(|e| format!("Log task panicked: {}", e))?
}

/// Tauri command to return the full absolute path of the active translation log file.
#[tauri::command]
pub async fn api_get_translation_log_path<R: Runtime>(
    app: AppHandle<R>,
) -> Result<String, String> {
    let path = get_log_file_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

/// Tauri command to open the translation log folder in the native file explorer.
#[tauri::command]
pub async fn api_open_translation_log_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    let log_dir = get_log_dir(&app)?;
    let folder_path = log_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitizes_groq_api_key() {
        let raw = "2026-09-22T13:15:00.000Z ERROR BILINGUAL-TRANSLATION key=gsk_98ab7c6d5e4f3a2b1c error=failed";
        let sanitized = sanitize_log_content(raw);
        assert!(!sanitized.contains("gsk_98ab7c6d5e4f3a2b1c"));
        assert!(sanitized.contains("[REDACTED_GROQ_KEY]"));
    }

    #[test]
    fn test_sanitizes_gemini_api_key() {
        let raw = "2026-09-22T13:15:00.000Z ERROR BILINGUAL-TRANSLATION key=AIzaSyA1234567890-abcdef error=failed";
        let sanitized = sanitize_log_content(raw);
        assert!(!sanitized.contains("AIzaSyA1234567890-abcdef"));
        assert!(sanitized.contains("[REDACTED_GEMINI_KEY]"));
    }

    #[test]
    fn test_sanitizes_bearer_auth_token() {
        let raw = "2026-09-22T13:15:00.000Z DEBUG BILINGUAL-TRANSLATION header=Bearer secret-token-xyz123";
        let sanitized = sanitize_log_content(raw);
        assert!(!sanitized.contains("secret-token-xyz123"));
        assert!(sanitized.contains("Bearer [REDACTED_AUTH_TOKEN]"));
    }
}
