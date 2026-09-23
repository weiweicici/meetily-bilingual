use keyring::Entry;
use tokio::sync::Mutex as TokioMutex;

const SERVICE_NAME: &str = "meetily";
const USERNAME_GEMINI: &str = "gemini_api_key";
const USERNAME_GROQ: &str = "groq_api_key";

lazy_static::lazy_static! {
    /// Mutex to strictly serialize all credential operations across async tasks.
    /// This ensures atomic write/read/delete sequences and prevents race conditions,
    /// particularly with Windows Credential Manager and macOS Keychain concurrency quirks.
    static ref CREDENTIAL_MUTEX: TokioMutex<()> = TokioMutex::new(());
}

/// Constant-time byte slice comparison to prevent timing attacks.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ---------------------------------------------------------------------------
// Test-only mock infrastructure
// ---------------------------------------------------------------------------
//
// ALL of this is compiled only when running `cargo test`.
// Release builds never see MockFailureMode, MOCK_STORE, USE_MOCK_STORE,
// set_mock_mode, reset_mock_store, or set_mock_failure_mode.
// ---------------------------------------------------------------------------

#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(test)]
use std::sync::Mutex as StdMutex;
#[cfg(test)]
use std::collections::HashMap;

#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MockFailureMode {
    None,
    ReadBackMismatch,
    ReadBackError,
    ReadError,
    WriteError,
}

#[cfg(test)]
struct MockStoreState {
    secrets: HashMap<String, String>,
    failure_mode: MockFailureMode,
    fail_next_read: bool,
}

#[cfg(test)]
lazy_static::lazy_static! {
    static ref MOCK_STORE: StdMutex<MockStoreState> = StdMutex::new(MockStoreState {
        secrets: HashMap::new(),
        failure_mode: MockFailureMode::None,
        fail_next_read: false,
    });
}

#[cfg(test)]
static USE_MOCK_STORE: AtomicBool = AtomicBool::new(false);

// ---------------------------------------------------------------------------
// Synchronous raw operations — production path uses real keyring, test path
// checks USE_MOCK_STORE first.
// ---------------------------------------------------------------------------

fn set_raw_sync(username: &str, key: &str) -> Result<(), String> {
    #[cfg(test)]
    if USE_MOCK_STORE.load(Ordering::SeqCst) {
        let mut lock = MOCK_STORE
            .lock()
            .map_err(|_| "Mock store lock poisoned".to_string())?;
        if lock.failure_mode == MockFailureMode::WriteError {
            return Err("Simulated keyring write error".to_string());
        }
        if lock.failure_mode == MockFailureMode::ReadBackMismatch {
            lock.secrets.insert(username.to_string(), "corrupted_mismatched_key".to_string());
            lock.failure_mode = MockFailureMode::None;
            return Ok(());
        }
        if lock.failure_mode == MockFailureMode::ReadBackError {
            lock.secrets.insert(username.to_string(), key.to_string());
            lock.fail_next_read = true;
            lock.failure_mode = MockFailureMode::None;
            return Ok(());
        }
        lock.secrets.insert(username.to_string(), key.to_string());
        return Ok(());
    }

    let entry = Entry::new(SERVICE_NAME, username)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    entry
        .set_password(key)
        .map_err(|e| format!("Failed to save credential to system keyring: {}", e))
}

fn get_raw_sync(username: &str) -> Result<Option<String>, String> {
    #[cfg(test)]
    if USE_MOCK_STORE.load(Ordering::SeqCst) {
        let mut lock = MOCK_STORE
            .lock()
            .map_err(|_| "Mock store lock poisoned".to_string())?;
        if lock.failure_mode == MockFailureMode::ReadError {
            return Err("Simulated keyring read error".to_string());
        }
        if lock.fail_next_read {
            lock.fail_next_read = false;
            return Err("Simulated keyring read-back error".to_string());
        }
        return Ok(lock.secrets.get(username).cloned());
    }

    let entry = Entry::new(SERVICE_NAME, username)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    match entry.get_password() {
        Ok(password) => {
            let trimmed = password.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!(
            "Failed to read credential from system keyring: {}",
            e
        )),
    }
}

fn delete_raw_sync(username: &str) -> Result<(), String> {
    #[cfg(test)]
    if USE_MOCK_STORE.load(Ordering::SeqCst) {
        let mut lock = MOCK_STORE
            .lock()
            .map_err(|_| "Mock store lock poisoned".to_string())?;
        lock.secrets.remove(username);
        return Ok(());
    }

    let entry = Entry::new(SERVICE_NAME, username)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "Failed to delete credential from system keyring: {}",
            e
        )),
    }
}

