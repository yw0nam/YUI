import importlib.util
import json
import socket
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

KST = ZoneInfo("Asia/Seoul")


@pytest.fixture
def state_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("DESIRE_STATE_DIR", str(tmp_path))
    return tmp_path


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture(autouse=True)
def closed_signals_url(monkeypatch: pytest.MonkeyPatch) -> str:
    url = f"http://127.0.0.1:{free_port()}/signals"
    monkeypatch.setenv("YUI_SIGNALS_URL", url)
    return url


@pytest.fixture
def listening_signals_url(monkeypatch: pytest.MonkeyPatch):
    class NotFoundHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(404)
            self.end_headers()

        def log_message(self, format, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), NotFoundHandler)
    worker = threading.Thread(target=server.serve_forever)
    worker.start()
    url = f"http://127.0.0.1:{server.server_port}/signals"
    monkeypatch.setenv("YUI_SIGNALS_URL", url)
    yield url
    server.shutdown()
    server.server_close()
    worker.join()


@pytest.fixture
def at():
    def make(value: str) -> datetime:
        return datetime.fromisoformat(value).astimezone(KST)

    return make


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")


def write_jsonl(path: Path, values: list[object]) -> None:
    text = "".join(json.dumps(value) + "\n" for value in values)
    path.write_text(text, encoding="utf-8")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


@pytest.fixture
def state_helpers():
    return write_json, write_jsonl, read_json, read_jsonl


@pytest.fixture
def desire_plugin():
    path = Path(__file__).parents[1] / "__init__.py"
    plugin_dir = path.parent
    module_name = "yui_desire_under_test"
    spec = importlib.util.spec_from_file_location(
        module_name,
        path,
        submodule_search_locations=[str(plugin_dir)],
    )
    module = importlib.util.module_from_spec(spec)
    module.__package__ = module_name
    module.__path__ = [str(plugin_dir)]
    sys.modules[module_name] = module
    assert spec.loader is not None
    direct_module = sys.modules.pop("desire_state", None)
    original_path = sys.path[:]
    sys.path[:] = [entry for entry in sys.path if Path(entry).resolve() != plugin_dir.resolve()]
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path[:] = original_path
        if direct_module is not None:
            sys.modules["desire_state"] = direct_module
    return module
