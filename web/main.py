from fastapi import FastAPI, Request, Response, Cookie, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import asyncio
import hashlib
import secrets
import hmac
import time
from qqmusic_api import Client, Credential
from qqmusic_api.modules.song import SongFileType, SongFileInfo

import os
import json as _json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
QQ_CREDENTIAL_PATH = os.environ.get(
    "ANON_MUSIC_QQ_CREDENTIAL", os.path.join(BASE_DIR, "data", "qq_credential.json")
)
COOKIE_PATH = QQ_CREDENTIAL_PATH
QQ_DEVICE = os.environ.get(
    "ANON_MUSIC_DEVICE", os.path.join(BASE_DIR, "data", "qq_device.json")
)

# QQ 凭证缓存：共享 cookie 的 musickey 常已过期，需用 refresh_token 在线续期
# （astrbot/meting 运行时也是这么做的）。这里缓存刷新后的 Credential，避免每次请求都刷新。
_qq_cred_cache = {"cred": None, "ts": 0.0}
_QQ_CRED_TTL = 1800  # 30 分钟


def _load_qq_credential_from_cookie():
    """从共享 cookie 文件构造（未刷新的）Credential；失败返回 None。"""
    if not os.path.exists(COOKIE_PATH):
        return None
    try:
        with open(COOKIE_PATH, "r", encoding="utf-8-sig") as f:
            cfg = _json.load(f)
        tencent_cookie = cfg.get("tencent_cookie", "").strip().lstrip("﻿")
        auto_musickey = cfg.get("_tencent_auto_musickey", "")
        if not tencent_cookie:
            return None
        if tencent_cookie.startswith("{"):
            cred_dict = _json.loads(tencent_cookie)
            if auto_musickey:
                cred_dict["musickey"] = auto_musickey
            return Credential.model_validate(cred_dict)
        cookie_dict = {}
        for part in tencent_cookie.replace("\n", ";").split(";"):
            part = part.strip()
            if "=" in part:
                k, _, v = part.partition("=")
                cookie_dict[k.strip()] = v.strip()
        musicid_str = cookie_dict.get("uin", cookie_dict.get("qqmusic_uin", "")).lstrip("o")
        musickey = auto_musickey or cookie_dict.get("qm_keyst", cookie_dict.get("qqmusic_key", ""))
        cred_data = {"musickey": musickey, "loginType": int(cookie_dict.get("tmeLoginType", "2") or "2")}
        if musicid_str.isdigit():
            cred_data["musicid"] = int(musicid_str)
            cred_data["str_musicid"] = musicid_str
        return Credential.model_validate(cred_data)
    except Exception:
        return None


async def get_qq_credential(force: bool = False):
    """返回已刷新（续期）的 QQ Credential，带 30 分钟内存缓存。失败返回原始或 None。"""
    now = time.time()
    if not force and _qq_cred_cache["cred"] and (now - _qq_cred_cache["ts"]) < _QQ_CRED_TTL:
        return _qq_cred_cache["cred"]
    credential = _load_qq_credential_from_cookie()
    if credential is None:
        return None
    try:
        client = Client(credential=credential, device_path=QQ_DEVICE)
        refreshed = await client.login.refresh_credential(credential)
        if refreshed and getattr(refreshed, "musickey", ""):
            credential = refreshed
    except Exception:
        pass  # 刷新失败则用原始凭证（至少标准音质可用）
    _qq_cred_cache["cred"] = credential
    _qq_cred_cache["ts"] = now
    return credential


def qq_client_with_cred(credential):
    return Client(credential=credential, device_path=QQ_DEVICE) if credential else Client(device_path=QQ_DEVICE)


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

ALLOWED_ORIGINS = [x.strip() for x in os.environ.get("ALLOWED_ORIGINS", "").split(",") if x.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# ===== 整页播放器(/app) 扩展：双源浏览代理 + SQLite 库 =====
from player_ext import (
    router as player_router,
    init_db as _player_init_db,
    begin_request_source,
    end_request_source,
    current_ncm_url,
)
from player_features import router as features_router
from player_together import router as together_router
_player_init_db()
app.include_router(player_router)
app.include_router(features_router)
app.include_router(together_router)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    source_token = begin_request_source(request)
    try:
        response = await call_next(request)
    finally:
        end_request_source(source_token)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    return response


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return {"status": "ok"}


@app.get("/readyz", include_in_schema=False)
async def readyz():
    from player_ext import _conn
    try:
        with _conn() as c:
            c.execute("SELECT 1").fetchone()
        return {"status": "ready"}
    except Exception:
        raise HTTPException(status_code=503, detail="database unavailable")

# ===== 管理员认证系统 =====
# 密码以 SHA-256(salt + password) 存储，绝不存明文
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "root")
ADMIN_SALT = os.environ.get("ADMIN_SALT", "")
ADMIN_HASH = os.environ.get("ADMIN_HASH", "")

# 内存中的有效 session，格式: {token: expiry_timestamp}
admin_sessions: dict[str, float] = {}
SESSION_EXPIRY = 3600 * 24  # 24小时过期

def verify_password(password: str) -> bool:
    """管理员密码由环境变量提供；未配置时拒绝登录。"""
    if not ADMIN_SALT or not ADMIN_HASH:
        return False
    input_hash = hashlib.sha256((ADMIN_SALT + password).encode()).hexdigest()
    return hmac.compare_digest(input_hash, ADMIN_HASH)

