// Local real-time translation module using Qwen 3.5 built-in AI model
// Provides robust JSON array parsing, sequence ID mapping, and error isolation.

use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tokio_util::sync::CancellationToken;

use super::client;

/// Single input transcript segment for translation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalTranslationInputSegment {
    pub id: i64,
    pub text: String,
}

/// Single translated output segment
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LocalTranslationOutputSegment {
    pub id: i64,
    pub translation: String,
}

/// Result of a local translation batch execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalTranslationBatchResult {
    pub successful_segments: Vec<LocalTranslationOutputSegment>,
    pub failed_ids: Vec<i64>,
    pub raw_response: String,
}

/// System instruction prompt tailored for real-time technical classroom translation
pub const LOCAL_TRANSLATION_SYSTEM_PROMPT: &str = "\
You are a professional English to Simplified Chinese translator for live technical classroom lectures.

Translate each English transcript segment into natural, concise Simplified Chinese.

Preserve technical terminology, commands, IP addresses, filenames, product names, acronyms, and configuration values accurately.
Convert spoken command forms (e.g., \"slash\" in commands like \"ipconfig slash all\") into standard technical syntax (e.g., \"ipconfig /all\").

Return ONLY a valid JSON array.

Each output object must contain exactly:
\"id\"
\"translation\"

The output IDs must exactly match the input IDs.

Do not output:
- markdown
- code fences
- explanations
- commentary
- thinking/reasoning
- English outside the required translation";

/// Translate 1-3 micro-batched transcript segments using local Qwen 3.5 4B via Tauri command
#[tauri::command]
pub async fn api_translate_local_batch<R: Runtime>(
    _app: AppHandle<R>,
    segments: Vec<LocalTranslationInputSegment>,
) -> Result<LocalTranslationBatchResult, String> {
    if segments.is_empty() {
        return Ok(LocalTranslationBatchResult {
            successful_segments: vec![],
            failed_ids: vec![],
            raw_response: "[]".to_string(),
        });
    }

    let models_dir = crate::shared_models::get_shared_summary_models_dir();
    let model_name = crate::shared_models::find_valid_shared_summary_model()
        .unwrap_or_else(|| "qwen3.5:4b".to_string());

    translate_local_batch(&models_dir, &model_name, &segments, None)
        .await
        .map_err(|e| format!("Local Qwen translation failed: {}", e))
}

/// Check if the required local Qwen model (Qwen3.5-4B-Q4_K_M.gguf) is available on disk
#[tauri::command]
pub async fn api_is_local_qwen_available<R: Runtime>(_app: AppHandle<R>) -> Result<bool, String> {
    Ok(crate::shared_models::find_valid_shared_summary_model().is_some())
}

/// Clean raw output from Qwen model before JSON parsing
pub fn clean_qwen_json_output(raw: &str) -> &str {
    let trimmed = raw.trim();

    // 1. Remove markdown fences ```json ... ``` or ``` ... ```
    let content = if trimmed.starts_with("```") {
        let after_opening = trimmed
            .strip_prefix("```json")
            .unwrap_or_else(|| trimmed.strip_prefix("```").unwrap_or(trimmed));
        let after_opening_trimmed = after_opening.trim_start();
        if let Some(end_idx) = after_opening_trimmed.rfind("```") {
            &after_opening_trimmed[..end_idx]
        } else {
            after_opening_trimmed
        }
    } else {
        trimmed
    };

    let content_trimmed = content.trim();

    // 2. If harmless leading/trailing text appears, extract the outer JSON array [...]
    if let (Some(start), Some(end)) = (content_trimmed.find('['), content_trimmed.rfind(']')) {
        if start <= end {
            return &content_trimmed[start..=end];
        }
    }

    content_trimmed
}

/// Parse raw model JSON response and strictly map returned translation IDs against input IDs.
///
/// NOTE: Invalid, duplicate, or missing IDs are NEVER silently index-aligned.
/// Any input ID that does not receive a valid matching translation object is marked in `failed_ids`.
pub fn parse_and_map_translation_response(
    raw_response: &str,
    inputs: &[LocalTranslationInputSegment],
) -> LocalTranslationBatchResult {
    let cleaned = clean_qwen_json_output(raw_response);

    // Set of expected valid input IDs
    let valid_input_ids: HashSet<i64> = inputs.iter().map(|i| i.id).collect();

    let mut successful_segments = Vec::new();
    let mut seen_ids = HashSet::new();

    // Attempt parsing JSON array
    if let Ok(parsed_items) = serde_json::from_str::<Vec<serde_json::Value>>(cleaned) {
        for item in parsed_items {
            if let Some(obj) = item.as_object() {
                // Extract id (supports integer or string containing integer)
                let id_opt = obj.get("id").and_then(|v| {
                    v.as_i64()
                        .or_else(|| v.as_u64().map(|u| u as i64))
                        .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
                });

                // Extract translation text
                let translation_opt = obj
                    .get("translation")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string());

                if let (Some(id), Some(translation)) = (id_opt, translation_opt) {
                    if !translation.is_empty()
                        && valid_input_ids.contains(&id)
                        && !seen_ids.contains(&id)
                    {
                        seen_ids.insert(id);
                        successful_segments.push(LocalTranslationOutputSegment { id, translation });
                    }
                }
            }
        }
    }

    // Determine failed IDs (any input ID not in successful_segments)
    let failed_ids: Vec<i64> = inputs
        .iter()
        .map(|i| i.id)
        .filter(|id| !seen_ids.contains(id))
        .collect();

    LocalTranslationBatchResult {
        successful_segments,
        failed_ids,
        raw_response: raw_response.to_string(),
    }
}

