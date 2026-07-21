import asyncio
import importlib.util
import json
import os
import sqlite3
import socket
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_player_ext(db_path: Path):
    os.environ["ANON_MUSIC_DB"] = str(db_path)
    os.environ["ANON_MUSIC_DEFAULT_NCM_BASE"] = "http://127.0.0.1:3000"
    sys.path.insert(0, str(ROOT))
    name = f"player_ext_custom_source_{db_path.stem}"
    spec = importlib.util.spec_from_file_location(name, ROOT / "player_ext.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.DB_PATH = str(db_path)
    module.init_db()
    return module


def request_with_token(token: str = ""):
    cookie = f"np_session={token}".encode() if token else b""
    headers = [(b"cookie", cookie)] if cookie else []
    from starlette.requests import Request
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


def make_user(mod):
    salt, pw_hash = mod.hash_pw("password123")
    with mod._conn() as c:
        c.execute(
            "INSERT INTO users(email,pwd_salt,pwd_hash,created_at) VALUES (?,?,?,?)",
            ("source@example.com", salt, pw_hash, 1),
        )
        uid = c.execute("SELECT id FROM users WHERE email=?", ("source@example.com",)).fetchone()[0]
    token = mod._new_session(uid)
    return uid, token


def test_guest_cannot_read_or_change_custom_source():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        mod = load_player_ext(Path(temp) / "guest.db")
        for fn, args in [
            (mod.get_custom_source, (request_with_token(),)),
            (mod.put_custom_source, (request_with_token(), {"enabled": True, "base_url": "https://ncm.example.com"})),
            (mod.delete_custom_source, (request_with_token(),)),
        ]:
            try:
                fn(*args)
            except Exception as exc:
                assert getattr(exc, "status_code", None) == 401
            else:
                raise AssertionError("guest request must be rejected")


def test_logged_in_user_can_save_and_restore_personal_source():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        mod = load_player_ext(Path(temp) / "user.db")
        uid, token = make_user(mod)
        req = request_with_token(token)
        original_dns = socket.getaddrinfo
        socket.getaddrinfo = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))]
        try:
            saved = mod.put_custom_source(req, {"enabled": True, "base_url": "https://api.github.com/api/"})
        finally:
            socket.getaddrinfo = original_dns
        assert saved["data"] == {"enabled": True, "configured": True, "base_url": "https://api.github.com/api"}
        assert mod.get_ncm_base(req) == "https://api.github.com/api"
        deleted = mod.delete_custom_source(req)
        assert deleted["data"] == {"enabled": False, "configured": False, "base_url": ""}
        assert mod.get_ncm_base(req) == mod.DEFAULT_NCM_BASE
        with mod._conn() as c:
            assert c.execute("SELECT COUNT(*) FROM user_sources WHERE user_id=?", (uid,)).fetchone()[0] == 0


def test_default_source_address_is_never_returned_to_users():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        mod = load_player_ext(Path(temp) / "hidden.db")
        _, token = make_user(mod)
        data = mod.get_custom_source(request_with_token(token))["data"]
        assert data == {"enabled": False, "configured": False, "base_url": ""}
        assert mod.DEFAULT_NCM_BASE not in json.dumps(data)


def test_custom_source_rejects_loopback_private_and_non_http_urls():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        mod = load_player_ext(Path(temp) / "validate.db")
        _, token = make_user(mod)
        req = request_with_token(token)
        for url in [
            "file:///etc/passwd",
            "http://127.0.0.1:3000",
            "http://localhost:3003",
            "http://169.254.169.254/latest/meta-data",
            "http://192.168.1.10:3003",
        ]:
            try:
                mod.put_custom_source(req, {"enabled": True, "base_url": url})
            except Exception as exc:
                assert getattr(exc, "status_code", None) == 400, url
            else:
                raise AssertionError(f"unsafe URL accepted: {url}")


def test_ncm_get_uses_request_users_source(monkeypatch=None):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        mod = load_player_ext(Path(temp) / "request.db")
        _, token = make_user(mod)
        req = request_with_token(token)
        original_dns = socket.getaddrinfo
        # 保存与请求阶段都要模拟公网解析：运行时会重新做 DNS 校验。
        socket.getaddrinfo = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))]
        called = {}

        class FakeResponse:
            status_code = 200
            def json(self):
                return {"code": 200}

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                return False
            async def get(self, url, params=None):
                called["url"] = url
                called["params"] = params
                return FakeResponse()

        original = mod.httpx.AsyncClient
        mod.httpx.AsyncClient = FakeClient
        try:
            mod.put_custom_source(req, {"enabled": True, "base_url": "https://api.github.com/api"})
            result = asyncio.run(mod.ncm_get(req, "/cloudsearch", {"keywords": "test"}))
        finally:
            mod.httpx.AsyncClient = original
            socket.getaddrinfo = original_dns
        assert result["code"] == 200
        assert called["url"] == "https://api.github.com/api/cloudsearch"


def test_custom_source_is_revalidated_before_each_request():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        mod = load_player_ext(Path(temp) / "rebind.db")
        _, token = make_user(mod)
        req = request_with_token(token)
        original_dns = socket.getaddrinfo
        socket.getaddrinfo = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))]
        try:
            mod.put_custom_source(req, {"enabled": True, "base_url": "https://api.github.com/api"})
        finally:
            socket.getaddrinfo = original_dns
        socket.getaddrinfo = lambda *args, **kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        try:
            try:
                asyncio.run(mod.ncm_get(req, "/cloudsearch", {"keywords": "test"}))
            except Exception as exc:
                assert getattr(exc, "status_code", None) == 502
            else:
                raise AssertionError("DNS rebinding destination was not rejected")
        finally:
            socket.getaddrinfo = original_dns


def test_favorite_playlist_cover_rejects_attribute_injection():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as temp:
        mod = load_player_ext(Path(temp) / "xss.db")
        body = {"source": "qq", "id": "1", "name": "x", "cover": 'x\" onerror=\"window.pwned=1'}
        mod.fav_pl_add(request_with_token(), body)
        data = mod.fav_pl_list(request_with_token())["data"]
        assert data[0]["cover"] == ""
        frontend = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
        assert "const attr =" in frontend
        assert 'src="${attr(httpsify(cover))}"' in frontend


def test_playlist_resolver_disables_automatic_redirects():
    source = (ROOT / "player_ext.py").read_text(encoding="utf-8")
    assert "follow_redirects=False" in source
    assert "if not _resolve_host_allowed(current)" in source


def test_frontend_only_shows_custom_source_for_logged_in_users():
    source = (ROOT / "static" / "appext.js").read_text(encoding="utf-8")
    assert "自定义音源" in source
    assert "/api/settings/source" in source
    assert "${me ? '<button data-t=\"source\">自定义音源</button>' : ''}" in source
    assert "恢复默认音源" in source
    assert "默认音源地址不会展示" in source


if __name__ == "__main__":
    failures = []
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for test in tests:
        try:
            test()
            print("PASS", test.__name__)
        except Exception as exc:
            failures.append((test.__name__, exc))
            print("FAIL", test.__name__, repr(exc))
    if failures:
        raise SystemExit(1)
    print("All custom source tests passed")
