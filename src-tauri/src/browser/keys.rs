//! Playwright key names (`Enter`, `Control+A`, `Shift+Tab`) mapped onto CDP key events.

use chromiumoxide::cdp::browser_protocol::input::{DispatchKeyEventParams, DispatchKeyEventType};
use chromiumoxide::keys::{KeyDefinition, USKEYBOARD_LAYOUT};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Down,
    Up,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KeyEvent {
    pub phase: Phase,
    pub key: String,
    pub code: String,
    pub key_code: i64,
    pub text: Option<String>,
    pub modifiers: i64,
}

impl KeyEvent {
    pub fn params(&self) -> DispatchKeyEventParams {
        let kind = match (self.phase, &self.text) {
            (Phase::Up, _) => DispatchKeyEventType::KeyUp,
            (Phase::Down, Some(_)) => DispatchKeyEventType::KeyDown,
            (Phase::Down, None) => DispatchKeyEventType::RawKeyDown,
        };
        let mut params = DispatchKeyEventParams::new(kind);
        params.modifiers = Some(self.modifiers);
        params.key = Some(self.key.clone());
        params.code = Some(self.code.clone());
        params.windows_virtual_key_code = Some(self.key_code);
        params.text = self.text.clone();
        params.unmodified_text = self.text.clone();
        params
    }

    /// The key-up that releases this key-down with no modifiers held.
    pub fn release(&self) -> KeyEvent {
        KeyEvent {
            phase: Phase::Up,
            text: None,
            modifiers: 0,
            ..self.clone()
        }
    }
}

const SHIFT: i64 = 8;

fn modifier_bit(key: &str) -> i64 {
    match key {
        "Alt" => 1,
        "Control" => 2,
        "Meta" => 4,
        "Shift" => SHIFT,
        _ => 0,
    }
}

struct Key {
    key: String,
    code: String,
    key_code: i64,
    text: Option<String>,
}

fn from_definition(d: &KeyDefinition) -> Key {
    let single = d.key.chars().count() == 1;
    Key {
        key: d.key.to_string(),
        code: d.code.to_string(),
        key_code: d.key_code,
        text: d.text.or(single.then_some(d.key)).map(str::to_string),
    }
}

/// A Playwright key name: a `code` (`KeyA`), a `key` (`a`, `Enter`) or any single character.
fn lookup(name: &str) -> Option<Key> {
    let by_code = USKEYBOARD_LAYOUT.iter().find(|d| d.code == name);
    let by_key = || {
        USKEYBOARD_LAYOUT
            .iter()
            .filter(|d| d.key == name)
            .min_by_key(|d| d.code.starts_with("Numpad"))
    };
    if let Some(d) = by_code.or_else(by_key) {
        return Some(from_definition(d));
    }
    let mut chars = name.chars();
    match (chars.next(), chars.next()) {
        (Some(_), None) => Some(Key {
            key: name.to_string(),
            code: String::new(),
            key_code: 0,
            text: Some(name.to_string()),
        }),
        _ => None,
    }
}

/// Splits on `+` the way Playwright does, so `Control++` names the `+` key.
fn split(name: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut building = String::new();
    for c in name.chars() {
        if c == '+' && !building.is_empty() {
            parts.push(std::mem::take(&mut building));
        } else {
            building.push(c);
        }
    }
    parts.push(building);
    parts
}

/// The key-down and key-up sequence Playwright's `keyboard.press(name)` sends, or `None` for an unknown name.
pub fn chord(name: &str, mac: bool) -> Option<Vec<KeyEvent>> {
    let keys = split(name)
        .iter()
        .map(|part| match part.as_str() {
            "ControlOrMeta" if mac => lookup("Meta"),
            "ControlOrMeta" => lookup("Control"),
            part => lookup(part),
        })
        .collect::<Option<Vec<_>>>()?;
    let mut modifiers = 0;
    let mut events = Vec::new();
    for k in &keys {
        modifiers |= modifier_bit(&k.key);
        let text = if modifiers & !SHIFT != 0 {
            None
        } else {
            k.text.clone()
        };
        events.push(KeyEvent {
            phase: Phase::Down,
            key: k.key.clone(),
            code: k.code.clone(),
            key_code: k.key_code,
            text,
            modifiers,
        });
    }
    for k in keys.iter().rev() {
        modifiers &= !modifier_bit(&k.key);
        events.push(KeyEvent {
            phase: Phase::Up,
            key: k.key.clone(),
            code: k.code.clone(),
            key_code: k.key_code,
            text: None,
            modifiers,
        });
    }
    Some(events)
}

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
    fn a_cut_chord_releases_every_key_whose_down_was_sent() {
        let events = chord("Control+A", false).unwrap();
        let keys = |completed| {
            let ups = releases(&events, completed);
            assert!(ups.iter().all(|e| e.phase == Phase::Up && e.modifiers == 0));
            ups.into_iter().map(|e| e.key).collect::<Vec<_>>()
        };
        assert_eq!(keys(0), ["Control"]);
        assert_eq!(keys(1), ["A", "Control"]);
        assert_eq!(keys(2), ["A", "Control"]);
        assert_eq!(keys(3), ["Control"]);
    }

    #[test]
    fn an_unknown_key_name_has_no_events() {
        assert!(chord("Foo", false).is_none());
        assert!(chord("Control+Foo", false).is_none());
        assert!(chord("", false).is_none());
    }
}
