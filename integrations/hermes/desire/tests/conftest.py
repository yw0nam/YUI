import importlib.util
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

KST = ZoneInfo("Asia/Seoul")


@pytest.fixture
def state_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("DESIRE_STATE_DIR", str(tmp_path))
    return tmp_path


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
    spec = importlib.util.spec_from_file_location("yui_desire_under_test", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module