def create_session() -> str:
    """创建新的管理员 session"""
    token = secrets.token_hex(32)
    admin_sessions[token] = time.time() + SESSION_EXPIRY
    return token

def verify_session(token: str | None) -> bool:
    """验证 session token 是否有效"""
    if not token or token not in admin_sessions:
        return False
    if time.time() > admin_sessions[token]:
        admin_sessions.pop(token, None)
        return False
    return True

def cleanup_sessions():
    """清理过期 session"""
    now = time.time()
    expired = [k for k, v in admin_sessions.items() if now > v]
    for k in expired:
        del admin_sessions[k]

# ===== 可选域名拆分：播放器与下载站可使用不同域名 =====
# PLAYER_HOSTS 为空时，根路径展示下载页；/music 始终展示播放器。
# 反代侧应传递 Host 或 X-Forwarded-Host。
PLAYER_HOSTS = {
    h.strip().lower()
    for h in os.environ.get("PLAYER_HOSTS", "").split(",")
    if h.strip()
}
DOWNLOAD_URL = os.environ.get("DOWNLOAD_URL", "/")
PLAYER_URL = os.environ.get("PLAYER_URL", "/music")

def _request_host(request: Request) -> str:
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    return host.split(",")[0].strip().split(":")[0].lower()

def is_player_host(request: Request) -> bool:
    return _request_host(request) in PLAYER_HOSTS

