//! The MCP host: runs local plugins' MCP servers.

mod calls;
mod host;
mod launch;
mod manifest;
mod server;
mod snapshot;
mod store;
#[cfg(test)]
mod test_support;
