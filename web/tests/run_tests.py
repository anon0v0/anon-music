import ast
import importlib.util
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
failures = []


def check(name, fn):
    try:
        fn()
        print(f"PASS {name}")
    except Exception as exc:
        failures.append((name, exc))
        print(f"FAIL {name}: {exc}")


def load_player_ext(db_path):
    os.environ["ANON_MUSIC_DB"] = str(db_path)
    os.environ["ANON_MUSIC_DEVICE"] = str(ROOT / "tests" / "qq_device.json")
    sys.path.insert(0, str(ROOT))
    spec = importlib.util.spec_from_file_location("player_ext_under_test", ROOT / "player_ext.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def proxy_validation():
    db = Path(tempfile.mkdtemp()) / "test.db"
    mod = load_player_ext(db)
    assert mod.validate_proxy_url("http://127.0.0.1:8080/secret") is False
    assert mod.validate_proxy_url("http://169.254.169.254/latest/meta-data") is False
    assert mod.validate_proxy_url("ftp://example.com/file") is False
    assert mod.validate_proxy_url("https://example.com/file.mp3", mod.AUDIO_PROXY_HOSTS) is False


def database_migration():
    d = Path(tempfile.mkdtemp())
    db = d / "legacy.db"
    c = sqlite3.connect(db)
    c.executescript("""
    CREATE TABLE liked(mid TEXT PRIMARY KEY, song_json TEXT NOT NULL, added_at REAL NOT NULL, user_id INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE recent(mid TEXT PRIMARY KEY, song_json TEXT NOT NULL, played_at REAL NOT NULL, user_id INTEGER NOT NULL DEFAULT 0);
    INSERT INTO liked VALUES ('qq:1', '{}', 1, 0);
    INSERT INTO recent VALUES ('qq:1', '{}', 1, 0);
    """)
    c.close()
    mod = load_player_ext(db)
    mod.DB_PATH = str(db)
    mod.init_db()
    c = sqlite3.connect(db)
    assert [r[1] for r in c.execute("PRAGMA table_info(liked)") if r[5]] == ["user_id", "mid"]
    assert [r[1] for r in c.execute("PRAGMA table_info(recent)") if r[5]] == ["user_id", "mid"]
    c.execute("INSERT INTO liked(user_id,mid,song_json,added_at) VALUES (1,'qq:1','{}',2)")
    assert c.execute("SELECT COUNT(*) FROM liked WHERE mid='qq:1'").fetchone()[0] == 2
    assert c.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    c.close()


def main_security():
    source = (ROOT / "main.py").read_text(encoding="utf-8")
    config = (ROOT / "player_config.py").read_text(encoding="utf-8")
    assert 'allow_origins=["*"]' not in source
    assert 'crc2548' not in source + config
    for token in ["docs_url=None", "redoc_url=None", "openapi_url=None", '"/healthz"', '@app.get("/readyz",']:
        assert token in source, token
    ast.parse(source)


def frontend_accessibility():
    js = (ROOT / "static" / "appext.js").read_text(encoding="utf-8")
    for token in ['role="dialog"', 'aria-modal="true"', "if (e.key === 'Escape')", "focusable", "<form"]:
        assert token in js, token


def asset_versioning():
    html = (ROOT / "static" / "app.html").read_text(encoding="utf-8")
    sw = (ROOT / "static" / "service-worker.js").read_text(encoding="utf-8")
    for asset in ("app.js", "appext.js", "player.js"):
        assert f"/static/{asset}?v=" in html
    # apibase.js 必须先于所有业务脚本加载，否则 apiFetch/apiUrl 未定义 → 整页 ReferenceError
    assert "/static/apibase.js" in html
    assert html.index("/static/apibase.js") < html.index("/static/app.js")
    # 导航请求只缓存播放器入口，不缓存任意页面
    assert "url.pathname === '/music'" in sw
    # stale-while-revalidate：命中缓存立即返回，同时后台拉新版写回
    assert "const cached = cacheable ? await cache.match(OFFLINE_URL) : null" in sw
    assert "event.waitUntil(fetching" in sw
    assert "res.ok" in sw
    assert "暂时无法连接" in sw
    assert "setInterval(()=>location.reload(),20000)" in sw


def playlist_management():
    db = Path(tempfile.mkdtemp()) / "playlist.db"
    mod = load_player_ext(db)
    mod.DB_PATH = str(db)
    mod.init_db()
    from starlette.requests import Request
    req = Request({"type": "http", "headers": [], "method": "POST", "path": "/"})
    created = mod.lib_playlist_create(req, {"name": "测试歌单"})
    pid = created["data"]["id"]
    for mid in ("qq:1", "qq:2", "qq:3"):
        mod.lib_playlist_add_song(req, pid, {"id": mid, "name": mid})
    mod.lib_playlist_reorder(req, pid, {"mids": ["qq:3", "qq:1", "qq:2"]})
    assert [s["id"] for s in mod.lib_playlist_detail(req, pid)["data"]["songs"]] == ["qq:3", "qq:1", "qq:2"]
    mod.lib_playlist_batch_delete(req, pid, {"mids": ["qq:1", "qq:3"]})
    assert [s["id"] for s in mod.lib_playlist_detail(req, pid)["data"]["songs"]] == ["qq:2"]


def together_limits():
    spec = importlib.util.spec_from_file_location("player_together_under_test", ROOT / "player_together.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    import asyncio
    made = asyncio.run(mod.together_create({"name": "房主"}))
    room = made["room"]
    host_token = made["member_token"]
    joined = asyncio.run(mod.together_join({"room": room, "name": "成员"}))
    target = joined["view"]["members"][-1]["member_id"]
    assert asyncio.run(mod.together_transfer({"member_token": "forged", "room": room, "target": target}))["code"] == -1
    assert asyncio.run(mod.together_transfer({"member_token": host_token, "room": room, "target": target}))["code"] == 0
    assert mod._rooms[room]["host"] == target
    public_view = joined["view"]
    assert "member_token" not in str(public_view)


def ux_features():
    app = (ROOT / "static" / "app.js").read_text(encoding="utf-8")
    css = (ROOT / "static" / "app.css").read_text(encoding="utf-8")
    player = (ROOT / "static" / "player.js").read_text(encoding="utf-8")
    together = (ROOT / "static" / "together.js").read_text(encoding="utf-8")
    appext = (ROOT / "static" / "appext.js").read_text(encoding="utf-8")
    backend = (ROOT / "player_together.py").read_text(encoding="utf-8")
    assert "AbortController" in app
    assert "search-more" in app
    assert "source-panels" in css
    assert "home-feature-grid" in app
    assert "home-rec-grid" in css
    assert "--music-card-size:" in css
    assert ".home-feature-grid" in css and "repeat(4" in css
    assert ".home-rec-grid" in css
    assert ".home-recommend-panels { grid-template-columns: repeat(2,minmax(0,1fr)); }" in css
    assert "slice(0, 12)" in app
    assert "positionQueuePanel" in app
    assert "positionQueuePanel" in (ROOT / "static" / "nowplaying.js").read_text(encoding="utf-8")
    assert "scale(1.015)" in (ROOT / "static" / "nowplaying.css").read_text(encoding="utf-8")
    assert "max-height: min(68dvh, 680px)" in (ROOT / "static" / "nowplaying.css").read_text(encoding="utf-8")
    assert "M7 8h10M7 12h7M7 16h4" in app + (ROOT / "static" / "app.html").read_text(encoding="utf-8")
    assert "repeat(auto-fill,minmax(var(--music-card-size),1fr))" in css
    assert "home-feature-card" in app
    assert "window.appNotice" in app
    for source in (app, player, together, appext):
        assert "alert(" not in source
        assert "confirm(" not in source
        assert "prompt(" not in source
    assert "MAX_MEMBERS" in backend
    assert "together_transfer" in backend
    assert "playlist-batchbar" in app
    assert "reorder" in app
    assert "state.pages[tab][src]" in app
    assert "cache[tab][src]" in app
    assert "routeQuery.get('room')" in app
    assert "member_token" in together and "member_token" in backend
    assert "aria-live" in app and "aria-labelledby" in app
    assert ".batch-mode .song-check" in css
    assert "recent-source-panels" in app
    assert "LIBRARY_PAGE_SIZE = 12" in app
    assert "libraryPager" in app
    assert "chart-compare-body" in app
    assert "chart-flat-grid" in css


for name, fn in [
    ("proxy_validation", proxy_validation),
    ("database_migration", database_migration),
    ("main_security", main_security),
    ("frontend_accessibility", frontend_accessibility),
    ("asset_versioning", asset_versioning),
    ("playlist_management", playlist_management),
    ("together_limits", together_limits),
    ("ux_features", ux_features),
]:
    check(name, fn)

if failures:
    print(f"\n{len(failures)} failed")
    raise SystemExit(1)
print("\nAll tests passed")