def _no_cache_html(response: Response, path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return content

@app.get("/", response_class=HTMLResponse)
async def read_index(request: Request, response: Response):
    if is_player_host(request):
        return _no_cache_html(response, "static/app.html")
    return _no_cache_html(response, "static/index.html")

@app.get("/music", response_class=HTMLResponse)
async def read_music(response: Response):
    return _no_cache_html(response, "static/app.html")

# 站内互跳（前端统一用这两个入口，域名怎么配前端都不用改）：
# /go/download —— 播放器里的「去下载歌曲」
# /go/player  —— 下载页的「在线播放器」按钮
@app.get("/go/download")
async def go_download(request: Request):
    from fastapi.responses import RedirectResponse
    if is_player_host(request):
        return RedirectResponse(url=DOWNLOAD_URL, status_code=302)
    return RedirectResponse(url="/", status_code=302)

@app.get("/go/player")
async def go_player(request: Request):
    from fastapi.responses import RedirectResponse
    if is_player_host(request):
        return RedirectResponse(url="/", status_code=302)
    # 公网下载域名跳到独立播放器域名；LAN/直连保持同源 /music
    if _request_host(request) == _request_host_of(DOWNLOAD_URL):
        return RedirectResponse(url=PLAYER_URL, status_code=302)
    return RedirectResponse(url="/music", status_code=302)

def _request_host_of(url: str) -> str:
    from urllib.parse import urlparse
    return (urlparse(url).hostname or "").lower()

# 旧路径 /app 重定向到 /music（兼容旧书签）
@app.get("/app")
async def read_app_redirect():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/music", status_code=307)

# 站点图标（浏览器默认会请求 /favicon.ico）
@app.get("/favicon.ico")
async def favicon():
    from fastapi.responses import FileResponse
    return FileResponse("static/anon1.jpg", media_type="image/jpeg")

# PWA Service Worker —— 必须由根路径提供，且带 Service-Worker-Allowed 头，
# 否则作用域会被限制在 /static/ 下，无法接管 /music 与整站导航。
@app.get("/service-worker.js")
async def service_worker():
    from fastapi.responses import FileResponse
    return FileResponse(
        "static/service-worker.js",
        media_type="application/javascript",
        headers={
            "Service-Worker-Allowed": "/",
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )

# PWA manifest（放根路径，方便引用；图标/start_url 用绝对路径，适配多层反代）
@app.get("/manifest.webmanifest")
async def web_manifest():
    from fastapi.responses import FileResponse
    return FileResponse("static/manifest.webmanifest", media_type="application/manifest+json")


@app.get("/api/netease/{endpoint:path}")
async def netease_passthrough(request: Request, endpoint: str):
    """为播放器旧接口提供同源代理；真实上游由当前登录用户的音源设置决定。"""
    import httpx
    from player_ext import current_ncm_url
    allowed = {
        "playlist/track/all", "song/detail",
    }
    if endpoint not in allowed:
        raise HTTPException(status_code=404, detail="unsupported endpoint")
    params = dict(request.query_params)
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        upstream = await client.get(current_ncm_url(endpoint), params=params)
    content_type = upstream.headers.get("content-type", "")
    if upstream.status_code != 200 or "json" not in content_type.lower():
        raise HTTPException(status_code=502, detail="music source unavailable")
    try:
        payload = upstream.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="invalid music source response")
    return JSONResponse(payload, status_code=200)

@app.get("/api/search")
async def search_song(keyword: str, page: int = Query(1, ge=1, le=1000), limit: int = Query(20, ge=1, le=100)):
    import httpx
    client = Client(device_path=QQ_DEVICE)
    from qqmusic_api.modules.search import SearchType

    qq_data = []
    total = 0
    try:
        resp = await client.search.search_by_type(keyword, search_type=SearchType.SONG, num=limit, page=page)
        raw_song = resp.song if resp.song is not None else []
        song_list = raw_song if isinstance(raw_song, list) else (getattr(raw_song, "items", []) or [])
        for s in song_list:
            artists = getattr(s, "singer", []) or []
            artist_name = ", ".join([getattr(a, "name", "") for a in artists])
            album_mid = getattr(getattr(s, "album", None), "mid", "") or ""
            if album_mid:
                pic = f"https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg"
            else:
                singer_mid = getattr(artists[0], "mid", "") if artists else ""
                pic = f"https://y.gtimg.cn/music/photo_new/T001R300x300M000{singer_mid}.jpg" if singer_mid else ""
            mid = getattr(s, "mid", "") or ""
            qq_data.append({
                "name": getattr(s, "name", ""),
                "artist": artist_name,
                "id_qq": mid,
                "pic": pic,
                "sources": ["qq"]
            })
        total = getattr(resp, "total_num", 0)
    except Exception:
        pass

    netease_data = []
    netease_total = 0
    try:
        offset = (page - 1) * limit
        async with httpx.AsyncClient(timeout=5) as http_client:
            res = await http_client.get(current_ncm_url("/cloudsearch"), params={"keywords": keyword, "limit": limit, "offset": offset})
            if res.status_code == 200:
                res_json = res.json()
                if res_json.get("code") == 200:
                    songs = res_json.get("result", {}).get("songs", [])
                    netease_total = res_json.get("result", {}).get("songCount", 0)
                    for s in songs:
                        artist_name = ", ".join([a.get("name", "") for a in s.get("ar", [])])
                        pic = s.get("al", {}).get("picUrl", "")
                        if not pic or "5639395138885805" in pic:
                            pic = ""
                        netease_data.append({
                            "name": s.get("name", ""),
                            "artist": artist_name,
                            "id_netease": str(s.get("id", "")),
                            "pic": pic,
                            "sources": ["netease"]
                        })
    except Exception:
        pass

    # Merge Logic
    merged_data = []
    qq_map = {}
    for item in qq_data:
        key = f'{item["name"].lower().strip()}-{item["artist"].lower().strip()}'
        qq_map[key] = item
        merged_data.append(item)

    for item in netease_data:
        key = f'{item["name"].lower().strip()}-{item["artist"].lower().strip()}'
        if key in qq_map:
            qq_map[key]["sources"].append("netease")
            qq_map[key]["id_netease"] = item["id_netease"]
            if not qq_map[key]["pic"] and item["pic"]:
                qq_map[key]["pic"] = item["pic"]
        else:
            merged_data.append(item)

    for item in merged_data:
        comp = []
        if "id_qq" in item: comp.append(f"qq:{item['id_qq']}")
        if "id_netease" in item: comp.append(f"netease:{item['id_netease']}")
        item["id"] = "|".join(comp)

    return {"code": 0, "data": merged_data, "total": max(total, netease_total), "page": page, "limit": limit}

@app.get("/api/song_url")
async def get_song_url(mid: str, quality: str = "standard"):
    import httpx
    ids = mid.split("|")
    id_qq = next((x.split(":")[1] for x in ids if x.startswith("qq:")), None)
    id_netease = next((x.split(":")[1] for x in ids if x.startswith("netease:")), None)

    if id_qq:
        # 使用刷新（续期）后的共享凭证，使无损/高音质可用（与 astrbot 同源）
        credential = await get_qq_credential()
        client = qq_client_with_cred(credential)

        # 音质从高到低，按请求档位开始逐级兜底（无 VIP/无损不可用时自动降级，避免直接报错）
        quality_order = ["master", "flac", "hq", "standard"]
        quality_map = {
            "master": SongFileType.MASTER,
            "flac": SongFileType.FLAC,
            "hq": SongFileType.MP3_320,
            "standard": SongFileType.MP3_128
        }
        start = quality_order.index(quality) if quality in quality_order else quality_order.index("standard")
        try_qualities = quality_order[start:]

        try:
            cdn_host = "https://isure.stream.qqmusic.qq.com/"
            try:
                cdn_resp = await client.song.get_cdn_dispatch()
                if cdn_resp.sip:
                    raw_host = cdn_resp.sip[0] if isinstance(cdn_resp.sip, list) else str(cdn_resp.sip)
                    if not raw_host.endswith("/"):
                        raw_host += "/"
                    if raw_host.startswith("https://"):
                        cdn_host = raw_host
            except:
                pass

            import urllib.parse
            for q in try_qualities:
                ft = quality_map[q]
                try:
                    url_resp = await client.song.get_song_urls([SongFileInfo(mid=id_qq, file_type=ft)])
                except Exception:
                    continue
                for item in url_resp.data:
                    purl = getattr(item, "purl", "") or ""
                    if purl:
                        final_url = cdn_host + purl
                        if final_url.startswith("http://"):
                            final_url = final_url.replace("http://", "https://", 1)
                        # 直接返回官方 CDN 直链，让浏览器/客户端直连 QQ 音乐 CDN，音频流量不经过本服务器。
                        # 实测 QQ 的 vkey 直链：不绑请求方 IP、支持 Range(206)、CORS 全开(Allow-Origin *)、https 正常，
                        # 故无需服务器代理。/api/proxy_stream 仍保留，前端在直连失败时会自动回退到它兜底。
                        return {"code": 0, "url": final_url, "quality": q}
        except Exception:
            pass

    if id_netease:
        # 网易云：同样逐级兜底
        n_order = ["master", "flac", "hq", "standard"]
        n_quality_map = {
            "master": "jymaster",
            "flac": "lossless",
            "hq": "exhigh",
            "standard": "standard"
        }
        n_start = n_order.index(quality) if quality in n_order else n_order.index("standard")
        try:
            async with httpx.AsyncClient(timeout=10) as http_client:
                for q in n_order[n_start:]:
                    n_level = n_quality_map[q]
                    res = await http_client.get(current_ncm_url("/song/url/v1"), params={"id": id_netease, "level": n_level})
                    if res.status_code == 200:
                        r_data = res.json().get("data", [])
                        if r_data and r_data[0].get("url"):
                            n_url = r_data[0]["url"]
                            if n_url.startswith("http://"):
                                n_url = n_url.replace("http://", "https://", 1)
                            return {"code": 0, "url": n_url, "quality": q}
        except Exception:
            pass

    return {"code": -1, "msg": "获取链接失败（如果是高音质可能需要绿钻或者Cookie失效，且多渠道兜底均失败）"}


def _strip_em(t):
    """去掉 QQ 搜索结果里的 <em> 高亮标签"""
    import re as _re
    return _re.sub(r"</?em>", "", t or "")


@app.get("/api/search/split")
async def search_split(keyword: str, page: int = Query(1, ge=1, le=1000), limit: int = Query(30, ge=1, le=100)):
    """双列搜索（歌曲）：QQ / 网易云分开返回，条目为播放器歌曲格式（id 带 qq:/netease: 前缀）"""
    import httpx
    client = Client(device_path=QQ_DEVICE)
    from qqmusic_api.modules.search import SearchType

    qq_songs = []
    try:
        resp = await client.search.search_by_type(keyword, search_type=SearchType.SONG, num=limit, page=page)
        raw_song = resp.song if resp.song is not None else []
        song_list = raw_song if isinstance(raw_song, list) else (getattr(raw_song, "items", []) or [])
        for s in song_list:
            mid = getattr(s, "mid", "") or ""
            if not mid:
                continue
            artists = getattr(s, "singer", []) or []
            artist_name = ", ".join([getattr(a, "name", "") for a in artists])
            album_obj = getattr(s, "album", None)
            album_mid = getattr(album_obj, "mid", "") or ""
            album_name = getattr(album_obj, "name", "") or ""
            if album_mid:
                pic = f"https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg"
            else:
                singer_mid = getattr(artists[0], "mid", "") if artists else ""
                pic = f"https://y.gtimg.cn/music/photo_new/T001R300x300M000{singer_mid}.jpg" if singer_mid else ""
            qq_songs.append({
                "id": f"qq:{mid}",
                "name": _strip_em(getattr(s, "name", "")),
                "artist": artist_name,
                "artists": [{"id": f"qq:{getattr(a, 'mid', '')}", "name": getattr(a, "name", "")}
                            for a in artists if getattr(a, "mid", "") and getattr(a, "name", "")],
                "pic": pic,
                "album": album_name,
                "duration": getattr(s, "interval", 0) or 0,
                "sources": ["qq"],
            })
    except Exception:
        pass

    netease_songs = []
    try:
        offset = (page - 1) * limit
        async with httpx.AsyncClient(timeout=8) as http_client:
            res = await http_client.get(current_ncm_url("/cloudsearch"),
                                        params={"keywords": keyword, "limit": limit, "offset": offset})
            if res.status_code == 200:
                rj = res.json()
                if rj.get("code") == 200:
                    for s in rj.get("result", {}).get("songs", []) or []:
                        pic = (s.get("al", {}) or {}).get("picUrl", "") or ""
                        if "5639395138885805" in pic:
                            pic = ""
                        netease_songs.append({
                            "id": f"netease:{s.get('id', '')}",
                            "name": s.get("name", ""),
                            "artist": ", ".join([a.get("name", "") for a in s.get("ar", []) or []]),
                            "artists": [{"id": f"netease:{a.get('id')}", "name": a.get("name", "")}
                                        for a in (s.get("ar", []) or []) if a.get("id") and a.get("name")],
                            "pic": pic,
                            "album": (s.get("al", {}) or {}).get("name", ""),
                            "duration": int((s.get("dt", 0) or 0) / 1000),
                            "sources": ["netease"],
                        })
    except Exception:
        pass
    return {"code": 0, "qq": qq_songs, "netease": netease_songs}


@app.get("/api/search/playlists")
async def search_playlists(keyword: str, page: int = Query(1, ge=1, le=1000), limit: int = Query(30, ge=1, le=100)):
    """双列搜索（歌单）：QQ / 网易云分开返回，条目可直接喂给前端 card()（cover/songCount/creator/playCount）"""
    import httpx
    client = Client(device_path=QQ_DEVICE)
    from qqmusic_api.modules.search import SearchType

    qq_pls = []
    try:
        resp = await client.search.search_by_type(keyword, search_type=SearchType.SONGLIST, num=limit, page=page)
        raw = getattr(resp, "songlist", None) or []
        items = raw if isinstance(raw, list) else (getattr(raw, "items", []) or [])
        for it in items:
            pid = getattr(it, "id", 0)
            if not pid:
                continue
            qq_pls.append({
                "source": "qq",
                "id": str(pid),
                "name": _strip_em(getattr(it, "title", "")),
                "cover": (getattr(it, "picurl", "") or "").replace("http://", "https://", 1),
                "songCount": getattr(it, "songnum", 0) or 0,
                "creator": getattr(it, "nickname", "") or "",
                "playCount": getattr(it, "listennum", 0) or 0,
            })
    except Exception:
        pass

    netease_pls = []
    try:
        offset = (page - 1) * limit
        async with httpx.AsyncClient(timeout=8) as http_client:
            res = await http_client.get(current_ncm_url("/cloudsearch"),
                                        params={"keywords": keyword, "type": 1000, "limit": limit, "offset": offset})
            if res.status_code == 200:
                rj = res.json()
                if rj.get("code") == 200:
                    for p in rj.get("result", {}).get("playlists", []) or []:
                        netease_pls.append({
                            "source": "netease",
                            "id": str(p.get("id", "")),
                            "name": p.get("name", ""),
                            "cover": (p.get("coverImgUrl", "") or "").replace("http://", "https://", 1),
                            "songCount": p.get("trackCount", 0) or 0,
                            "creator": ((p.get("creator", {}) or {}).get("nickname", "")) or "",
                            "playCount": p.get("playCount", 0) or 0,
                        })
    except Exception:
        pass
    return {"code": 0, "qq": qq_pls, "netease": netease_pls}


@app.get("/api/lyric")
async def get_lyric(mid: str):
    import httpx
    ids = mid.split("|")
    id_qq = next((x.split(":")[1] for x in ids if x.startswith("qq:")), None)
    id_netease = next((x.split(":")[1] for x in ids if x.startswith("netease:")), None)

    if id_qq:
        # 复用刷新后的共享凭证（QRC 逐字歌词需登录态）
        credential = await get_qq_credential()
        client = qq_client_with_cred(credential)
        try:
            resp = await client.lyric.get_lyric(id_qq, trans=True, qrc=True)
            # QQMusicApi >= 0.6.8 已在响应模型中自动解密；旧版仍需调用 decrypt()。
            lyric_data = resp.decrypt() if hasattr(resp, "decrypt") else resp

            qrc_content = ""
            if lyric_data.lyric and "<?xml" in lyric_data.lyric:
                import xml.etree.ElementTree as ET
                try:
                    root = ET.fromstring(lyric_data.lyric)
                    lyric_node = root.find(".//Lyric_1")
                    qrc_content = lyric_node.attrib.get("LyricContent", "") if lyric_node is not None else ""
                except Exception:
                    pass

            if not qrc_content:
                resp_lrc = await client.lyric.get_lyric(id_qq, trans=True, qrc=False)
                lrc_data = resp_lrc.decrypt() if hasattr(resp_lrc, "decrypt") else resp_lrc
                if lrc_data.lyric:
                    return {"code": 0, "lyric": lrc_data.lyric, "tlyric": lrc_data.trans, "qrc": ""}

            if qrc_content or lyric_data.trans:
                return {"code": 0, "lyric": qrc_content, "tlyric": lyric_data.trans, "qrc": qrc_content}
        except Exception:
            pass

    if id_netease:
        try:
            async with httpx.AsyncClient(timeout=10) as http_client:
                # /lyric/new 带逐字歌词 yrc（网易云逐字）
                res = await http_client.get(current_ncm_url("/lyric/new"), params={"id": id_netease})
                if res.status_code == 200:
                    r_data = res.json()
                    lrc = (r_data.get("lrc") or {}).get("lyric", "")
                    tlyric = (r_data.get("tlyric") or {}).get("lyric", "")
                    yrc = (r_data.get("yrc") or {}).get("lyric", "")
                    ytlrc = (r_data.get("ytlrc") or {}).get("lyric", "")
                    if lrc or yrc:
                        return {"code": 0, "lyric": lrc, "tlyric": ytlrc or tlyric, "qrc": "", "yrc": yrc}
        except Exception:
            pass

    return {"code": -1, "msg": "获取歌词失败"}

# ===== 管理员登录/登出 API =====
from pydantic import BaseModel

class AdminLoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/admin/login")
async def admin_login(req: AdminLoginRequest):
    cleanup_sessions()
    if req.username != ADMIN_USERNAME or not verify_password(req.password):
        return JSONResponse({"code": -1, "msg": "用户名或密码错误"}, status_code=401)
    token = create_session()
    response = JSONResponse({"code": 0, "msg": "登录成功"})
    response.set_cookie(
        key="admin_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        max_age=SESSION_EXPIRY,
    )
    return response

@app.post("/api/admin/logout")
async def admin_logout(request: Request):
    token = request.cookies.get("admin_token")
    if token:
        admin_sessions.pop(token, None)
    response = JSONResponse({"code": 0, "msg": "已登出"})
    response.delete_cookie("admin_token")
    return response

@app.get("/api/admin/status")
async def admin_status(request: Request):
    token = request.cookies.get("admin_token")
    if verify_session(token):
        return {"code": 0, "msg": "已认证"}
    return {"code": -1, "msg": "未认证"}

import qrcode
import io
import base64
@app.get("/api/login/qrcode")
async def get_login_qrcode(request: Request):
    # 需要管理员认证
    token = request.cookies.get("admin_token")
    if not verify_session(token):
        return JSONResponse({"code": -1, "msg": "需要管理员认证"}, status_code=403)
    client = Client(device_path=QQ_DEVICE)
    from qqmusic_api.modules.login import QRLoginType
    import base64
    try:
        qr = await client.login.get_qrcode(QRLoginType.QQ)
        img_str = base64.b64encode(qr.data).decode()
        return {"code": 0, "qrsig": qr.identifier, "image": "data:image/png;base64," + img_str}
    except Exception as e:
        return {"code": -1, "msg": str(e)}

@app.get("/api/login/status")
async def get_login_status(qrsig: str, request: Request):
    # 需要管理员认证
    token = request.cookies.get("admin_token")
    if not verify_session(token):
        return JSONResponse({"code": -1, "msg": "需要管理员认证"}, status_code=403)
    client = Client(device_path=QQ_DEVICE)
    from qqmusic_api.models.login import QR
    from qqmusic_api.modules.login import QRLoginType
    try:
        qr_obj = QR(data=b'', qr_type=QRLoginType.QQ, mimetype='image/png', identifier=qrsig)
        status = await client.login.check_qrcode(qr_obj)
        if status.done:
            cred = status.credential
            import json, os
            cookie_path = QQ_CREDENTIAL_PATH

            cfg = {}
            if os.path.exists(cookie_path):
                try:
                    with open(cookie_path, "r", encoding="utf-8-sig") as f:
                        cfg = json.load(f)
                except:
                    pass

            cred_dict = {
                "musicid": cred.musicid,
                "str_musicid": cred.str_musicid,
                "musickey": cred.musickey,
                "encryptUin": getattr(cred, "encryptUin", ""),
                "loginType": cred.loginType,
                "openid": getattr(cred, "openid", ""),
                "access_token": getattr(cred, "access_token", ""),
                "unionid": getattr(cred, "unionid", "")
            }

            cfg["tencent_cookie"] = json.dumps(cred_dict, ensure_ascii=False)
            cfg["_tencent_auto_musickey"] = cred.musickey

            with open(cookie_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)

            return {"code": 0, "msg": "登录成功！Cookie已保存"}

        frontend_code = 1
        if status.event.name == "TIMEOUT":
            frontend_code = 2
        elif status.event.name in ["SCAN", "CONF"]:
            frontend_code = 3
        elif status.event.name == "REFUSE":
            frontend_code = 2

        return {"code": frontend_code, "msg": "等待扫码"}
    except Exception as e:
        return {"code": -1, "msg": str(e)}

@app.get("/api/user/status")
async def get_user_status_api():
    cookie_path = QQ_CREDENTIAL_PATH
    import os, json, datetime
    if not os.path.exists(cookie_path):
        return {"code": -1, "msg": "未登录"}
    try:
        with open(cookie_path, "r", encoding="utf-8-sig") as f:
            cfg = json.load(f)
            tencent_cookie = cfg.get("tencent_cookie", "").strip().lstrip("\ufeff")
            auto_musickey = cfg.get("_tencent_auto_musickey", "")
            if not tencent_cookie:
                return {"code": -1, "msg": "未登录"}

            if tencent_cookie.startswith("{"):
                cred_dict = json.loads(tencent_cookie)
            else:
                return {"code": -1, "msg": "旧版Cookie无法验证"}

            if auto_musickey:
                cred_dict["musickey"] = auto_musickey
            credential = Credential.model_validate(cred_dict)
            client = Client(credential=credential, device_path=QQ_DEVICE)

            # 基础头像
            avatar = "https://y.qq.com/mediastyle/global/img/person_300.png"
            if str(credential.musicid).isdigit() and len(str(credential.musicid)) >= 5:
                avatar = f"https://q.qlogo.cn/headimg_dl?dst_uin={credential.musicid}&spec=100"

            nickname = ""
            vip_type = ""
            is_vip = False
            vip_expire = 0
            music_level = 0
            score = 0

            # 一次性原始API请求获取 VIP + 昵称
            try:
                from niquests import AsyncSession
                combined_payload = {
                    "comm": {
                        "ct": 11, "cv": 12080008, "v": 12080008,
                        "tmeAppID": "qqmusic",
                        "uin": str(credential.musicid),
                        "authst": credential.musickey,
                    },
                    "req_0": {
                        "module": "VipLogin.VipLoginInter",
                        "method": "vip_login_base",
                        "param": {}
                    },
                    "req_1": {
                        "module": "music.UnifiedHomepage.UnifiedHomepageSrv",
                        "method": "GetHomepageHeader",
                        "param": {"uin": str(credential.musicid), "IsQueryTabDetail": 1}
                    }
                }
                async with AsyncSession(timeout=15) as http_client:
                    resp = await http_client.post(
                        "https://u.y.qq.com/cgi-bin/musicu.fcg",
                        json=combined_payload
                    )
                    raw_json = resp.json()

                raw_data = raw_json.get("req_0", {}).get("data", {})

                # 提取基础信息
                userinfo = raw_data.get("userinfo", {})
                score = userinfo.get("score", 0)
                music_level = userinfo.get("music_level", 0)

                # identity 包含完整VIP信息
                identity = raw_data.get("identity", {})
                svip_flag = raw_data.get("svip", 0)
                huge_vip = identity.get("HugeVip", 0)  # 豪华绿钻
                lm_flag = identity.get("LMFlag", 0)    # 绿钻
                vip_flag = identity.get("vip", 0)       # 基础VIP
                vip_level = identity.get("level", 0)    # VIP等级

                # 到期时间
                huge_vip_end = identity.get("HugeVipEnd", "")   # "2026-10-14 23:46:34"
                lm_end = identity.get("LMEnd", "")
                overdate = identity.get("overdate", "")
                vip_icon = identity.get("icon", "")

                # VIP 等级图标
                vec_icons = userinfo.get("vecIcon", [])
                if vec_icons and isinstance(vec_icons, list):
                    for ic in vec_icons:
                        if isinstance(ic, dict) and ic.get("pic"):
                            vip_icon = ic["pic"]
                            break

                # 构建 VIP 类型列表
                vip_types = []
                if svip_flag:
                    vip_types.append("超级会员")
                if huge_vip:
                    vip_types.append("豪华绿钻")
                elif lm_flag:
                    vip_types.append("绿钻VIP")

                if vip_types:
                    is_vip = True
                    vip_type = " · ".join(vip_types)
                elif vip_flag:
                    is_vip = True
                    vip_type = "VIP"

                # 解析到期时间（优先用 HugeVipEnd，其次 overdate/send）
                expire_raw = huge_vip_end or lm_end or overdate or raw_data.get("send", "")
                if expire_raw:
                    try:
                        # 格式可能是 "2026-10-14 23:46:34" 或 "2026-10-20"
                        if " " in expire_raw:
                            dt = datetime.datetime.strptime(expire_raw, "%Y-%m-%d %H:%M:%S")
                        else:
                            dt = datetime.datetime.strptime(expire_raw, "%Y-%m-%d")
                        vip_expire = int(dt.timestamp())
                    except Exception:
                        pass

                # 从 req_1 (主页) 提取昵称和头像
                homepage_data = raw_json.get("req_1", {}).get("data", {})
                info = homepage_data.get("Info", {})
                base_info = info.get("BaseInfo", {}) if isinstance(info, dict) else {}
                if isinstance(base_info, dict):
                    nick = base_info.get("Name", "")
                    if nick:
                        # 去掉可能的零宽字符
                        nickname = nick.replace("\u2060", "").strip()
                    pic = base_info.get("BigAvatar", "") or base_info.get("Avatar", "")
                    if pic:
                        avatar = pic

            except Exception as raw_err:
                # 回退到标准 API
                try:
                    vip_res = await client.user.get_vip_info()
                    vi = vip_res.userinfo
                    music_level = vi.music_level
                    score = vi.score
                    vip_expire = vi.expire
                    now_ts = int(datetime.datetime.now().timestamp())
                    if vip_expire and vip_expire > now_ts:
                        is_vip = True
                        vip_type = "VIP"
                except Exception:
                    pass

            if not nickname:
                nickname = "QQ音乐用户"

            expire_str = ""
            if vip_expire:
                expire_str = datetime.datetime.fromtimestamp(vip_expire).strftime("%Y-%m-%d")

            return {
                "code": 0,
                "msg": "已登录",
                "avatar": avatar,
                "nickname": nickname,
                "is_vip": is_vip,
                "vip_type": vip_type,
                "vip_expire": expire_str,
                "music_level": music_level,
                "score": score,
            }
    except Exception as e:
        return {"code": -1, "msg": "登录失效"}

@app.get("/login", response_class=HTMLResponse)
async def read_login(response: Response):
    with open("static/login.html", "r", encoding="utf-8") as f:
        content = f.read()
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return content

@app.get("/profile", response_class=HTMLResponse)
async def read_profile(response: Response):
    with open("static/profile.html", "r", encoding="utf-8") as f:
        content = f.read()
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return content

from fastapi.responses import StreamingResponse

@app.get("/api/song_sizes")
async def get_song_sizes(mid: str):
    import httpx, asyncio, json, os
    ids = mid.split("|")
    id_qq = next((x.split(":")[1] for x in ids if x.startswith("qq:")), None)
    id_netease = next((x.split(":")[1] for x in ids if x.startswith("netease:")), None)

    sizes = { "master": "未知", "flac": "未知", "hq": "未知", "standard": "未知" }

    if id_qq:
        client = Client(device_path=QQ_DEVICE)
        cookie_path = QQ_CREDENTIAL_PATH
        if os.path.exists(cookie_path):
            try:
                with open(cookie_path, "r", encoding="utf-8-sig") as f:
                    cfg = json.load(f)
                    tencent_cookie = cfg.get("tencent_cookie", "").strip().lstrip("\ufeff")
                    auto_musickey = cfg.get("_tencent_auto_musickey", "")
                    if tencent_cookie.startswith("{"):
                        cred_dict = json.loads(tencent_cookie)
                        if auto_musickey:
                            cred_dict["musickey"] = auto_musickey
                        credential = Credential.model_validate(cred_dict)
                        client = Client(credential=credential, device_path=QQ_DEVICE)
                    else:
                        cookie_dict = {}
                        for part in tencent_cookie.replace("\n", ";").split(";"):
                            part = part.strip()
                            if "=" in part:
                                k, _, v = part.partition("=")
                                cookie_dict[k.strip()] = v.strip()
                        musicid_str = cookie_dict.get("uin", cookie_dict.get("qqmusic_uin", "")).lstrip("o")
                        musickey = auto_musickey or cookie_dict.get("qm_keyst", cookie_dict.get("qqmusic_key", ""))
                        if musicid_str and musickey:
                            cred_data = {"musickey": musickey, "loginType": int(cookie_dict.get("tmeLoginType", "2") or "2")}
                            if musicid_str.isdigit():
                                cred_data["musicid"] = int(musicid_str)
                                cred_data["str_musicid"] = musicid_str
                            credential = Credential.model_validate(cred_data)
                            client = Client(credential=credential, device_path=QQ_DEVICE)
            except Exception:
                pass

        try:
            req_data = {
                "comm": {"cv": 4747474, "ct": 24, "format": "json", "inCharset": "utf-8", "outCharset": "utf-8", "notice": 0, "platform": "yqq.json", "needNewCode": 1, "uin": 0, "g_tk_new_20200303": 5381, "g_tk": 5381},
                "req_1": {
                    "module": "music.pf_song_detail_svr",
                    "method": "get_song_detail_yqq",
                    "param": {"song_type": 0, "song_mid": id_qq, "song_id": 0}
                }
            }
            async with httpx.AsyncClient(timeout=5) as http:
                r = await http.post("https://u.y.qq.com/cgi-bin/musicu.fcg", json=req_data)
                d = r.json()
                if "req_1" in d and "data" in d["req_1"] and "track_info" in d["req_1"]["data"]:
                    sf = d["req_1"]["data"]["track_info"].get("file", {})
                    def fmt(sz): return f"{sz/1024/1024:.1f} MB" if sz else "未知"
                    sizes["master"] = fmt(sf.get("size_new", [0])[0] if sf.get("size_new") else 0)
                    sizes["flac"] = fmt(sf.get("size_flac", 0))
                    sizes["hq"] = fmt(sf.get("size_320mp3", 0))
                    sizes["standard"] = fmt(sf.get("size_128mp3", 0))
        except Exception as e:
            import traceback
            traceback.print_exc()

    if id_netease:
        try:
            async with httpx.AsyncClient(timeout=5) as http:
                r = await http.get(current_ncm_url("/song/detail"), params={"ids": id_netease})
                if r.status_code == 200:
                    d = r.json()
                    if d.get("songs"):
                        s = d["songs"][0]
                        def fmt(sz): return f"{sz/1024/1024:.1f} MB" if sz else "未知"
                        sizes["master"] = fmt(s.get("hr", {}).get("size")) if s.get("hr") else "未知"
                        sizes["flac"] = fmt(s.get("sq", {}).get("size")) if s.get("sq") else "未知"
                        sizes["hq"] = fmt(s.get("h", {}).get("size")) if s.get("h") else "未知"
                        l_size = s.get("l", {}).get("size")
                        m_size = s.get("m", {}).get("size")
                        sizes["standard"] = fmt(l_size) if l_size else (fmt(m_size) if m_size else "未知")
        except Exception:
            pass

    return {"code": 0, "sizes": sizes}

@app.get("/api/proxy_stream")
async def proxy_stream(request: Request, url: str):
    import httpx
    from fastapi.responses import StreamingResponse
    from starlette.background import BackgroundTask

    headers = {}
    range_header = request.headers.get("Range")
    if range_header:
        headers["Range"] = range_header

    from player_ext import validate_proxy_url, AUDIO_PROXY_HOSTS
    if not validate_proxy_url(url, AUDIO_PROXY_HOSTS):
        raise HTTPException(status_code=400, detail="bad url")
    client = httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10))
    req = client.build_request("GET", url, headers=headers)

    try:
        r = await client.send(req, stream=True)
    except Exception as e:
        await client.aclose()
        raise HTTPException(status_code=502, detail="upstream unavailable")

    resp_headers = {}
    for k, v in r.headers.items():
        if k.lower() in ("content-type", "content-length", "content-range", "accept-ranges"):
            resp_headers[k] = v

    async def cleanup():
        await r.aclose()
        await client.aclose()

    return StreamingResponse(
        r.aiter_bytes(chunk_size=8192),
        status_code=r.status_code,
        headers=resp_headers,
        media_type=r.headers.get("content-type", "audio/mpeg"),
        background=BackgroundTask(cleanup)
    )

@app.get("/api/download")
async def proxy_download(url: str, filename: str = "song.mp3"):
    import httpx
    from player_ext import validate_proxy_url, AUDIO_PROXY_HOSTS
    if not validate_proxy_url(url, AUDIO_PROXY_HOSTS):
        raise HTTPException(status_code=400, detail="bad url")
    async def stream():
        async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10)) as client:
            async with client.stream("GET", url) as response:
                async for chunk in response.aiter_bytes(chunk_size=8192):
                    yield chunk

    from urllib.parse import quote
    encoded_name = quote(filename)
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"
    }
    return StreamingResponse(stream(), headers=headers)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