/// Translate 1-3 micro-batched transcript segments using local Qwen 3.5 4B
pub async fn translate_local_batch(
    app_data_dir: &PathBuf,
    model_name: &str,
    segments: &[LocalTranslationInputSegment],
    cancellation_token: Option<&CancellationToken>,
) -> Result<LocalTranslationBatchResult> {
    if segments.is_empty() {
        return Ok(LocalTranslationBatchResult {
            successful_segments: vec![],
            failed_ids: vec![],
            raw_response: "[]".to_string(),
        });
    }

    let user_prompt = serde_json::to_string(segments)?;

    // Limit max_tokens to 512 for batch translation
    let raw_response = client::generate_with_builtin_custom(
        app_data_dir,
        model_name,
        LOCAL_TRANSLATION_SYSTEM_PROMPT,
        &user_prompt,
        Some(512),
        cancellation_token,
    )
    .await?;

    Ok(parse_and_map_translation_response(&raw_response, segments))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_inputs() -> Vec<LocalTranslationInputSegment> {
        vec![
            LocalTranslationInputSegment {
                id: 101,
                text: "Today we will configure the default gateway.".to_string(),
            },
            LocalTranslationInputSegment {
                id: 102,
                text: "Make sure the server can reach the client.".to_string(),
            },
        ]
    }

    #[test]
    fn test_clean_json_parsing() {
        let inputs = sample_inputs();
        let raw = r#"[{"id":101,"translation":"今天我们将配置默认网关。"},{"id":102,"translation":"确保服务器可以访问客户端。"}]"#;

        let result = parse_and_map_translation_response(raw, &inputs);

        assert_eq!(result.successful_segments.len(), 2);
        assert_eq!(result.successful_segments[0].id, 101);
        assert_eq!(result.successful_segments[0].translation, "今天我们将配置默认网关。");
        assert_eq!(result.successful_segments[1].id, 102);
        assert_eq!(result.successful_segments[1].translation, "确保服务器可以访问客户端。");
        assert!(result.failed_ids.is_empty());
    }

    #[test]
    fn test_fenced_json_parsing() {
        let inputs = sample_inputs();
        let raw = "```json\n[{\"id\":101,\"translation\":\"今天我们将配置默认网关。\"},{\"id\":102,\"translation\":\"确保服务器 can reach client。\"}]\n```";

        let result = parse_and_map_translation_response(raw, &inputs);

        assert_eq!(result.successful_segments.len(), 2);
        assert_eq!(result.successful_segments[0].id, 101);
        assert_eq!(result.successful_segments[1].id, 102);
        assert!(result.failed_ids.is_empty());
    }

    #[test]
    fn test_harmless_leading_and_trailing_text() {
        let inputs = sample_inputs();
        let raw = "Here is the translated JSON array:\n[{\"id\":101,\"translation\":\"今天我们将配置默认网关。\"}]\nHope this helps!";

        let result = parse_and_map_translation_response(raw, &inputs);

        assert_eq!(result.successful_segments.len(), 1);
        assert_eq!(result.successful_segments[0].id, 101);
        assert_eq!(result.failed_ids, vec![102]);
    }

    #[test]
    fn test_missing_id_in_response() {
        let inputs = sample_inputs();
        let raw = r#"[{"id":101,"translation":"今天我们将配置默认网关。"}]"#;

        let result = parse_and_map_translation_response(raw, &inputs);

        assert_eq!(result.successful_segments.len(), 1);
        assert_eq!(result.successful_segments[0].id, 101);
        assert_eq!(result.failed_ids, vec![102]);
    }

    #[test]
    fn test_duplicate_id_in_response() {
        let inputs = sample_inputs();
        let raw = r#"[{"id":101,"translation":"今天我们将配置默认网关。"},{"id":101,"translation":"重复的翻译。"}]"#;

        let result = parse_and_map_translation_response(raw, &inputs);

        assert_eq!(result.successful_segments.len(), 1);
        assert_eq!(result.successful_segments[0].id, 101);
        assert_eq!(result.failed_ids, vec![102]);
    }

    #[test]
    fn test_unknown_id_in_response() {
        let inputs = sample_inputs();
        let raw = r#"[{"id":999,"translation":"未知ID的翻译。"}]"#;

        let result = parse_and_map_translation_response(raw, &inputs);

        assert!(result.successful_segments.is_empty());
        assert_eq!(result.failed_ids, vec![101, 102]);
    }

    #[test]
    fn test_partial_valid_batch() {
        let inputs = sample_inputs();
        let raw = r#"[{"id":101,"translation":"今天我们将配置默认网关。"},{"id":999,"translation":"无效ID。"}]"#;

        let result = parse_and_map_translation_response(raw, &inputs);

        assert_eq!(result.successful_segments.len(), 1);
        assert_eq!(result.successful_segments[0].id, 101);
        assert_eq!(result.failed_ids, vec![102]);
    }

    #[test]
    fn test_malformed_json_response() {
        let inputs = sample_inputs();
        let raw = r#"[{"id":101, translation: missing_quotes_or_invalid_json"#;

        let result = parse_and_map_translation_response(raw, &inputs);

        assert!(result.successful_segments.is_empty());
        assert_eq!(result.failed_ids, vec![101, 102]);
    }
}
