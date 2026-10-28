//! Shared helpers for the MCP host tests: the fixture plugin, temp folders, polling, a local
//! catalog server.

use super::catalog;
use super::host::Host;
use super::snapshot::Snapshot;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use time::UtcOffset;

pub fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/mcp-test-plugin")
}

pub fn require_python() {
    let found = std::process::Command::new("python3")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success());
    assert!(found, "python3 is required on PATH for the MCP host tests");
}

/// A new empty folder named `yui-mcp-host-<pid>-<nanos>-<counter>`.
pub fn temp_dir() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let dir = std::env::temp_dir().join(format!(
        "yui-mcp-host-{}-{nanos}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir(&dir).unwrap();
    dir
}

/// Polls `check` every 50 ms for up to 5 s.
pub async fn eventually(check: impl Fn() -> bool) -> bool {
    for _ in 0..100 {
        if check() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    check()
}

/// True once no process has `pid`; a zombie counts as alive until its parent reaps it.
pub fn gone(pid: i32) -> bool {
    nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None) == Err(nix::errno::Errno::ESRCH)
}

/// A copy of the fixture plugin in a new temp folder, with plugin name `id`.
pub fn fixture_copy(id: &str) -> PathBuf {
    let dir = temp_dir().join(id);
    copy_dir(&fixture(), &dir);
    let manifest = dir.join(".claude-plugin/plugin.json");
    let text = std::fs::read_to_string(&manifest)
        .unwrap()
        .replace("\"yui-test\"", &format!("\"{id}\""));
    std::fs::write(manifest, text).unwrap();
    dir
}

fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

pub type Emitted = Arc<Mutex<Vec<Snapshot>>>;

pub fn host_at(app_data: &Path) -> (Arc<Host>, Emitted) {
    host_with(app_data, no_catalog())
}

pub fn host_with(app_data: &Path, catalog: catalog::Config) -> (Arc<Host>, Emitted) {
    let emitted = Emitted::default();
    let sink = emitted.clone();
    let host = Host::new(
        Ok(app_data.to_path_buf()),
        &app_data.join("logs"),
        UtcOffset::UTC,
        catalog,
        move |s| sink.lock().unwrap().push(s.clone()),
    );
    (host, emitted)
}

/// A catalog config whose URLs point nowhere.
pub fn no_catalog() -> catalog::Config {
    catalog::Config {
        catalog_url: String::new(),
        github: String::new(),
        raw: String::new(),
        platform: Some("test-platform"),
    }
}

/// A local HTTP server: answers a path in `files` with its bytes, any other with 404, and
/// records every requested path.
pub struct TestServer {
    pub url: String,
    pub files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub requests: Arc<Mutex<Vec<String>>>,
}

impl TestServer {
    pub fn start() -> Self {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://{}", server.server_addr().to_ip().unwrap());
        let files = Arc::new(Mutex::new(HashMap::<String, Vec<u8>>::new()));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let (served, recorded) = (files.clone(), requests.clone());
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                let path = request.url().to_string();
                recorded.lock().unwrap().push(path.clone());
                let body = served.lock().unwrap().get(&path).cloned();
                let _ = match body {
                    Some(body) => request.respond(tiny_http::Response::from_data(body)),
                    None => request.respond(tiny_http::Response::empty(404)),
                };
            }
        });
        Self {
            url,
            files,
            requests,
        }
    }

    pub fn put(&self, path: &str, body: impl Into<Vec<u8>>) {
        self.files
            .lock()
            .unwrap()
            .insert(path.to_string(), body.into());
    }

    /// Every catalog URL points here, for the platform `test-platform`.
    pub fn config(&self) -> catalog::Config {
        catalog::Config {
            catalog_url: format!("{}/catalog.json", self.url),
            github: self.url.clone(),
            raw: self.url.clone(),
            platform: Some("test-platform"),
        }
    }
}

/// The fixture plugin zipped as `id` `version`, its server in `FIXTURE_MODE` `mode` when given.
pub fn plugin_zip(id: &str, version: &str, mode: Option<&str>) -> Vec<u8> {
    let folder = fixture_copy(id);
    let manifest = folder.join(".claude-plugin/plugin.json");
    let mut plugin: Value =
        serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    plugin["version"] = json!(version);
    std::fs::write(manifest, plugin.to_string()).unwrap();
    if let Some(mode) = mode {
        set_mode(&folder, mode);
    }
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zip_dir(&mut zip, &folder, &folder);
    zip.finish().unwrap().into_inner()
}

fn zip_dir(zip: &mut zip::ZipWriter<std::io::Cursor<Vec<u8>>>, root: &Path, dir: &Path) {
    let options = zip::write::SimpleFileOptions::default().unix_permissions(0o644);
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            zip_dir(zip, root, &path);
            continue;
        }
        let name = path.strip_prefix(root).unwrap().to_string_lossy();
        zip.start_file(name, options).unwrap();
        zip.write_all(&std::fs::read(&path).unwrap()).unwrap();
    }
}

pub async fn running(id: &str) -> Arc<Host> {
    let (host, _) = host_at(&temp_dir());
    host.add(fixture_copy(id)).unwrap();
    host.enable(id).await.unwrap();
    host
}

pub fn slow_call(
    host: &Arc<Host>,
    window: &'static str,
    call_id: &'static str,
) -> tokio::task::JoinHandle<Result<Value, String>> {
    let host = host.clone();
    tokio::spawn(async move {
        host.call(window, call_id, "slow", json!({}), "preset-1")
            .await
    })
}

/// The fixture server logged a `notifications/cancelled` it received.
pub fn server_logged_a_cancel(host: &Host) -> bool {
    host.log_tail("yui-test")
        .unwrap()
        .iter()
        .any(|l| l.starts_with("[main] cancelled id="))
}

/// Sets `FIXTURE_MODE` for the fixture copy's server.
pub fn set_mode(folder: &Path, mode: &str) {
    let path = folder.join(".mcp.json");
    let mut config: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    config["mcpServers"]["main"]["env"]["FIXTURE_MODE"] = json!(mode);
    std::fs::write(path, config.to_string()).unwrap();
}

/// The pid of the `sleep` a `hang` fixture server logged, once it has.
pub fn hung_child(host: &Host, plugin_id: &str) -> Option<i32> {
    host.log_tail(plugin_id)
        .unwrap()
        .iter()
        .find_map(|l| l.strip_prefix("[main] child pid=")?.parse().ok())
}
