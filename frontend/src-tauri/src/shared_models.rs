// Canonical Shared Models storage for Meetily Bilingual
// Keeps large AI models shared across different build flavors/identifiers
// (e.g. com.meetily.bilingual, com.meetily.bilingual.dev) without redownloading.

use std::path::PathBuf;

/// Return the canonical root directory for shared AI models.
/// On Windows, this resolves to:
/// %LOCALAPPDATA%\Meetily Bilingual\SharedModels
/// On other platforms, it falls back to the system data directory / Meetily Bilingual / SharedModels.
pub fn get_shared_models_root() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = dirs::data_local_dir() {
            return local_app_data.join("Meetily Bilingual").join("SharedModels");
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(data_dir) = dirs::data_dir() {
            return data_dir.join("Meetily Bilingual").join("SharedModels");
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(data_dir) = dirs::data_dir() {
            return data_dir.join("Meetily Bilingual").join("SharedModels");
        }
    }

    // Ultimate fallback if standard directories cannot be resolved
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".meetily_bilingual")
        .join("SharedModels")
}

/// Return the directory for Parakeet speech recognition models.
/// Structure: <SharedModels>/parakeet
pub fn get_shared_parakeet_models_dir() -> PathBuf {
    get_shared_models_root().join("parakeet")
}

/// Return the directory for built-in AI summarization models (GGUF).
/// Structure: <SharedModels>/summary
pub fn get_shared_summary_models_dir() -> PathBuf {
    get_shared_models_root().join("summary")
}

/// Ensure that the shared models directory structure exists.
pub fn ensure_shared_models_dirs() -> std::io::Result<()> {
    let parakeet_dir = get_shared_parakeet_models_dir();
    let summary_dir = get_shared_summary_models_dir();

    if !parakeet_dir.exists() {
        std::fs::create_dir_all(&parakeet_dir)?;
    }

    if !summary_dir.exists() {
        std::fs::create_dir_all(&summary_dir)?;
    }

    Ok(())
}

/// Validate that the shared Parakeet v3 transcription model exists and all artifacts match expected byte sizes.
pub fn validate_shared_parakeet_model() -> bool {
    let parakeet_dir = get_shared_parakeet_models_dir().join("parakeet-tdt-0.6b-v3-int8");
    if !parakeet_dir.exists() {
        return false;
    }

    const ARTIFACTS: [(&str, u64); 4] = [
        ("encoder-model.int8.onnx", 652_183_999),
        ("decoder_joint-model.int8.onnx", 18_202_004),
        ("nemo128.onnx", 139_764),
        ("vocab.txt", 93_939),
    ];

    for (filename, expected_bytes) in ARTIFACTS {
        let path = parakeet_dir.join(filename);
        match std::fs::metadata(&path) {
            Ok(metadata) => {
                if metadata.len() != expected_bytes {
                    log::warn!(
                        "Parakeet artifact {} has size {} bytes, expected {}",
                        filename,
                        metadata.len(),
                        expected_bytes
                    );
                    return false;
                }
            }
            Err(_) => return false,
        }
    }

    true
}

/// Validate that a GGUF file exists, has expected size range, and begins with GGUF magic bytes.
fn is_valid_gguf_file(path: &std::path::Path, expected_mb: u64) -> bool {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let file_len = metadata.len();
    let file_mb = file_len / (1024 * 1024);
    let expected_min = (expected_mb as f64 * 0.9) as u64;
    let expected_max = (expected_mb as f64 * 1.1) as u64;
    if file_mb < expected_min || file_mb > expected_max {
        log::warn!(
            "GGUF file {:?} size {} MB outside expected range {}-{} MB",
            path,
            file_mb,
            expected_min,
            expected_max
        );
        return false;
    }

    if let Ok(mut file) = std::fs::File::open(path) {
        use std::io::Read;
        let mut magic = [0u8; 4];
        if file.read_exact(&mut magic).is_ok() && &magic == b"GGUF" {
            return true;
        }
    }

    false
}

/// Find a valid summary model in the shared summary models directory.
/// Returns the model identifier (e.g. "qwen3.5:4b") in priority order if found.
pub fn find_valid_shared_summary_model() -> Option<String> {
    let summary_dir = get_shared_summary_models_dir();
    if !summary_dir.exists() {
        return None;
    }

    // Models in priority order matching summary_model_priority
    const CANDIDATES: [(&str, &str, u64); 4] = [
        ("qwen3.5:4b", "Qwen3.5-4B-Q4_K_M.gguf", 2614),
        ("qwen3.5:2b", "Qwen3.5-2B-Q4_K_M.gguf", 1221),
        ("gemma3:4b", "gemma-3-4b-it-Q4_K_M.gguf", 2374),
        ("gemma3:1b", "gemma-3-1b-it-Q8_0.gguf", 1019),
    ];

    for (model_name, filename, size_mb) in CANDIDATES {
        let path = summary_dir.join(filename);
        if is_valid_gguf_file(&path, size_mb) {
            log::info!("Found valid shared summary model: {} at {:?}", model_name, path);
            return Some(model_name.to_string());
        }
    }

    None
}

/// Check if both Parakeet transcription engine and a summary engine model are verified ready in SharedModels.
/// Returns Some(summary_model_name) if ready, or None if either engine is missing/invalid.
pub fn check_shared_models_readiness() -> Option<String> {
    if !validate_shared_parakeet_model() {
        log::info!("Shared Parakeet model not verified ready on disk");
        return None;
    }

    let summary_model = find_valid_shared_summary_model();
    if summary_model.is_none() {
        log::info!("Shared summary model not verified ready on disk");
    }
    summary_model
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shared_models_root_ends_with_shared_models() {
        let root = get_shared_models_root();
        assert!(root.ends_with("Meetily Bilingual\\SharedModels") || root.ends_with("Meetily Bilingual/SharedModels"));
    }

    #[test]
    fn test_shared_subdirectories() {
        let parakeet = get_shared_parakeet_models_dir();
        let summary = get_shared_summary_models_dir();
        assert!(parakeet.ends_with("parakeet"));
        assert!(summary.ends_with("summary"));
    }

    #[test]
    fn test_shared_models_readiness_on_disk() {
        // Since we migrated models, verify that the shared models exist and pass validation
        let parakeet_ok = validate_shared_parakeet_model();
        assert!(parakeet_ok, "Shared Parakeet v3 model must be valid");

        let summary_model = find_valid_shared_summary_model();
        assert_eq!(summary_model.as_deref(), Some("qwen3.5:4b"), "Shared Qwen 3.5 4B model must be valid");

        let ready = check_shared_models_readiness();
        assert_eq!(ready.as_deref(), Some("qwen3.5:4b"), "Both engines must be ready");
    }
}

