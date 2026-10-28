//! The MCP host: runs local plugins' MCP servers.

mod host;
mod launch;
mod manifest;
mod server;
mod snapshot;
mod store;
#[cfg(test)]
mod test_support;
