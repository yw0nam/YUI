#[cfg(test)]
mod tests {
    use super::*;

    fn seq(name: &str) -> Vec<(Phase, String, Option<String>, i64)> {
        chord(name, false)
            .unwrap()
            .into_iter()
            .map(|e| (e.phase, e.key, e.text, e.modifiers))
            .collect()
    }

    fn ev(
        phase: Phase,
        key: &str,
        text: Option<&str>,
        modifiers: i64,
    ) -> (Phase, String, Option<String>, i64) {
        (phase, key.to_string(), text.map(str::to_string), modifiers)
    }

    #[test]
    fn enter_sends_a_carriage_return_keydown_then_keyup() {
        assert_eq!(
            seq("Enter"),
            vec![
                ev(Phase::Down, "Enter", Some("\r"), 0),
                ev(Phase::Up, "Enter", None, 0),
            ]
        );
    }

    #[test]
    fn control_a_holds_control_and_drops_the_text() {
        assert_eq!(
            seq("Control+A"),
            vec![
                ev(Phase::Down, "Control", None, 2),
                ev(Phase::Down, "A", None, 2),
                ev(Phase::Up, "A", None, 2),
                ev(Phase::Up, "Control", None, 0),
            ]
        );
    }

    #[test]
    fn shift_tab_holds_shift_around_tab() {
        assert_eq!(
            seq("Shift+Tab"),
            vec![
                ev(Phase::Down, "Shift", None, 8),
                ev(Phase::Down, "Tab", None, 8),
                ev(Phase::Up, "Tab", None, 8),
                ev(Phase::Up, "Shift", None, 0),
            ]
        );
    }

    #[test]
    fn an_unknown_key_name_has_no_events() {
        assert!(chord("Foo", false).is_none());
        assert!(chord("Control+Foo", false).is_none());
        assert!(chord("", false).is_none());
    }
}