// ---------------------------------------------------------------------------
// Public async API
// ---------------------------------------------------------------------------

/// Cross-platform secure credential manager.
/// Uses the operating system's native secure credential vault:
/// - Windows: Windows Credential Manager (`windows-native`)
/// - macOS: Apple Keychain Services (`apple-native`)
/// - Linux: Freedesktop Secret Service (`sync-secret-service` + `crypto-rust`)
pub struct CredentialManager;

impl CredentialManager {
    // --- Gemini API Key Operations ---

    /// Asynchronous, non-blocking, serialized save operation for Gemini API Key.
    pub async fn set_gemini_api_key(candidate_key: &str) -> Result<(), String> {
        Self::set_key_internal(USERNAME_GEMINI, candidate_key).await
    }

    /// Asynchronous, non-blocking, atomic migration operation for Gemini API Key.
    pub async fn migrate_gemini_api_key(candidate_key: &str) -> Result<(), String> {
        Self::set_gemini_api_key(candidate_key).await
    }

    /// Asynchronous, non-blocking, serialized get operation for Gemini API Key.
    pub async fn get_gemini_api_key() -> Result<Option<String>, String> {
        Self::get_key_internal(USERNAME_GEMINI).await
    }

    /// Asynchronous, non-blocking, serialized delete operation for Gemini API Key.
    pub async fn delete_gemini_api_key() -> Result<(), String> {
        Self::delete_key_internal(USERNAME_GEMINI).await
    }

    /// Asynchronous, non-blocking check whether the Gemini key is configured.
    pub async fn is_gemini_configured() -> Result<bool, String> {
        match Self::get_gemini_api_key().await {
            Ok(Some(k)) => Ok(!k.trim().is_empty()),
            Ok(None) => Ok(false),
            Err(e) => Err(e),
        }
    }

    // --- Groq API Key Operations ---

    /// Asynchronous, non-blocking, serialized save operation for Groq API Key.
    pub async fn set_groq_api_key(candidate_key: &str) -> Result<(), String> {
        Self::set_key_internal(USERNAME_GROQ, candidate_key).await
    }

    /// Asynchronous, non-blocking, serialized get operation for Groq API Key.
    pub async fn get_groq_api_key() -> Result<Option<String>, String> {
        Self::get_key_internal(USERNAME_GROQ).await
    }

    /// Asynchronous, non-blocking, serialized delete operation for Groq API Key.
    pub async fn delete_groq_api_key() -> Result<(), String> {
        Self::delete_key_internal(USERNAME_GROQ).await
    }

    /// Asynchronous, non-blocking check whether the Groq key is configured.
    pub async fn is_groq_configured() -> Result<bool, String> {
        match Self::get_groq_api_key().await {
            Ok(Some(k)) => Ok(!k.trim().is_empty()),
            Ok(None) => Ok(false),
            Err(e) => Err(e),
        }
    }

    // --- Internal Helpers ---

    async fn set_key_internal(username: &'static str, candidate_key: &str) -> Result<(), String> {
        let trimmed = candidate_key.trim().to_string();
        if trimmed.is_empty() {
            return Err("API key cannot be empty".to_string());
        }

        let _guard = CREDENTIAL_MUTEX.lock().await;

        tokio::task::spawn_blocking(move || {
            // Step 1: Backup previous credential value
            let previous = get_raw_sync(username)?;

            // Step 2: Write candidate key
            set_raw_sync(username, &trimmed)?;

            // Step 3: Read back and verify with constant-time comparison
            let read_back = get_raw_sync(username);
            let verified = match read_back {
                Ok(Some(ref val)) => constant_time_eq(val.as_bytes(), trimmed.as_bytes()),
                _ => false,
            };

            if !verified {
                // Step 4: Rollback to previous state on failure
                if let Some(ref old) = previous {
                    let _ = set_raw_sync(username, old);
                } else {
                    let _ = delete_raw_sync(username);
                }
                return Err(
                    "Credential store verification failed: read-back did not match written key"
                        .to_string(),
                );
            }

            Ok(())
        })
        .await
        .map_err(|e| format!("Credential task join error: {}", e))?
    }

    async fn get_key_internal(username: &'static str) -> Result<Option<String>, String> {
        let _guard = CREDENTIAL_MUTEX.lock().await;

        tokio::task::spawn_blocking(move || get_raw_sync(username))
            .await
            .map_err(|e| format!("Credential task join error: {}", e))?
    }

    async fn delete_key_internal(username: &'static str) -> Result<(), String> {
        let _guard = CREDENTIAL_MUTEX.lock().await;

        tokio::task::spawn_blocking(move || delete_raw_sync(username))
            .await
            .map_err(|e| format!("Credential task join error: {}", e))?
    }

