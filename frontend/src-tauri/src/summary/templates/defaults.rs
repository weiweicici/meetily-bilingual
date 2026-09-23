/// Embedded default templates using compile-time inclusion
///
/// These templates are bundled into the binary and serve as fallbacks
/// when custom templates are not available.

/// Daily standup template for engineering/product teams
pub const DAILY_STANDUP: &str = include_str!("../../../templates/daily_standup.json");

/// Standard meeting notes template
pub const STANDARD_MEETING: &str = include_str!("../../../templates/standard_meeting.json");

/// NAIT classroom action-oriented summary template
pub const NAIT_CLASSROOM: &str = include_str!("../../../templates/nait_classroom.json");

/// Registry of all built-in templates
///
/// Maps template identifiers to their embedded JSON content
pub fn get_builtin_templates() -> Vec<(&'static str, &'static str)> {
    vec![
        ("daily_standup", DAILY_STANDUP),
        ("standard_meeting", STANDARD_MEETING),
        ("nait_classroom", NAIT_CLASSROOM),
    ]
}

/// Get a built-in template by identifier
///
/// # Arguments
/// * `id` - Template identifier (e.g., "daily_standup", "standard_meeting")
///
/// # Returns
/// The template JSON content if found, None otherwise
pub fn get_builtin_template(id: &str) -> Option<&'static str> {
    match id {
        "daily_standup" => Some(DAILY_STANDUP),
        "standard_meeting" => Some(STANDARD_MEETING),
        "nait_classroom" => Some(NAIT_CLASSROOM),
        _ => None,
    }
}

/// List all built-in template identifiers
pub fn list_builtin_template_ids() -> Vec<&'static str> {
    vec!["daily_standup", "nait_classroom", "standard_meeting"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_templates_valid_json() {
        for (id, content) in get_builtin_templates() {
            let result = serde_json::from_str::<serde_json::Value>(content);
            assert!(
                result.is_ok(),
                "Built-in template '{}' contains invalid JSON: {:?}",
                id,
                result.err()
            );
        }
    }

    #[test]
    fn test_get_builtin_template() {
        assert!(get_builtin_template("daily_standup").is_some());
        assert!(get_builtin_template("standard_meeting").is_some());
        assert!(get_builtin_template("nait_classroom").is_some());
        assert!(get_builtin_template("nonexistent").is_none());
    }

    #[test]
    fn nait_classroom_template_has_nine_sections() {
        let json = get_builtin_template("nait_classroom").expect("nait_classroom must exist");
        let value: serde_json::Value = serde_json::from_str(json).expect("nait_classroom is valid JSON");
        let sections = value["sections"].as_array().expect("sections must be an array");
        assert_eq!(
            sections.len(),
            9,
            "NAIT classroom template must have exactly 9 sections, got {}",
            sections.len()
        );
    }

    #[test]
    fn nait_classroom_template_listed_in_ids() {
        let ids = list_builtin_template_ids();
        assert!(
            ids.contains(&"nait_classroom"),
            "nait_classroom must appear in list_builtin_template_ids"
        );
    }
}
