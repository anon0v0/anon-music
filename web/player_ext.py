"""
整页播放器（/app）后端扩展：
  - 双源浏览代理（QQ + 网易云）
  - 邮箱注册/登录 + 会话（每用户隔离）
  - 每用户库（我喜欢的/最近播放/自建歌单）
  - 每用户设置（桌面歌词/逐字歌词/音质/播放器背景）

作为 APIRouter 挂载到 main.py。
"""
import os
import re
import ssl
import json
import time
import hmac
import random
import smtplib
import sqlite3
import hashlib
import secrets
import threading
import ipaddress
import socket
import contextvars
from urllib.parse import urlsplit, urlunsplit
from email.message import EmailMessage

import httpx
from fastapi import APIRouter, Body, HTTPException, Request, Response
from qqmusic_api import Client

try:
    from player_config import SMTP, SESSION_DAYS, CODE_TTL, CODE_RESEND_INTERVAL
except Exception:
    SMTP, SESSION_DAYS, CODE_TTL, CODE_RESEND_INTERVAL = {}, 30, 600, 60

router = APIRouter()

# 生产默认音源仅由服务端环境变量提供。它不会通过任何用户 API 返回。
DEFAULT_NCM_BASE = os.environ.get("ANON_MUSIC_DEFAULT_NCM_BASE", "http://127.0.0.1:3000").rstrip("/")
_NCM_BASE_CONTEXT = contextvars.ContextVar("anon_music_ncm_base", default=DEFAULT_NCM_BASE)
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEVICE_PATH = os.environ.get("ANON_MUSIC_DEVICE", os.path.join(_BASE_DIR, "data", "qq_device.json"))
DB_PATH = os.environ.get("ANON_MUSIC_DB", os.path.join(_BASE_DIR, "data", "player_data.db"))

IMAGE_PROXY_HOSTS = {
    "y.gtimg.cn", "p1.music.126.net", "p2.music.126.net", "p3.music.126.net",
    "p4.music.126.net", "p5.music.126.net", "p6.music.126.net",
    "p7.music.126.net", "p8.music.126.net", "p9.music.126.net", "p10.music.126.net",
    "qpic.y.qq.com", "thirdqq.qlogo.cn", "qlogo.cn",
}
AUDIO_PROXY_HOSTS = {"qqmusic.qq.com", "music.126.net"}

_db_lock = threading.Lock()
_code_throttle = {}  # email -> last_sent_ts


# ============================ 工具 ============================
def qq_client() -> Client:
    return Client(device_path=DEVICE_PATH)


def _dump(obj):
    if obj is None:
        return {}
    if hasattr(obj, "model_dump"):
        try:
            return obj.model_dump()
        except Exception:
            pass
    if isinstance(obj, dict):
        return obj
    return {}


def norm_qq_song(s: dict) -> dict:
    s = _dump(s)
    singers = s.get("singer") or []
    artist = ", ".join(x.get("name", "") for x in singers if isinstance(x, dict) and x.get("name"))
    album = s.get("album") or {}
    album_mid = album.get("mid") or ""
    pic = f"https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg" if album_mid else ""
    if not pic and singers:
        smid = singers[0].get("mid", "")
        pic = f"https://y.gtimg.cn/music/photo_new/T001R300x300M000{smid}.jpg" if smid else ""
    return {
        "id": f"qq:{s.get('mid', '')}",
        "name": s.get("name", "") or s.get("title", ""),
        "artist": artist,
        # 歌手数组（P5 歌手页）：id 带源前缀，前端点歌手名跳 #/artist/qq/<mid>。artist 字符串保留不变。
        "artists": [{"id": f"qq:{x.get('mid', '')}", "name": x.get("name", "")}
                    for x in singers if isinstance(x, dict) and x.get("name") and x.get("mid")],
        "pic": pic,
        "album": album.get("name", ""),
        "album_id": f"qq:{album_mid}" if album_mid else "",
        "duration": int(s.get("interval", 0) or 0),
        "sources": ["qq"],
    }


def norm_ncm_song(s: dict) -> dict:
    s = _dump(s)
    ar = s.get("ar") or s.get("artists") or []
    artist = ", ".join(a.get("name", "") for a in ar if isinstance(a, dict) and a.get("name"))
    al = s.get("al") or s.get("album") or {}
    pic = al.get("picUrl", "") or ""
    if pic and "5639395138885805" in pic:
        pic = ""
    dur = (s.get("dt") or s.get("duration") or 0) or 0
    alid = al.get("id")
    return {
        "id": f"netease:{s.get('id', '')}",
        "name": s.get("name", ""),
        "artist": artist,
        "artists": [{"id": f"netease:{a.get('id')}", "name": a.get("name", "")}
                    for a in ar if isinstance(a, dict) and a.get("name") and a.get("id")],
        "pic": pic,
        "album": al.get("name", ""),
        "album_id": f"netease:{alid}" if alid else "",
        "duration": int(dur / 1000),
        "sources": ["netease"],
    }


async def ncm_get(
    request_or_path: Request | str | None,
    path_or_params: str | dict | None = None,
    params: dict | None = None,
    timeout: float = 10.0,
) -> dict:
    """请求网易云兼容 API；兼容旧调用 ncm_get(path, params) 和新调用 ncm_get(request, path, params)。"""
    if isinstance(request_or_path, Request) or request_or_path is None:
        request = request_or_path
        path = str(path_or_params or "")
        query = params or {}
    else:
        request = None
        path = str(request_or_path)
        query = path_or_params if isinstance(path_or_params, dict) else (params or {})
    base_url = get_ncm_base(request) if request is not None else _NCM_BASE_CONTEXT.get()
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as c:
        r = await c.get(f"{base_url}/{path.lstrip('/')}", params=query)
        if r.status_code == 200:
            return r.json()
    return {}


def validate_proxy_url(url: str, allowed_hosts: set[str] | None = None) -> bool:
    """只允许公网 HTTP(S) URL；可选域名白名单用于图片代理。"""
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            return False
        host = parsed.hostname.rstrip(".").lower()
        if allowed_hosts and not any(host == h or host.endswith("." + h) for h in allowed_hosts):
            return False
        for result in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80)):
            if not ipaddress.ip_address(result[4][0]).is_global:
                return False
        return True
    except Exception:
        return False


