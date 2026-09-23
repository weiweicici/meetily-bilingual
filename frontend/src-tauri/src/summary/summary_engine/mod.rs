// Built-in AI summary engine module
// Provides local LLM inference via llama-helper sidecar

pub mod client;
pub mod commands;
pub mod local_translation;
pub mod model_manager;
pub mod models;
pub mod sidecar;

// Re-export commonly used types
pub use client::{generate_with_builtin, generate_with_builtin_custom, is_sidecar_healthy, shutdown_sidecar_gracefully, force_shutdown_sidecar};
pub use commands::{
    __cmd__builtin_ai_cancel_download, __cmd__builtin_ai_delete_model,
    __cmd__builtin_ai_download_model, __cmd__builtin_ai_get_available_summary_model,
    __cmd__builtin_ai_get_model_info, __cmd__builtin_ai_get_recommended_model, __cmd__builtin_ai_is_model_ready,
    __cmd__builtin_ai_list_models, __tauri_command_name_builtin_ai_cancel_download,
    __tauri_command_name_builtin_ai_delete_model, __tauri_command_name_builtin_ai_download_model,
    __tauri_command_name_builtin_ai_get_available_summary_model,
    __tauri_command_name_builtin_ai_get_model_info,
    __tauri_command_name_builtin_ai_get_recommended_model,
    __tauri_command_name_builtin_ai_is_model_ready, __tauri_command_name_builtin_ai_list_models,
    builtin_ai_cancel_download, builtin_ai_delete_model, builtin_ai_download_model,
    builtin_ai_get_available_summary_model, builtin_ai_get_model_info, builtin_ai_get_recommended_model, builtin_ai_is_model_ready,
    builtin_ai_list_models, init_model_manager, ModelManagerState,
};
pub use local_translation::{
    __cmd__api_is_local_qwen_available, __cmd__api_translate_local_batch,
    __tauri_command_name_api_is_local_qwen_available, __tauri_command_name_api_translate_local_batch,
    api_is_local_qwen_available, api_translate_local_batch, clean_qwen_json_output,
    parse_and_map_translation_response, translate_local_batch, LocalTranslationBatchResult,
    LocalTranslationInputSegment, LocalTranslationOutputSegment,
};
pub use model_manager::{ModelInfo, ModelStatus};
pub use models::{get_available_models, get_default_model, get_model_by_name, ModelDef};
