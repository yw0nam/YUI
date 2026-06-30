//! GitHub GraphQL transport — shells `gh api graphql` and returns stdout.
//!
//! # Responsibilities
//! - `github_poll` command: async; runs `gh api graphql -f query=<q>` off the
//!   main thread via `spawn_blocking`, returns raw JSON stdout on success, stderr
//!   on non-zero exit so the TS seam can log-and-skip.
//! - `gh_args`: pure arg-list builder (unit-tested).
//! - `map_output`: pure success/failure mapper (unit-tested).

use tauri::command;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/// Build the arg list for `std::process::Command::new("gh")`.
pub fn gh_args(query: &str) -> Vec<String> {
    vec![
        "api".to_string(),
        "graphql".to_string(),
        "-f".to_string(),
        format!("query={}", query),
    ]
}

/// Map raw process output to `Result<stdout, stderr>`.
pub fn map_output(status_success: bool, stdout: String, stderr: String) -> Result<String, String> {
    if status_success {
        Ok(stdout)
    } else {
        Err(stderr)
    }
}

// ─── Tauri command ────────────────────────────────────────────────────────────

/// Run `gh api graphql -f query=<query>` and return raw JSON stdout.
///
/// Non-zero exit → `Err(stderr)` so the TS poller can log and skip.
/// Runs blocking process spawn off the async runtime thread.
#[command]
pub async fn github_poll(query: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("gh")
            .args(gh_args(&query))
            .output()
            .map_err(|e| {
                log::error!("github_poll_spawn_failed error={e}");
                e.to_string()
            })?;
        map_output(
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    })
    .await
    .map_err(|e| {
        log::error!("github_poll_join_failed error={e}");
        e.to_string()
    })?
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── gh_args ───────────────────────────────────────────────────────────────

    #[test]
    fn gh_args_starts_with_api_graphql() {
        let args = gh_args("{ viewer { login } }");
        assert_eq!(args[0], "api");
        assert_eq!(args[1], "graphql");
    }

    #[test]
    fn gh_args_has_f_flag_before_query() {
        let args = gh_args("{ viewer { login } }");
        assert_eq!(args[2], "-f");
    }

    #[test]
    fn gh_args_embeds_query_in_fourth_arg() {
        let q = "{ viewer { login } }";
        let args = gh_args(q);
        assert_eq!(args[3], format!("query={}", q));
    }

    #[test]
    fn gh_args_length_is_four() {
        let args = gh_args("anything");
        assert_eq!(args.len(), 4);
    }

    // ── map_output ────────────────────────────────────────────────────────────

    #[test]
    fn map_output_success_returns_stdout() {
        let result = map_output(true, "{\"data\":{}}".to_string(), String::new());
        assert_eq!(result, Ok("{\"data\":{}}".to_string()));
    }

    #[test]
    fn map_output_failure_returns_stderr() {
        let result = map_output(false, String::new(), "gh: not logged in".to_string());
        assert_eq!(result, Err("gh: not logged in".to_string()));
    }

    #[test]
    fn map_output_failure_ignores_stdout() {
        let result = map_output(false, "some stdout".to_string(), "err msg".to_string());
        assert_eq!(result, Err("err msg".to_string()));
    }
}