    // -----------------------------------------------------------------------
    // Test-only helpers — not compiled into release builds
    // -----------------------------------------------------------------------

    #[cfg(test)]
    pub fn set_mock_mode(enabled: bool) {
        USE_MOCK_STORE.store(enabled, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub fn reset_mock_store() {
        if let Ok(mut lock) = MOCK_STORE.lock() {
            lock.secrets.clear();
            lock.failure_mode = MockFailureMode::None;
            lock.fail_next_read = false;
        }
    }

    #[cfg(test)]
    pub fn set_mock_failure_mode(mode: MockFailureMode) {
        if let Ok(mut lock) = MOCK_STORE.lock() {
            lock.failure_mode = mode;
            lock.fail_next_read = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    lazy_static::lazy_static! {
        static ref TEST_SERIAL_MUTEX: StdMutex<()> = StdMutex::new(());
    }

    struct TestEnvGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
    }
    impl TestEnvGuard {
        fn new() -> Self {
            let lock = TEST_SERIAL_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
            CredentialManager::set_mock_mode(true);
            CredentialManager::reset_mock_store();
            CredentialManager::set_mock_failure_mode(MockFailureMode::None);
            Self { _lock: lock }
        }
    }
    impl Drop for TestEnvGuard {
        fn drop(&mut self) {
            CredentialManager::reset_mock_store();
            CredentialManager::set_mock_failure_mode(MockFailureMode::None);
            CredentialManager::set_mock_mode(false);
        }
    }

    #[tokio::test]
    async fn test_save_new_key_and_read_back_success() {
        let _guard = TestEnvGuard::new();
        let key = "test-api-key-12345";

        assert_eq!(
            CredentialManager::is_gemini_configured().await.unwrap(),
            false
        );
        CredentialManager::set_gemini_api_key(key).await.unwrap();

        assert_eq!(
            CredentialManager::is_gemini_configured().await.unwrap(),
            true
        );
        let read_back = CredentialManager::get_gemini_api_key().await.unwrap();
        assert_eq!(read_back, Some(key.to_string()));
    }

    #[tokio::test]
    async fn test_update_existing_key_a_to_b() {
        let _guard = TestEnvGuard::new();
        CredentialManager::set_gemini_api_key("key-A")
            .await
            .unwrap();
        assert_eq!(
            CredentialManager::get_gemini_api_key().await.unwrap(),
            Some("key-A".to_string())
        );

        CredentialManager::set_gemini_api_key("key-B")
            .await
            .unwrap();
        assert_eq!(
            CredentialManager::get_gemini_api_key().await.unwrap(),
            Some("key-B".to_string())
        );
    }

    #[tokio::test]
    async fn test_read_back_mismatch_restores_previous_key() {
        let _guard = TestEnvGuard::new();
        CredentialManager::set_gemini_api_key("key-A")
            .await
            .unwrap();

        // Inject simulated mismatch on next write
        CredentialManager::set_mock_failure_mode(MockFailureMode::ReadBackMismatch);
        let res = CredentialManager::set_gemini_api_key("key-B").await;
        assert!(res.is_err());

        // Restore normal mode to read back
        CredentialManager::set_mock_failure_mode(MockFailureMode::None);
        let read_back = CredentialManager::get_gemini_api_key().await.unwrap();
        assert_eq!(
            read_back,
            Some("key-A".to_string()),
            "Store must be rolled back to key-A"
        );
    }

    #[tokio::test]
    async fn test_read_back_error_restores_previous_key() {
        let _guard = TestEnvGuard::new();
        CredentialManager::set_gemini_api_key("key-A")
            .await
            .unwrap();

        // Inject simulated read error on next write verification
        CredentialManager::set_mock_failure_mode(MockFailureMode::ReadBackError);
        let res = CredentialManager::set_gemini_api_key("key-B").await;
        assert!(res.is_err());

        // Restore normal mode to read back
        CredentialManager::set_mock_failure_mode(MockFailureMode::None);
        let read_back = CredentialManager::get_gemini_api_key().await.unwrap();
        assert_eq!(
            read_back,
            Some("key-A".to_string()),
            "Store must be rolled back to key-A"
        );
    }

    #[tokio::test]
    async fn test_initially_empty_verification_failure_deletes_failed_write() {
        let _guard = TestEnvGuard::new();
        assert_eq!(CredentialManager::get_gemini_api_key().await.unwrap(), None);

        // Inject mismatch when store was initially empty
        CredentialManager::set_mock_failure_mode(MockFailureMode::ReadBackMismatch);
        let res = CredentialManager::set_gemini_api_key("failed-key").await;
        assert!(res.is_err());

        CredentialManager::set_mock_failure_mode(MockFailureMode::None);
        let read_back = CredentialManager::get_gemini_api_key().await.unwrap();
        assert_eq!(
            read_back, None,
            "Store must remain empty when initial write fails"
        );
    }

    #[tokio::test]
    async fn test_concurrent_operations_are_strictly_serialized() {
        let _guard = TestEnvGuard::new();

        let tasks = (0..10).map(|i| {
            tokio::spawn(async move {
                if i % 2 == 0 {
                    CredentialManager::set_gemini_api_key(&format!("key-{}", i))
                        .await
                        .unwrap();
                } else {
                    let _ = CredentialManager::get_gemini_api_key().await;
                }
            })
        });

        for t in tasks {
            t.await.unwrap();
        }

        assert!(CredentialManager::is_gemini_configured().await.unwrap());
    }

    #[tokio::test]
    async fn test_distinguishes_no_entry_from_real_error() {
        let _guard = TestEnvGuard::new();
        // Empty store returns Ok(None) (not an Err)
        assert_eq!(CredentialManager::get_gemini_api_key().await.unwrap(), None);

        // Simulated error returns Err
        CredentialManager::set_mock_failure_mode(MockFailureMode::ReadError);
        assert!(CredentialManager::get_gemini_api_key().await.is_err());
        CredentialManager::set_mock_failure_mode(MockFailureMode::None);
    }

    #[tokio::test]
    async fn test_delete_nonexistent_key_is_idempotent() {
        let _guard = TestEnvGuard::new();
        // Delete when empty returns Ok(())
        assert!(CredentialManager::delete_gemini_api_key().await.is_ok());
        assert!(CredentialManager::delete_gemini_api_key().await.is_ok());
        assert_eq!(CredentialManager::get_gemini_api_key().await.unwrap(), None);
    }

    #[tokio::test]
    async fn test_error_strings_never_contain_secret_key() {
        let _guard = TestEnvGuard::new();
        let canary = "SUPER_SECRET_CANARY_VALUE_XYZ";

        CredentialManager::set_mock_failure_mode(MockFailureMode::ReadBackMismatch);
        let err = CredentialManager::set_gemini_api_key(canary)
            .await
            .unwrap_err();
        CredentialManager::set_mock_failure_mode(MockFailureMode::None);

        assert!(
            !err.contains(canary),
            "Error message must never contain the secret key"
        );
        assert!(
            !err.contains(&canary.len().to_string()),
            "Error message must not contain key length"
        );
    }

    #[tokio::test]
    async fn test_groq_save_and_read_back_success() {
        let _guard = TestEnvGuard::new();
        let key = "gsk_test_groq_key_12345";

        assert_eq!(
            CredentialManager::is_groq_configured().await.unwrap(),
            false
        );
        CredentialManager::set_groq_api_key(key).await.unwrap();

        assert_eq!(
            CredentialManager::is_groq_configured().await.unwrap(),
            true
        );
        let read_back = CredentialManager::get_groq_api_key().await.unwrap();
        assert_eq!(read_back, Some(key.to_string()));

        CredentialManager::delete_groq_api_key().await.unwrap();
        assert_eq!(
            CredentialManager::is_groq_configured().await.unwrap(),
            false
        );
    }

    #[test]
    fn test_tauri_command_signatures_do_not_return_key() {
        fn assert_returns_unit_result<F, Fut>(_: F)
        where
            F: Fn(String) -> Fut,
            Fut: std::future::Future<Output = Result<(), String>>,
        {
        }

        fn assert_returns_unit_result_0_args<F, Fut>(_: F)
        where
            F: Fn() -> Fut,
            Fut: std::future::Future<Output = Result<(), String>>,
        {
        }

        fn assert_returns_bool_result<F, Fut>(_: F)
        where
            F: Fn() -> Fut,
            Fut: std::future::Future<Output = Result<bool, String>>,
        {
        }

        assert_returns_unit_result(crate::api::api_save_gemini_api_key);
        assert_returns_unit_result(crate::api::api_migrate_gemini_api_key);
        assert_returns_unit_result_0_args(crate::api::api_delete_gemini_api_key);
        assert_returns_bool_result(crate::api::api_is_gemini_configured);

        assert_returns_unit_result(crate::api::api_save_groq_api_key);
        assert_returns_unit_result_0_args(crate::api::api_delete_groq_api_key);
        assert_returns_bool_result(crate::api::api_is_groq_configured);
    }
}
