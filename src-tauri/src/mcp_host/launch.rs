//! Builds the command for one MCP server: placeholder expansion, no shell, process-tree wrappers.

use super::manifest::ServerSpec;
use process_wrap::tokio::CommandWrap;
use std::path::Path;
use std::process::Stdio;

/// Expands `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` only, and creates the data folder.
pub fn command(spec: &ServerSpec, root: &Path, data: &Path) -> std::io::Result<CommandWrap> {
    std::fs::create_dir_all(data)?;
    let (root_text, data_text) = (root.to_string_lossy(), data.to_string_lossy());
    let expand = |s: &str| {
        s.replace("${CLAUDE_PLUGIN_ROOT}", &root_text)
            .replace("${CLAUDE_PLUGIN_DATA}", &data_text)
    };
    let mut command = CommandWrap::with_new(expand(&spec.command), |c| {
        c.args(spec.args.iter().map(|a| expand(a)))
            .envs(spec.env.iter().map(|(k, v)| (k, expand(v))))
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