# ============================ 图片代理（同源，便于 canvas 取色） ============================
@router.get("/api/img")
async def api_img(url: str):
    """代理封面图，附带 CORS 头，使前端 canvas 能读取像素做专辑取色。"""
    from fastapi.responses import Response as RawResponse
    if not validate_proxy_url(url, IMAGE_PROXY_HOSTS):
        raise HTTPException(status_code=400, detail="bad url")
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=False) as c:
            r = await c.get(url, headers={"Referer": "", "User-Agent": "Mozilla/5.0"})
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail="upstream")
        content_type = r.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type == "image/jpg":
            content_type = "image/jpeg"
        if content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}:
            raise HTTPException(status_code=415, detail="unsupported image")
        if len(r.content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="image too large")
        return RawResponse(
            content=r.content,
            media_type=content_type,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=86400",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ============================ 浏览：榜单 ============================
@router.get("/api/charts")
async def api_charts(request: Request, source: str = "netease"):
    out = []
    if source == "qq":
        try:
            cat = _dump(await qq_client().top.get_category())
            for group in cat.get("group", []):
                gname = group.get("name", "") or "榜单"
                for t in group.get("toplist", []):
                    out.append({
                        "source": "qq", "id": t.get("id"), "name": t.get("name", ""),
                        "cover": t.get("front_pic_url") or t.get("head_pic_url") or "",
                        "desc": t.get("intro", "") or gname,
                        "group": gname,
                        "playCount": t.get("listen_num", 0), "songCount": t.get("total_num", 0),
                    })
        except Exception as e:
            return {"code": -1, "msg": f"QQ榜单获取失败: {e}", "data": []}
    else:
        data = await ncm_get(request, "/toplist")
        for t in data.get("list", []):
            gname = "官方榜" if t.get("ToplistType") else "特色榜"
            out.append({
                "source": "netease", "id": t.get("id"), "name": t.get("name", ""),
                "cover": t.get("coverImgUrl", ""),
                "desc": t.get("updateFrequency", "") or t.get("description", "") or "",
                "group": gname,
                "playCount": t.get("playCount", 0), "songCount": t.get("trackCount", 0),
            })
    return {"code": 0, "data": out}


@router.get("/api/chart/detail")
async def api_chart_detail(request: Request, source: str, id: str, num: int = 100):
    meta = {"source": source, "id": id, "name": "", "cover": "", "desc": ""}
    songs = []
    if source == "qq":
        try:
            r = _dump(await qq_client().top.get_detail(top_id=int(id), num=num))
            info = r.get("info") or {}
            meta["name"] = info.get("title") or info.get("name") or ""
            meta["cover"] = info.get("front_pic_url") or info.get("head_pic_url") or ""
            meta["desc"] = info.get("intro", "")
            songs = [norm_qq_song(s) for s in (r.get("songs") or [])]
        except Exception as e:
            return {"code": -1, "msg": f"QQ榜单详情失败: {e}", "data": {"meta": meta, "songs": []}}
    else:
        d = await ncm_get(request, "/playlist/detail", {"id": id})
        pl = d.get("playlist") or {}
        meta["name"] = pl.get("name", ""); meta["cover"] = pl.get("coverImgUrl", "")
        meta["desc"] = pl.get("description", "") or pl.get("updateFrequency", "")
        tr = await ncm_get(request, "/playlist/track/all", {"id": id, "limit": num, "offset": 0})
        songs = [norm_ncm_song(s) for s in (tr.get("songs") or [])]
    return {"code": 0, "data": {"meta": meta, "songs": songs}}


# ============================ 浏览：推荐/广场歌单 ============================
@router.get("/api/recommend/playlists")
async def api_recommend_playlists(request: Request, source: str = "netease", limit: int = 30, offset: int = 0, shuffle: int = 1):
    """shuffle=1 时随机翻页/偏移，使每次刷新返回不同歌单（音源接口本身对相同参数是固定的）。"""
    out = []
    if source == "qq":
        try:
            # 随机页码 → 每次刷新不同的推荐歌单
            page = random.randint(1, 8) if shuffle else (offset // max(limit, 1) + 1)
            r = _dump(await qq_client().recommend.get_recommend_songlist(page=page, num=limit))
            for p in r.get("songlists", []):
                out.append({
                    "source": "qq", "id": p.get("id"), "name": p.get("title", ""),
                    "cover": p.get("picurl", ""), "desc": p.get("desc", ""),
                    "playCount": p.get("listennum", 0), "songCount": p.get("songnum", 0),
                    "creator": p.get("username", "") or p.get("nickname", ""),
                })
        except Exception as e:
            return {"code": -1, "msg": f"QQ推荐歌单失败: {e}", "data": []}
        # QQ 推荐若失败/为空，再随机打散一下顺序
        if shuffle:
            random.shuffle(out)
    else:
        if shuffle:
            # /personalized 是固定的“今日推荐”，改用热门歌单随机偏移 → 每次刷新不同
            off = random.randint(0, 12) * max(limit, 1)
            data = await ncm_get(request, "/top/playlist", {"order": "hot", "limit": limit, "offset": off})
            for p in data.get("playlists", []):
                out.append({
                    "source": "netease", "id": p.get("id"), "name": p.get("name", ""),
                    "cover": p.get("coverImgUrl", ""),
                    "desc": p.get("copywriter", "") or p.get("description", "") or "",
                    "playCount": p.get("playCount", 0), "songCount": p.get("trackCount", 0),
                    "creator": (p.get("creator") or {}).get("nickname", ""),
                })
        if not out:
            data = await ncm_get(request, "/personalized", {"limit": limit})
            for p in data.get("result", []):
                out.append({
                    "source": "netease", "id": p.get("id"), "name": p.get("name", ""),
                    "cover": p.get("picUrl", ""), "desc": p.get("copywriter", ""),
                    "playCount": p.get("playCount", 0), "songCount": p.get("trackCount", 0),
                    "creator": "",
                })
    return {"code": 0, "data": out}


# ============================ 浏览：分类歌单（仿 25pan 歌单分类） ============================
# 网易云有 /top/playlist?cat=&order=，QQ 无直接分类浏览 → 分类统一走网易云
CATEGORIES = ["精选", "华语", "欧美", "流行", "摇滚", "民谣", "电子",
              "古风", "影视原声", "ACG", "怀旧", "清新", "夜晚", "学习"]


@router.get("/api/categories")
async def api_categories():
    return {"code": 0, "data": CATEGORIES}


@router.get("/api/category/playlists")
async def api_category_playlists(request: Request, cat: str = "精选", order: str = "hot", limit: int = 40, offset: int = 0):
    """分类歌单。cat=精选 用每日推荐(/personalized)，其余用 /top/playlist?cat=。order=hot|new。"""
    out = []
    if cat in ("精选", "推荐", ""):
        data = await ncm_get(request, "/personalized", {"limit": limit})
        for p in data.get("result", []):
            out.append({
                "source": "netease", "id": p.get("id"), "name": p.get("name", ""),
                "cover": p.get("picUrl", ""), "desc": p.get("copywriter", ""),
                "playCount": p.get("playCount", 0), "songCount": p.get("trackCount", 0),
                "creator": "",
            })
    else:
        data = await ncm_get(request, "/top/playlist", {"cat": cat, "order": order, "limit": limit, "offset": offset})
        for p in data.get("playlists", []):
            out.append({
                "source": "netease", "id": p.get("id"), "name": p.get("name", ""),
                "cover": p.get("coverImgUrl", ""),
                "desc": p.get("copywriter", "") or p.get("description", "") or "",
                "playCount": p.get("playCount", 0), "songCount": p.get("trackCount", 0),
                "creator": (p.get("creator") or {}).get("nickname", ""),
            })
    return {"code": 0, "data": out}


# ============================ 评论区（网易云 + QQ） ============================
def norm_ncm_comment(c: dict) -> dict:
    u = c.get("user") or {}
    ipl = c.get("ipLocation") or {}
    return {
        "id": str(c.get("commentId", "")),
        "content": c.get("content", ""),
        "user": u.get("nickname", ""),
        "avatar": u.get("avatarUrl", ""),
        "liked": c.get("likedCount", 0),
        "time": c.get("timeStr", ""),
        "ip": ipl.get("location", "") if isinstance(ipl, dict) else "",
    }


def norm_qq_comment(c: dict) -> dict:
    pt = c.get("pub_time", 0) or 0
    try:
        tstr = time.strftime("%Y-%m-%d", time.localtime(pt)) if pt else ""
    except Exception:
        tstr = ""
    return {
        "id": str(c.get("cmid", "")),
        "content": c.get("content", ""),
        "user": c.get("nick", ""),
        "avatar": c.get("avatar", ""),
        "liked": c.get("praise_num", 0),
        "time": tstr,
        "ip": "",
    }


async def _qq_numeric_id(qmid: str):
    try:
        r = await qq_client().song.query_song([qmid])
        rd = r.model_dump() if hasattr(r, "model_dump") else r
        tracks = (rd or {}).get("tracks") or []
        if tracks:
            return tracks[0].get("id")
    except Exception:
        return None
    return None


@router.get("/api/comments")
async def api_comments(request: Request, mid: str, sort: str = "hot", page: int = 1, limit: int = 20):
    ids = mid.split("|")
    id_qq = next((x.split(":")[1] for x in ids if x.startswith("qq:")), None)
    id_netease = next((x.split(":")[1] for x in ids if x.startswith("netease:")), None)
    out = {"hot": [], "list": [], "total": 0, "source": "", "hasMore": False}
    if id_netease:
        out["source"] = "netease"
        d = await ncm_get(request, "/comment/music", {"id": id_netease, "limit": limit, "offset": (page - 1) * limit})
        out["total"] = d.get("total", 0)
        out["hasMore"] = bool(d.get("more", False))
        if page == 1:
            out["hot"] = [norm_ncm_comment(c) for c in (d.get("hotComments") or [])]
        out["list"] = [norm_ncm_comment(c) for c in (d.get("comments") or [])]
        return {"code": 0, "data": out}
    if id_qq:
        out["source"] = "qq"
        try:
            qid = await _qq_numeric_id(id_qq)
            if qid:
                comm = qq_client().comment
                fn = comm.get_hot_comments if sort == "hot" else comm.get_new_comments
                r = _dump(await fn(int(qid), page_num=page, page_size=limit))
                cl = r.get("comments") or []
                out["list"] = [norm_qq_comment(c) for c in cl]
                out["total"] = r.get("total") or r.get("total_cm_num") or len(cl)
                out["hasMore"] = bool(r.get("has_more"))
        except Exception as e:
            out["msg"] = f"QQ评论获取失败: {e}"
        return {"code": 0, "data": out}
    return {"code": -1, "data": out}


# ============================ 浏览：歌单详情 ============================
@router.get("/api/playlist/detail")
async def api_playlist_detail(request: Request, source: str, id: str, num: int = 200):
    meta = {"source": source, "id": id, "name": "", "cover": "", "desc": ""}
    songs = []
    if source == "qq":
        try:
            r = _dump(await qq_client().songlist.get_detail(songlist_id=int(id), num=num))
            info = r.get("info") or {}
            meta["name"] = info.get("title") or info.get("dissname") or ""
            meta["cover"] = info.get("logo") or info.get("picurl") or ""
            meta["desc"] = info.get("desc", "")
            songs = [norm_qq_song(s) for s in (r.get("songs") or [])]
        except Exception as e:
            return {"code": -1, "msg": f"QQ歌单详情失败: {e}", "data": {"meta": meta, "songs": []}}
    else:
        d = await ncm_get(request, "/playlist/detail", {"id": id})
        pl = d.get("playlist") or {}
        meta["name"] = pl.get("name", ""); meta["cover"] = pl.get("coverImgUrl", "")
        meta["desc"] = pl.get("description", "")
        tr = await ncm_get(request, "/playlist/track/all", {"id": id, "limit": num, "offset": 0})
        songs = [norm_ncm_song(s) for s in (tr.get("songs") or [])]
    return {"code": 0, "data": {"meta": meta, "songs": songs}}


# ============================ 浏览：专辑详情 ============================
@router.get("/api/album/detail")
async def api_album_detail(request: Request, source: str, id: str, num: int = 100):
    meta = {"source": source, "id": id, "name": "", "cover": "", "desc": ""}
    songs = []
    if source == "qq":
        try:
            client = qq_client()
            det = _dump(await client.album.get_detail(id))
            album = det.get("album") or {}
            singers = det.get("singers") or []
            meta["name"] = album.get("name") or album.get("title") or ""
            meta["artist"] = ", ".join(x.get("name", "") for x in singers if x.get("name"))
            amid = album.get("mid") or (id if not str(id).isdecimal() else "")
            if amid:
                meta["cover"] = f"https://y.gtimg.cn/music/photo_new/T002R300x300M000{amid}.jpg"
            meta["desc"] = album.get("desc", "")
            sg = _dump(await client.album.get_song(id, num=num))
            songs = [norm_qq_song(s) for s in (sg.get("song_list") or [])]
        except Exception as e:
            return {"code": -1, "msg": f"QQ专辑详情失败: {e}", "data": {"meta": meta, "songs": []}}
    else:
        d = await ncm_get(request, "/album", {"id": id})
        al = d.get("album") or {}
        meta["name"] = al.get("name", ""); meta["cover"] = al.get("picUrl", "")
        meta["desc"] = al.get("description", "")
        songs = [norm_ncm_song(s) for s in (d.get("songs") or [])]
    return {"code": 0, "data": {"meta": meta, "songs": songs}}


# ============================ SQLite ============================
def _conn():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db():
    with _db_lock, _conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                pwd_salt TEXT NOT NULL, pwd_hash TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS email_codes (
                email TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY, settings_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_sources (
                user_id INTEGER PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                base_url TEXT NOT NULL DEFAULT '',
                updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS liked (
                user_id INTEGER NOT NULL DEFAULT 0, mid TEXT NOT NULL,
                song_json TEXT NOT NULL, added_at REAL NOT NULL,
                PRIMARY KEY (user_id, mid)
            );
            CREATE TABLE IF NOT EXISTS recent (
                user_id INTEGER NOT NULL DEFAULT 0, mid TEXT NOT NULL,
                song_json TEXT NOT NULL, played_at REAL NOT NULL,
                PRIMARY KEY (user_id, mid)
            );
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL DEFAULT 0,
                name TEXT NOT NULL, cover TEXT DEFAULT '', created_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS playlist_songs (
                playlist_id INTEGER NOT NULL, mid TEXT NOT NULL,
                song_json TEXT NOT NULL, pos REAL NOT NULL,
                PRIMARY KEY (playlist_id, mid)
            );
            CREATE TABLE IF NOT EXISTS user_queue (
                user_id INTEGER PRIMARY KEY, songs_json TEXT NOT NULL,
                idx INTEGER NOT NULL DEFAULT 0, updated_at REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS daily_recs (
                user_id INTEGER NOT NULL, day TEXT NOT NULL,
                songs_json TEXT NOT NULL,
                PRIMARY KEY (user_id, day)
            );
            CREATE TABLE IF NOT EXISTS play_log (
                user_id INTEGER NOT NULL, mid TEXT NOT NULL, day TEXT NOT NULL,
                song_json TEXT NOT NULL, plays INTEGER NOT NULL DEFAULT 0,
                secs REAL NOT NULL DEFAULT 0, last_played REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, mid, day)
            );
            CREATE TABLE IF NOT EXISTS fav_playlists (
                user_id INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, ext_id TEXT NOT NULL,
                name TEXT DEFAULT '', cover TEXT DEFAULT '', creator TEXT DEFAULT '',
                song_count INTEGER DEFAULT 0, added_at REAL NOT NULL,
                PRIMARY KEY (user_id, source, ext_id)
            );
            """
        )
        _migrate_user_id(c)


def _pk_columns(c, table: str) -> list[str]:
    rows = c.execute(f"PRAGMA table_info({table})").fetchall()
    return [r["name"] for r in sorted(rows, key=lambda r: r["pk"]) if r["pk"]]


def _rebuild_user_scoped_table(c, table: str, value_col: str, time_col: str):
    tmp = f"{table}_v2"
    c.execute(f"DROP TABLE IF EXISTS {tmp}")
    c.execute(f"""CREATE TABLE {tmp} (
        user_id INTEGER NOT NULL DEFAULT 0, mid TEXT NOT NULL,
        {value_col} TEXT NOT NULL, {time_col} REAL NOT NULL,
        PRIMARY KEY (user_id, mid)
    )""")
    cols = [r["name"] for r in c.execute(f"PRAGMA table_info({table})")]
    uid_expr = "user_id" if "user_id" in cols else "0"
    c.execute(f"INSERT OR REPLACE INTO {tmp}(user_id,mid,{value_col},{time_col}) SELECT {uid_expr},mid,{value_col},{time_col} FROM {table}")
    c.execute(f"DROP TABLE {table}")
    c.execute(f"ALTER TABLE {tmp} RENAME TO {table}")


def _migrate_user_id(c):
    """旧版本 liked/recent/playlists 无 user_id 时补列（迁移到 guest=0）。"""
    for tbl in ("liked", "recent", "playlists"):
        cols = [r["name"] for r in c.execute(f"PRAGMA table_info({tbl})").fetchall()]
        if "user_id" not in cols:
            c.execute(f"ALTER TABLE {tbl} ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0")
    if _pk_columns(c, "liked") != ["user_id", "mid"]:
        _rebuild_user_scoped_table(c, "liked", "song_json", "added_at")
    if _pk_columns(c, "recent") != ["user_id", "mid"]:
        _rebuild_user_scoped_table(c, "recent", "song_json", "played_at")
    # 2026-07：昵称 + emoji 头像；歌单来源（导入的 QQ/网易歌单打角标）
    ucols = [r["name"] for r in c.execute("PRAGMA table_info(users)").fetchall()]
    if "nickname" not in ucols:
        c.execute("ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ''")
    if "avatar" not in ucols:
        c.execute("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''")
    pcols = [r["name"] for r in c.execute("PRAGMA table_info(playlists)").fetchall()]
    if "source" not in pcols:
        c.execute("ALTER TABLE playlists ADD COLUMN source TEXT DEFAULT ''")


# ============================ 鉴权工具 ============================
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
COOKIE = "np_session"


def hash_pw(pw: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200000).hex()
    return salt, h


def verify_pw(pw: str, salt: str, h: str) -> bool:
    calc = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 200000).hex()
    return hmac.compare_digest(calc, h)


def current_uid(request: Request) -> int:
    tok = request.cookies.get(COOKIE)
    if not tok:
        return 0
    with _conn() as c:
        r = c.execute("SELECT user_id, expires_at FROM sessions WHERE token=?", (tok,)).fetchone()
    if r and r["expires_at"] > time.time():
        return r["user_id"]
    return 0


def require_uid(request: Request) -> int:
    uid = current_uid(request)
    if not uid:
        raise HTTPException(401, "login required")
    return uid


def _normalize_custom_source_url(value: object) -> str:
    raw = str(value or "").strip().rstrip("/")
    try:
        parsed = urlsplit(raw)
    except Exception:
        raise HTTPException(400, "音源地址格式无效")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise HTTPException(400, "音源地址必须是 http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(400, "音源地址不能包含账号、查询参数或片段")
    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost":
        raise HTTPException(400, "音源地址必须指向公网服务")
    try:
        addresses = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except OSError:
        raise HTTPException(400, "音源域名无法解析")
    for result in addresses:
        try:
            if not ipaddress.ip_address(result[4][0]).is_global:
                raise HTTPException(400, "音源地址必须指向公网服务")
        except ValueError:
            raise HTTPException(400, "音源域名解析结果无效")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def get_ncm_base(request: Request | None) -> str:
    if request is None:
        return DEFAULT_NCM_BASE
    uid = current_uid(request)
    if not uid:
        return DEFAULT_NCM_BASE
    with _conn() as c:
        row = c.execute(
            "SELECT enabled,base_url FROM user_sources WHERE user_id=?", (uid,)
        ).fetchone()
    if row and row["enabled"] and row["base_url"]:
        return row["base_url"].rstrip("/")
    return DEFAULT_NCM_BASE


def _custom_source_view(row=None) -> dict:
    if not row:
        return {"enabled": False, "configured": False, "base_url": ""}
    base_url = row["base_url"] or ""
    return {
        "enabled": bool(row["enabled"] and base_url),
        "configured": bool(base_url),
        "base_url": base_url,
    }


@router.get("/api/settings/source")
def get_custom_source(request: Request):
    uid = require_uid(request)
    with _conn() as c:
        row = c.execute(
            "SELECT enabled,base_url FROM user_sources WHERE user_id=?", (uid,)
        ).fetchone()
    return {"code": 0, "data": _custom_source_view(row)}


@router.put("/api/settings/source")
def put_custom_source(request: Request, body: dict = Body(...)):
    uid = require_uid(request)
    enabled = bool((body or {}).get("enabled", True))
    base_url = _normalize_custom_source_url((body or {}).get("base_url"))
    with _db_lock, _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO user_sources(user_id,enabled,base_url,updated_at) VALUES (?,?,?,?)",
            (uid, 1 if enabled else 0, base_url, time.time()),
        )
    return {"code": 0, "data": {"enabled": enabled, "configured": True, "base_url": base_url}}


@router.delete("/api/settings/source")
def delete_custom_source(request: Request):
    uid = require_uid(request)
    with _db_lock, _conn() as c:
        c.execute("DELETE FROM user_sources WHERE user_id=?", (uid,))
    return {"code": 0, "data": _custom_source_view()}


def begin_request_source(request: Request):
    return _NCM_BASE_CONTEXT.set(get_ncm_base(request))


def end_request_source(token) -> None:
    _NCM_BASE_CONTEXT.reset(token)


def current_ncm_url(path: str) -> str:
    return f"{_NCM_BASE_CONTEXT.get()}/{str(path).lstrip('/')}"


def _new_session(uid: int) -> str:
    tok = secrets.token_hex(32)
    with _db_lock, _conn() as c:
        c.execute("INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)",
                  (tok, uid, time.time() + SESSION_DAYS * 86400))
    return tok


def send_email(to: str, subject: str, body: str):
    if not SMTP:
        raise RuntimeError("SMTP 未配置")
    msg = EmailMessage()
    msg["From"] = f"{SMTP.get('from_name', 'Music')} <{SMTP['user']}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    ctx = ssl.create_default_context()
    with smtplib.SMTP(SMTP["host"], SMTP["port"], timeout=20) as s:
        if SMTP.get("starttls"):
            s.starttls(context=ctx)
        s.login(SMTP["user"], SMTP["password"])
        s.send_message(msg)


# ============================ 鉴权接口 ============================
@router.post("/api/auth/send_code")
def auth_send_code(body: dict = Body(...)):
    email = (body or {}).get("email", "").strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    with _conn() as c:
        if c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise HTTPException(400, "该邮箱已注册，请直接登录")
    last = _code_throttle.get(email, 0)
    if time.time() - last < CODE_RESEND_INTERVAL:
        raise HTTPException(429, f"请 {int(CODE_RESEND_INTERVAL - (time.time() - last))} 秒后再试")
    code = f"{secrets.randbelow(1000000):06d}"
    with _db_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO email_codes(email,code,expires_at) VALUES (?,?,?)",
                  (email, code, time.time() + CODE_TTL))
    try:
        send_email(email, "Anon Music 注册验证码",
                   f"你的验证码是：{code}\n\n{CODE_TTL // 60} 分钟内有效。如非本人操作请忽略。")
    except Exception as e:
        raise HTTPException(500, f"邮件发送失败：{e}")
    _code_throttle[email] = time.time()
    return {"code": 0, "msg": "验证码已发送"}


@router.post("/api/auth/register")
def auth_register(response: Response, body: dict = Body(...)):
    email = (body or {}).get("email", "").strip().lower()
    code = (body or {}).get("code", "").strip()
    pw = (body or {}).get("password", "")
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "邮箱格式不正确")
    if len(pw) < 6:
        raise HTTPException(400, "密码至少 6 位")
    with _conn() as c:
        row = c.execute("SELECT code, expires_at FROM email_codes WHERE email=?", (email,)).fetchone()
    if not row or row["expires_at"] < time.time() or row["code"] != code:
        raise HTTPException(400, "验证码错误或已过期")
    salt, h = hash_pw(pw)
    with _db_lock, _conn() as c:
        if c.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
            raise HTTPException(400, "该邮箱已注册")
        cur = c.execute("INSERT INTO users(email,pwd_salt,pwd_hash,created_at) VALUES (?,?,?,?)",
                        (email, salt, h, time.time()))
        uid = cur.lastrowid
        c.execute("DELETE FROM email_codes WHERE email=?", (email,))
    tok = _new_session(uid)
    response.set_cookie(COOKIE, tok, max_age=SESSION_DAYS * 86400, httponly=True, secure=True, samesite="lax")
    return {"code": 0, "data": {"id": uid, "email": email}}


@router.post("/api/auth/login")
def auth_login(response: Response, body: dict = Body(...)):
    email = (body or {}).get("email", "").strip().lower()
    pw = (body or {}).get("password", "")
    with _conn() as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not u or not verify_pw(pw, u["pwd_salt"], u["pwd_hash"]):
        raise HTTPException(401, "邮箱或密码错误")
    tok = _new_session(u["id"])
    response.set_cookie(COOKIE, tok, max_age=SESSION_DAYS * 86400, httponly=True, secure=True, samesite="lax")
    return {"code": 0, "data": {"id": u["id"], "email": u["email"]}}


@router.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    tok = request.cookies.get(COOKIE)
    if tok:
        with _db_lock, _conn() as c:
            c.execute("DELETE FROM sessions WHERE token=?", (tok,))
    response.delete_cookie(COOKIE)
    return {"code": 0}


@router.get("/api/auth/me")
def auth_me(request: Request):
    uid = current_uid(request)
    if not uid:
        return {"code": 0, "data": None}
    with _conn() as c:
        u = c.execute("SELECT id,email,nickname,avatar FROM users WHERE id=?", (uid,)).fetchone()
    return {"code": 0, "data": ({
        "id": u["id"], "email": u["email"],
        "nickname": u["nickname"] or "", "avatar": u["avatar"] or "",
    } if u else None)}


@router.put("/api/auth/profile")
def auth_profile(request: Request, body: dict = Body(...)):
    """修改展示昵称 + emoji 头像。昵称限 20 字；头像只收 emoji（≤8 码位防灌长串）。"""
    uid = current_uid(request)
    if not uid:
        raise HTTPException(401, "not logged in")
    nickname = str((body or {}).get("nickname", "")).strip()[:20]
    avatar = str((body or {}).get("avatar", "")).strip()[:8]
    with _db_lock, _conn() as c:
        c.execute("UPDATE users SET nickname=?, avatar=? WHERE id=?", (nickname, avatar, uid))
    return {"code": 0, "data": {"nickname": nickname, "avatar": avatar}}


# ============================ 设置 ============================
DEFAULT_SETTINGS = {
    "desktopLyrics": {"enabled": False, "fontSize": 18, "color": "#ffffff", "doubleRow": False},
    "wordByWord": {"enabled": True},
    "quality": "standard",
    "background": {"mode": "cover"},  # cover(跟随封面) / default / solid / gradient
}


@router.get("/api/settings")
def get_settings(request: Request):
    uid = current_uid(request)
    with _conn() as c:
        r = c.execute("SELECT settings_json FROM user_settings WHERE user_id=?", (uid,)).fetchone()
    data = json.loads(r["settings_json"]) if r else {}
    merged = {**DEFAULT_SETTINGS, **data}
    return {"code": 0, "data": merged}


@router.put("/api/settings")
def put_settings(request: Request, body: dict = Body(...)):
    uid = current_uid(request)
    with _db_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO user_settings(user_id,settings_json) VALUES (?,?)",
                  (uid, json.dumps(body or {}, ensure_ascii=False)))
    return {"code": 0}


# ============================ 库（按用户隔离） ============================
def _song_mid(song: dict) -> str:
    return (song or {}).get("id", "")


@router.get("/api/library/liked")
def lib_liked_list(request: Request):
    uid = current_uid(request)
    with _conn() as c:
        rows = c.execute("SELECT song_json FROM liked WHERE user_id=? ORDER BY added_at DESC", (uid,)).fetchall()
    return {"code": 0, "data": [json.loads(r["song_json"]) for r in rows]}


@router.post("/api/library/liked")
def lib_liked_add(request: Request, song: dict = Body(...)):
    uid = current_uid(request)
    mid = _song_mid(song)
    if not mid:
        raise HTTPException(400, "missing song id")
    with _db_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO liked(user_id,mid,song_json,added_at) VALUES (?,?,?,?)",
                  (uid, mid, json.dumps(song, ensure_ascii=False), time.time()))
    return {"code": 0}


@router.delete("/api/library/liked")
def lib_liked_del(request: Request, mid: str):
    uid = current_uid(request)
    with _db_lock, _conn() as c:
        c.execute("DELETE FROM liked WHERE user_id=? AND mid=?", (uid, mid))
    return {"code": 0}


# ---- 播放队列（按账号独立持久化；未登录 user_id=0 公共） ----
@router.get("/api/library/queue")
def lib_queue_get(request: Request):
    uid = current_uid(request)
    with _conn() as c:
        row = c.execute("SELECT songs_json, idx FROM user_queue WHERE user_id=?", (uid,)).fetchone()
    if not row:
        return {"code": 0, "data": {"songs": [], "index": 0}}
    try:
        songs = json.loads(row["songs_json"])
    except Exception:
        songs = []
    return {"code": 0, "data": {"songs": songs, "index": row["idx"] or 0}}


@router.put("/api/library/queue")
def lib_queue_put(request: Request, body: dict = Body(...)):
    uid = current_uid(request)
    songs = body.get("songs") or []
    idx = int(body.get("index") or 0)
    # 限制队列长度，避免存太大
    if len(songs) > 500:
        songs = songs[:500]
    with _db_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO user_queue(user_id,songs_json,idx,updated_at) VALUES (?,?,?,?)",
                  (uid, json.dumps(songs, ensure_ascii=False), idx, time.time()))
    return {"code": 0}


@router.get("/api/library/recent")
def lib_recent_list(request: Request, limit: int = 100):
    uid = current_uid(request)
    with _conn() as c:
        rows = c.execute("SELECT song_json FROM recent WHERE user_id=? ORDER BY played_at DESC LIMIT ?",
                         (uid, limit)).fetchall()
    return {"code": 0, "data": [json.loads(r["song_json"]) for r in rows]}


@router.post("/api/library/recent")
def lib_recent_add(request: Request, song: dict = Body(...)):
    uid = current_uid(request)
    mid = _song_mid(song)
    if not mid:
        raise HTTPException(400, "missing song id")
    with _db_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO recent(user_id,mid,song_json,played_at) VALUES (?,?,?,?)",
                  (uid, mid, json.dumps(song, ensure_ascii=False), time.time()))
        c.execute("DELETE FROM recent WHERE user_id=? AND mid IN ("
                  "SELECT mid FROM recent WHERE user_id=? ORDER BY played_at DESC LIMIT -1 OFFSET 200)",
                  (uid, uid))
    return {"code": 0}


@router.get("/api/library/playlists")
def lib_playlists_list(request: Request):
    uid = current_uid(request)
    with _conn() as c:
        rows = c.execute("SELECT * FROM playlists WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall()
        out = []
        for r in rows:
            cnt = c.execute("SELECT COUNT(*) AS n FROM playlist_songs WHERE playlist_id=?", (r["id"],)).fetchone()["n"]
            out.append({"id": r["id"], "name": r["name"], "cover": r["cover"], "songCount": cnt,
                        "source": (r["source"] if "source" in r.keys() else "") or ""})
    return {"code": 0, "data": out}


# ============================ 收藏歌单（收藏别人的 QQ/网易云歌单，只存引用不导入歌曲） ============================
@router.get("/api/library/fav_playlists")
def fav_pl_list(request: Request):
    uid = current_uid(request)
    with _conn() as c:
        rows = c.execute("SELECT * FROM fav_playlists WHERE user_id=? ORDER BY added_at DESC", (uid,)).fetchall()
    return {"code": 0, "data": [{"source": r["source"], "id": r["ext_id"], "name": r["name"],
                                 "cover": r["cover"], "creator": r["creator"], "songCount": r["song_count"]} for r in rows]}


@router.get("/api/library/fav_playlists/check")
def fav_pl_check(request: Request, source: str, id: str):
    uid = current_uid(request)
    with _conn() as c:
        r = c.execute("SELECT 1 FROM fav_playlists WHERE user_id=? AND source=? AND ext_id=?",
                      (uid, source, str(id))).fetchone()
    return {"code": 0, "faved": bool(r)}


@router.post("/api/library/fav_playlists")
def fav_pl_add(request: Request, body: dict = Body(...)):
    uid = current_uid(request)
    source = str((body or {}).get("source", "")).strip()
    ext_id = str((body or {}).get("id", "")).strip()
    if source not in ("qq", "netease") or not ext_id:
        raise HTTPException(400, "bad source/id")
    with _db_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO fav_playlists(user_id,source,ext_id,name,cover,creator,song_count,added_at) "
                  "VALUES (?,?,?,?,?,?,?,?)",
                  (uid, source, ext_id, str((body or {}).get("name", ""))[:120], str((body or {}).get("cover", "")),
                   str((body or {}).get("creator", ""))[:60], int((body or {}).get("songCount") or 0), time.time()))
    return {"code": 0}


@router.delete("/api/library/fav_playlists")
def fav_pl_del(request: Request, source: str, id: str):
    uid = current_uid(request)
    with _db_lock, _conn() as c:
        c.execute("DELETE FROM fav_playlists WHERE user_id=? AND source=? AND ext_id=?", (uid, source, str(id)))
    return {"code": 0}


@router.post("/api/library/playlists")
def lib_playlist_create(request: Request, body: dict = Body(...)):
    uid = current_uid(request)
    name = (body or {}).get("name", "").strip() or "新建歌单"
    with _db_lock, _conn() as c:
        cur = c.execute("INSERT INTO playlists(user_id,name,cover,created_at) VALUES (?,?,?,?)",
                        (uid, name, "", time.time()))
        pid = cur.lastrowid
    return {"code": 0, "data": {"id": pid, "name": name}}


def _extract_playlist_id(text: str):
    """从歌单链接/文本里提取 (source, id)。不做网络请求（短链跟随由 resolve 端点负责）。"""
    t = (text or "").strip()
    low = t.lower()
    # 网易云：music.163.com/#/playlist?id= / y.music.163.com/m/playlist?id= / /playlist/123
    if "163.com" in low or "163cn" in low or "music.163" in low:
        m = re.search(r"[?&#]id=(\d+)", t) or re.search(r"/playlist/(\d+)", t)
        if m:
            return ("netease", m.group(1))
    # QQ 音乐：taoge.html?...id= / y.qq.com/n/ryqq/playlist/123 / #type=taoge&id=
    if "qq.com" in low or "taoge" in low:
        m = (re.search(r"[?&#](?:id|disstid|dissid)=(\d+)", t)
             or re.search(r"/playlist/(\d+)", t))
        if m:
            return ("qq", m.group(1))
    return None


def _resolve_host_allowed(u: str) -> bool:
    """SSRF 防护：只允许 QQ/网易官方分享域名，且解析出的 IP 不得是内网/环回/链路本地/保留地址。
    端点未鉴权 + CORS *，不加此限制会变成对内网/云元数据(169.254.169.254)的盲扫描 oracle。"""
    import ipaddress
    import socket
    from urllib.parse import urlsplit
    try:
        host = (urlsplit(u).hostname or "").lower()
    except Exception:
        return False
    if not host:
        return False
    ALLOWED_SUFFIX = ("163.com", "qq.com", "163cn.tv", "url.cn")
    if not any(host == d or host.endswith("." + d) for d in ALLOWED_SUFFIX):
        return False
    try:
        for res in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(res[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
    except Exception:
        return False
    return True


@router.get("/api/playlist/resolve")
async def api_playlist_resolve(url: str):
    """解析歌单分享链接为 {source, id}。支持直链 + QQ/网易短链(跟随 302)。纯数字→ambiguous 让前端选源。"""
    text = (url or "").strip()
    if not text:
        return {"code": -1, "msg": "空链接"}
    if text.isdigit():
        return {"code": 0, "source": "", "id": text, "ambiguous": True}
    got = _extract_playlist_id(text)
    if got:
        return {"code": 0, "source": got[0], "id": got[1]}
    # 短链：跟随重定向，从重定向历史 + 最终地址里逐个提取（taoge.html 可能返 500，但 URL 已含 id）
    if text.startswith("http"):
        if not _resolve_host_allowed(text):
            return {"code": -1, "msg": "没能识别歌单链接"}   # 非官方域名/内网地址：不请求，且不泄露原因
        try:
            async with httpx.AsyncClient(timeout=8, follow_redirects=True) as c:
                r = await c.get(text, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            for u in [str(h.url) for h in r.history] + [str(r.url)]:
                got = _extract_playlist_id(u)
                if got:
                    return {"code": 0, "source": got[0], "id": got[1]}
        except Exception:
            return {"code": -1, "msg": "解析失败，请稍后再试"}   # 不回显原始异常（避免开/闭端口 oracle）
    return {"code": -1, "msg": "没能识别歌单链接"}


@router.post("/api/library/playlists/import")
async def lib_playlist_import(request: Request, body: dict = Body(...)):
    """导入外部歌单（QQ/网易云）：抓全部歌曲落成本地歌单，playlists.source 记来源供前端打角标。"""
    uid = current_uid(request)
    source = str((body or {}).get("source", "")).strip()
    ext_id = str((body or {}).get("id", "")).strip()
    if source not in ("qq", "netease") or not ext_id.isdigit():
        raise HTTPException(400, "missing/invalid source or id")
    name, cover, songs = "", "", []
    if source == "qq":
        try:
            r = _dump(await qq_client().songlist.get_detail(songlist_id=int(ext_id), num=1000))
            info = r.get("info") or {}
            name = info.get("title") or info.get("dissname") or ""
            cover = info.get("logo") or info.get("picurl") or ""
            songs = [norm_qq_song(s) for s in (r.get("songs") or [])]
        except Exception as e:
            return {"code": -1, "msg": f"QQ歌单获取失败: {e}"}
    else:
        try:
            d = await ncm_get(request, "/playlist/detail", {"id": ext_id})
            pl = d.get("playlist") or {}
            name = pl.get("name", "")
            cover = pl.get("coverImgUrl", "")
            tr = await ncm_get(request, "/playlist/track/all", {"id": ext_id, "limit": 1000, "offset": 0})
            songs = [norm_ncm_song(s) for s in (tr.get("songs") or [])]
        except Exception as e:
            return {"code": -1, "msg": f"网易歌单获取失败: {e}"}
    if not songs:
        return {"code": -1, "msg": "歌单为空或获取失败（可能是私密歌单）"}
    name = (name or "导入歌单").strip()[:60]
    now = time.time()
    with _db_lock, _conn() as c:
        cur = c.execute("INSERT INTO playlists(user_id,name,cover,created_at,source) VALUES (?,?,?,?,?)",
                        (uid, name, cover or songs[0].get("pic", ""), now, source))
        pid = cur.lastrowid
        for i, s in enumerate(songs):
            mid = s.get("id", "")
            # norm 后 id 恒带源前缀（qq:/netease:），仅前缀无实际 id 的是脏数据，跳过
            if mid.split(":", 1)[-1].strip() in ("", "None"):
                continue
            # pos 用 now+i 保持原歌单顺序（加歌端点用 time.time() 追加在后，天然兼容）
            c.execute("INSERT OR REPLACE INTO playlist_songs(playlist_id,mid,song_json,pos) VALUES (?,?,?,?)",
                      (pid, mid, json.dumps(s, ensure_ascii=False), now + i))
    return {"code": 0, "data": {"id": pid, "name": name, "count": len(songs)}}


def _own_playlist(c, uid, pid):
    return c.execute("SELECT 1 FROM playlists WHERE id=? AND user_id=?", (pid, uid)).fetchone()


@router.put("/api/library/playlists/{pid}")
def lib_playlist_rename(request: Request, pid: int, body: dict = Body(...)):
    uid = current_uid(request)
    name = (body or {}).get("name", "").strip()
    if not name:
        raise HTTPException(400, "missing name")
    with _db_lock, _conn() as c:
        if not _own_playlist(c, uid, pid):
            raise HTTPException(404, "playlist not found")
        c.execute("UPDATE playlists SET name=? WHERE id=?", (name, pid))
    return {"code": 0}


@router.delete("/api/library/playlists/{pid}")
def lib_playlist_delete(request: Request, pid: int):
    uid = current_uid(request)
    with _db_lock, _conn() as c:
        if not _own_playlist(c, uid, pid):
            raise HTTPException(404, "playlist not found")
        c.execute("DELETE FROM playlists WHERE id=?", (pid,))
        c.execute("DELETE FROM playlist_songs WHERE playlist_id=?", (pid,))
    return {"code": 0}


@router.get("/api/library/playlists/{pid}")
def lib_playlist_detail(request: Request, pid: int):
    uid = current_uid(request)
    with _conn() as c:
        pl = c.execute("SELECT * FROM playlists WHERE id=? AND user_id=?", (pid, uid)).fetchone()
        if not pl:
            raise HTTPException(404, "playlist not found")
        rows = c.execute("SELECT song_json FROM playlist_songs WHERE playlist_id=? ORDER BY pos ASC", (pid,)).fetchall()
    meta = {"source": "local", "id": pid, "name": pl["name"], "cover": pl["cover"], "desc": ""}
    songs = [json.loads(r["song_json"]) for r in rows]
    if songs and not meta["cover"]:
        meta["cover"] = songs[0].get("pic", "")
    return {"code": 0, "data": {"meta": meta, "songs": songs}}


@router.post("/api/library/playlists/{pid}/songs")
def lib_playlist_add_song(request: Request, pid: int, song: dict = Body(...)):
    uid = current_uid(request)
    mid = _song_mid(song)
    if not mid:
        raise HTTPException(400, "missing song id")
    with _db_lock, _conn() as c:
        if not _own_playlist(c, uid, pid):
            raise HTTPException(404, "playlist not found")
        c.execute("INSERT OR REPLACE INTO playlist_songs(playlist_id,mid,song_json,pos) VALUES (?,?,?,?)",
                  (pid, mid, json.dumps(song, ensure_ascii=False), time.time()))
    return {"code": 0}


@router.delete("/api/library/playlists/{pid}/songs")
def lib_playlist_del_song(request: Request, pid: int, mid: str):
    uid = current_uid(request)
    with _db_lock, _conn() as c:
        if not _own_playlist(c, uid, pid):
            raise HTTPException(404, "playlist not found")
        c.execute("DELETE FROM playlist_songs WHERE playlist_id=? AND mid=?", (pid, mid))
    return {"code": 0}


@router.post("/api/library/playlists/{pid}/songs/batch-delete")
def lib_playlist_batch_delete(request: Request, pid: int, body: dict = Body(...)):
    uid = current_uid(request)
    mids = [str(x).strip() for x in ((body or {}).get("mids") or []) if str(x).strip()][:500]
    if not mids:
        raise HTTPException(400, "missing mids")
    with _db_lock, _conn() as c:
        if not _own_playlist(c, uid, pid):
            raise HTTPException(404, "playlist not found")
        c.executemany("DELETE FROM playlist_songs WHERE playlist_id=? AND mid=?", [(pid, mid) for mid in mids])
    return {"code": 0, "count": len(mids)}


@router.put("/api/library/playlists/{pid}/songs/reorder")
def lib_playlist_reorder(request: Request, pid: int, body: dict = Body(...)):
    uid = current_uid(request)
    mids = [str(x).strip() for x in ((body or {}).get("mids") or []) if str(x).strip()][:1000]
    if not mids:
        raise HTTPException(400, "missing mids")
    with _db_lock, _conn() as c:
        if not _own_playlist(c, uid, pid):
            raise HTTPException(404, "playlist not found")
        existing = [r["mid"] for r in c.execute("SELECT mid FROM playlist_songs WHERE playlist_id=? ORDER BY pos", (pid,))]
        existing_set = set(existing)
        ordered = [mid for mid in mids if mid in existing_set]
        seen = set(ordered)
        ordered += [mid for mid in existing if mid not in seen]
        now = time.time()
        c.executemany("UPDATE playlist_songs SET pos=? WHERE playlist_id=? AND mid=?", [(now + i, pid, mid) for i, mid in enumerate(ordered)])
    return {"code": 0, "count": len(ordered)}
