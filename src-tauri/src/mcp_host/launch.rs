//! Builds the command for one MCP server: placeholder expansion, no shell, process-tree wrappers.

use super::manifest::ServerSpec;
use process_wrap::tokio::CommandWrap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

/// Expands `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` only, and creates the data folder.
pub fn command(spec: &ServerSpec, root: &Path, data: &Path) -> std::io::Result<CommandWrap> {
    std::fs::create_dir_all(data)?;
    let (root_text, data_text) = (root.to_string_lossy(), data.to_string_lossy());
    let mut command = CommandWrap::with_new(expand(&spec.command, &root_text, &data_text), |c| {
        c.args(spec.args.iter().map(|a| expand(a, &root_text, &data_text)))
            .envs(
                spec.env
                    .iter()
                    .map(|(k, v)| (k, expand(v, &root_text, &data_text))),
            )
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
    });
    #[cfg(unix)]
    command.wrap(process_wrap::tokio::ProcessGroup::leader());
    #[cfg(windows)]
    command
        .wrap(process_wrap::tokio::JobObject)
        .wrap(process_wrap::tokio::KillOnDrop)
        .wrap(process_wrap::tokio::CreationFlags(
            windows_process::Win32::System::Threading::CREATE_NO_WINDOW,
        ));
    Ok(command)
}

/// The launch command and its arguments after placeholder expansion, joined by spaces.
pub fn display(spec: &ServerSpec, root: &Path, data: &Path) -> String {
    let (root_text, data_text) = (root.to_string_lossy(), data.to_string_lossy());
    let mut parts = vec![quote(&expand(&spec.command, &root_text, &data_text))];
    parts.extend(
        spec.args
            .iter()
            .map(|a| quote(&expand(a, &root_text, &data_text))),
    );
    parts.join(" ")
}

/// The folder a plugin's data lives in: `<plugins dir>/data/<plugin id>`.
pub fn data_dir(plugins_dir: &Path, plugin_id: &str) -> PathBuf {
    plugins_dir.join("data").join(plugin_id)
}

/// The part as a command line shows it: bare when it reads as one part, quoted otherwise.
fn quote(part: &str) -> String {
    if !part.is_empty() && !part.contains(char::is_whitespace) && !part.contains('"') {
        return part.to_string();
    }
    let mut quoted = String::with_capacity(part.len() + 2);
    quoted.push('"');
    for c in part.chars() {
        match c {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            _ => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

/// Expands `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` in `s`.
fn expand(s: &str, root: &str, data: &str) -> String {
    s.replace("${CLAUDE_PLUGIN_ROOT}", root)
        .replace("${CLAUDE_PLUGIN_DATA}", data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_launch_command_shows_an_argument_with_spaces_in_quotes() {
        let spec = ServerSpec {
            name: "main".to_string(),
            command: "cmd".to_string(),
            args: vec![
                "a b".to_string(),
                "c".to_string(),
                String::new(),
                "say \"hi\"".to_string(),
            ],
            env: HashMap::new(),
        };
        assert_eq!(
            display(&spec, Path::new("/root"), Path::new("/data")),
            r##"cmd "a b" c "" "say \"hi\"""##
        );
    }
}
