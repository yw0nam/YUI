//! Process facts the webview reads.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_started_at_is_stable_across_calls() {
        record_started_at();
        assert_eq!(app_started_at(), app_started_at());
        assert_ne!(app_started_at(), 0);
    }
}
