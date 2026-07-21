import importlib.util
import os
import sys
import tempfile
import json
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]


def load_main():
    os.environ.setdefault("ANON_MUSIC_DB", str(ROOT / "tests" / "compat.db"))
    sys.path.insert(0, str(ROOT))
    spec = importlib.util.spec_from_file_location("anon_main_qq_compat", ROOT / "main.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def lyric_payload(resp):
    return resp.decrypt() if hasattr(resp, "decrypt") else resp


def test_old_and_new_lyric_response_are_supported():
    new = SimpleNamespace(lyric="[00:01]new", trans="翻译")
    assert lyric_payload(new).lyric == "[00:01]new"

    class Old:
        def decrypt(self):
            return SimpleNamespace(lyric="[00:01]old", trans="旧翻译")

    assert lyric_payload(Old()).lyric == "[00:01]old"


def test_main_contains_dual_version_lyric_compatibility():
    source = (ROOT / "main.py").read_text(encoding="utf-8")
    assert 'hasattr(resp, "decrypt")' in source
    assert 'hasattr(resp_lrc, "decrypt")' in source
    assert "lyric_node is not None" in source


def test_qqmusic_069_credential_roundtrip_preserves_refresh_fields():
    from qqmusic_api import Credential
    cred = Credential.model_validate({
        "musicid": 123,
        "str_musicid": "123",
        "musickey": "key",
        "loginType": 2,
        "refresh_token": "refresh-token",
        "refresh_key": "refresh-key",
        "expired_at": 123456,
        "encryptUin": "encrypted",
    })
    dumped = cred.model_dump(by_alias=True, mode="json")
    assert dumped["loginType"] == 2
    assert dumped["encryptUin"] == "encrypted"
    assert dumped["refresh_token"] == "refresh-token"
    assert dumped["refresh_key"] == "refresh-key"
    restored = Credential.model_validate(json.loads(json.dumps(dumped)))
    assert restored.login_type == 2
    assert restored.refresh_token == "refresh-token"


def test_fresh_checkout_creates_runtime_data_parent():
    old_db = os.environ.get("ANON_MUSIC_DB")
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
            target = Path(temp) / "missing" / "nested" / "player.db"
            os.environ["ANON_MUSIC_DB"] = str(target)
            sys.modules.pop("player_ext", None)
            spec = importlib.util.spec_from_file_location("fresh_player_ext", ROOT / "player_ext.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.init_db()
            assert target.exists()
    finally:
        if old_db is None:
            os.environ.pop("ANON_MUSIC_DB", None)
        else:
            os.environ["ANON_MUSIC_DB"] = old_db


if __name__ == "__main__":
    failures = []
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print("PASS", name)
            except Exception as exc:
                failures.append((name, exc))
                print("FAIL", name, repr(exc))
    if failures:
        raise SystemExit(1)
    print("QQMusic compatibility tests passed")
