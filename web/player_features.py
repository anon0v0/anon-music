"""P5 功能扩展：歌手页 / 每日推荐 / 私人FM / 听歌统计。

独立 APIRouter，main.py include_router 挂载。复用 player_ext 的 QQ client、
网易 :3003 代理、norm 归一化与 SQLite 助手。

推荐没有上游账号（网易 /recommend/songs 需登录），用「用户收藏∪最近播放」做种子：
网易种子走 /simi/song，QQ 种子先转数字 id 再 song.get_similar_song，归一去重后
剔除已听，按天缓存（daily_recs 表）。私人FM 是同一管线的滚动版（内存已发集合）。
"""
import json
import time
import random
import asyncio

from fastapi import APIRouter, Body, Request

from player_ext import (
    qq_client, _dump, norm_qq_song, norm_ncm_song, ncm_get,
    _conn, _db_lock, current_uid, _qq_numeric_id,
)

router = APIRouter()


# ============================ 歌手页 ============================
def _find_desc(obj, depth=0):
    """在嵌套结构里找第一个非空 desc/introduction 文本（QQ get_desc 的结构版本间会变，做宽松提取）。"""
    if depth > 5:
        return ""
    if isinstance(obj, dict):
        for k in ("desc", "introduction", "brief"):
            v = obj.get(k)
            if isinstance(v, str) and len(v) > 10:
                return v
        for v in obj.values():
            r = _find_desc(v, depth + 1)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_desc(v, depth + 1)
            if r:
                return r
    return ""


@router.get("/api/artist/detail")
async def artist_detail(source: str, id: str):
    """歌手主页：头像/背景/简介 + 热门歌曲。qq 的 id=singer mid；netease 的 id=数字 id"""
    try:
        if source == "qq":
            # 注意：qqmusic_api 的接口返回自定义 awaitable(不可哈希)，进 asyncio.gather 会炸
            # ("unhashable type: 'Request'")，只能顺序 await。
            c = qq_client()
            try:
                info = _dump(await c.singer.get_info(id))
            except Exception:
                info = {}
            try:
                songs = _dump(await c.singer.get_songs_list(id, num=50, page=1))
            except Exception:
                songs = {}
            base = info.get("base_info") or {}
            singer = info.get("singer") or {}
            desc = ""
            try:
                desc = _find_desc(_dump(await c.singer.get_desc([id])))
            except Exception:
                pass
            hot = [norm_qq_song(s) for s in (songs.get("song_list") or [])]
            return {"code": 0, "data": {
                "id": f"qq:{id}", "source": "qq",
                "name": base.get("name") or singer.get("name") or "",
                "pic": base.get("avatar") or "",
                "bg": base.get("background_image") or "",
                "desc": desc,
                "song_total": int(songs.get("total_num") or len(hot)),
                "hot_songs": hot,
            }}
        else:
            d1, d2 = await asyncio.gather(
                ncm_get("/artists", {"id": id}),           # 含 artist + hotSongs(50)
                ncm_get("/artist/detail", {"id": id}),     # 简介/身份
                return_exceptions=True)
            d1 = d1 if isinstance(d1, dict) else {}
            d2 = d2 if isinstance(d2, dict) else {}
            art = d1.get("artist") or {}
            art2 = ((d2.get("data") or {}).get("artist") or {})
            return {"code": 0, "data": {
                "id": f"netease:{id}", "source": "netease",
                "name": art.get("name") or art2.get("name") or "",
                "pic": art.get("picUrl") or art2.get("cover") or "",
                "bg": art.get("picUrl") or "",
                "desc": art.get("briefDesc") or art2.get("briefDesc") or "",
                "song_total": int(art.get("musicSize") or 0),
                "hot_songs": [norm_ncm_song(s) for s in (d1.get("hotSongs") or [])[:50]],
            }}
    except Exception as e:
        return {"code": -1, "msg": str(e)}


@router.get("/api/artist/songs")
async def artist_songs(source: str, id: str, page: int = 1, num: int = 50):
    try:
        if source == "qq":
            r = _dump(await qq_client().singer.get_songs_list(id, num=num, page=page))
            return {"code": 0, "data": [norm_qq_song(s) for s in (r.get("song_list") or [])],
                    "total": int(r.get("total_num") or 0)}
        r = await ncm_get("/artist/songs", {"id": id, "limit": num, "offset": (page - 1) * num})
        return {"code": 0, "data": [norm_ncm_song(s) for s in (r.get("songs") or [])],
                "total": int(r.get("total") or 0)}
    except Exception as e:
        return {"code": -1, "msg": str(e)}


@router.get("/api/artist/albums")
async def artist_albums(source: str, id: str, page: int = 1, num: int = 30):
    """专辑卡：归一为 card() 可直接吃的 {source,id,name,cover,songCount,creator}"""
    try:
        if source == "qq":
            r = _dump(await qq_client().singer.get_album_list(id, num=num, page=page))
            out = []
            for a in (r.get("album_list") or []):
                amid = a.get("mid") or ""
                out.append({
                    "source": "qq", "id": amid,
                    "name": a.get("name", ""),
                    "cover": f"https://y.gtimg.cn/music/photo_new/T002R300x300M000{amid}.jpg" if amid else "",
                    "creator": a.get("time_public", "") or a.get("album_type", ""),
                    "songCount": int(a.get("total_num") or 0) or None,
                })
            return {"code": 0, "data": out, "total": int(r.get("total") or 0)}
        r = await ncm_get("/artist/album", {"id": id, "limit": num, "offset": (page - 1) * num})
        out = []
        for a in (r.get("hotAlbums") or []):
            out.append({
                "source": "netease", "id": a.get("id"),
                "name": a.get("name", ""),
                "cover": a.get("picUrl", ""),
                "creator": (a.get("publishTime") and time.strftime("%Y-%m-%d", time.localtime(a["publishTime"] / 1000))) or "",
                "songCount": int(a.get("size") or 0) or None,
            })
        return {"code": 0, "data": out, "total": int(r.get("artist", {}).get("albumSize") or 0)}
    except Exception as e:
        return {"code": -1, "msg": str(e)}


# ============================ 每日推荐 / 私人FM ============================
async def _similar_for_seed(mid: str, cap: int = 12) -> list:
    """一个种子歌曲 → 相似歌曲列表（norm 后）。失败返回 []"""
    try:
        if mid.startswith("netease:"):
            r = await ncm_get("/simi/song", {"id": mid.split(":", 1)[1]})
            return [norm_ncm_song(s) for s in (r.get("songs") or [])[:cap]]
        if mid.startswith("qq:"):
            qid = await _qq_numeric_id(mid.split(":", 1)[1])
            if not qid:
                return []
            r = _dump(await qq_client().song.get_similar_song(int(qid)))
            out = []
            for grp in (r.get("song") or []):
                for s in (_dump(grp).get("song") or []):
                    out.append(norm_qq_song(s))
                    if len(out) >= cap:
                        return out
            return out
    except Exception:
        pass
    return []


def _seed_pool(uid: int, source: str = "") -> tuple[list, set]:
    """种子池 = liked ∪ recent；exclude = recent 已听 mid 集合。source=qq|netease 时只取该源种子。"""
    with _conn() as c:
        liked = [r["mid"] for r in c.execute(
            "SELECT mid FROM liked WHERE user_id=? ORDER BY added_at DESC LIMIT 60", (uid,)).fetchall()]
        recent = [r["mid"] for r in c.execute(
            "SELECT mid FROM recent WHERE user_id=? ORDER BY played_at DESC LIMIT 60", (uid,)).fetchall()]
    pool = list(dict.fromkeys(liked + recent))   # 去重保序
    if source:
        pool = [m for m in pool if m.startswith(source + ":")]
    return pool, set(recent)


async def _fallback_recs(want: int, source: str = "") -> list:
    """冷启动/种子不足兜底：公共新歌推荐（source 为空=双源）"""
    songs = []
    if source in ("", "netease"):
        try:
            r = await ncm_get("/personalized/newsong", {"limit": min(want, 20)})
            for it in (r.get("result") or []):
                s = it.get("song") or {}
                if s:
                    songs.append(norm_ncm_song(s))
        except Exception:
            pass
    if len(songs) < want and source in ("", "qq"):
        try:
            r = _dump(await qq_client().recommend.get_recommend_newsong())
            lst = r.get("songlist") or r.get("song_list") or r.get("list") or []
            for s in lst[: want - len(songs)]:
                songs.append(norm_qq_song(_dump(s).get("song_info") or s))
        except Exception:
            pass
    return songs


async def _build_recs(uid: int, want: int = 30, exclude: set | None = None, source: str = "") -> list:
    pool, heard = _seed_pool(uid, source)
    exclude = set(exclude or set()) | heard | set(pool)
    seeds = random.sample(pool, min(10, len(pool))) if pool else []
    batches = await asyncio.gather(*[_similar_for_seed(m) for m in seeds]) if seeds else []
    out, seen = [], set()
    cand = [s for b in batches for s in b]
    random.shuffle(cand)
    for s in cand:
        sid = s.get("id") or ""
        if not sid or sid in seen or sid in exclude:
            continue
        seen.add(sid)
        out.append(s)
        if len(out) >= want:
            break
    if len(out) < min(want, 10):   # 种子太少/相似接口失效 → 兜底补齐
        for s in await _fallback_recs(want - len(out), source):
            sid = s.get("id") or ""
            if sid and sid not in seen and sid not in exclude:
                seen.add(sid)
                out.append(s)
            if len(out) >= want:
                break
    return out


@router.get("/api/recommend/daily")
async def recommend_daily(request: Request, refresh: int = 0, source: str = ""):
    """每日推荐 30 首：按 用户×自然日×音源 缓存；refresh=1 强制重算（换一批）。
    source=qq|netease 只用该源的种子和相似接口；空=混合。"""
    uid = current_uid(request)
    if source not in ("", "qq", "netease"):
        source = ""
    day = time.strftime("%Y-%m-%d") + (f":{source}" if source else "")
    if not refresh:
        with _conn() as c:
            r = c.execute("SELECT songs_json FROM daily_recs WHERE user_id=? AND day=?", (uid, day)).fetchone()
        if r:
            return {"code": 0, "data": json.loads(r["songs_json"]), "day": day, "cached": True}
    songs = await _build_recs(uid, want=30, source=source)
    with _db_lock, _conn() as c:
        c.execute("INSERT OR REPLACE INTO daily_recs(user_id,day,songs_json) VALUES(?,?,?)",
                  (uid, day, json.dumps(songs, ensure_ascii=False)))
        c.execute("DELETE FROM daily_recs WHERE day < ?", (time.strftime("%Y-%m-%d", time.localtime(time.time() - 7 * 86400)),))
    return {"code": 0, "data": songs, "day": day}


# 私人FM：per-(user,source) 已发集合（内存即可，重启丢失只影响短期重复概率）
_fm_served: dict[tuple, set] = {}


@router.get("/api/fm/next")
async def fm_next(request: Request, n: int = 5, source: str = ""):
    uid = current_uid(request)
    if source not in ("", "qq", "netease"):
        source = ""
    served = _fm_served.setdefault((uid, source), set())
    if len(served) > 400:   # 防无限膨胀：太大就重置（允许久远的歌重新出现）
        served.clear()
    songs = await _build_recs(uid, want=max(n, 5), exclude=served, source=source)
    for s in songs:
        served.add(s.get("id") or "")
    return {"code": 0, "data": songs[:n]}


# ============================ 听歌统计 ============================
@router.post("/api/stats/play")
async def stats_play(request: Request, body: dict = Body(...)):
    """前端在 切歌/暂停/关闭 时上报有效收听秒数。按 用户×歌×自然日 聚合。"""
    uid = current_uid(request)
    song = body.get("song") or {}
    secs = float(body.get("secs") or 0)
    mid = str(song.get("id") or "")
    if not mid or secs < 5:   # 听不足 5 秒不计
        return {"code": 0}
    secs = min(secs, 3600.0)
    day = time.strftime("%Y-%m-%d")
    with _db_lock, _conn() as c:
        c.execute(
            """INSERT INTO play_log(user_id,mid,day,song_json,plays,secs,last_played)
               VALUES(?,?,?,?,1,?,?)
               ON CONFLICT(user_id,mid,day) DO UPDATE SET
                 plays=plays+1, secs=secs+excluded.secs,
                 last_played=excluded.last_played, song_json=excluded.song_json""",
            (uid, mid, day, json.dumps(song, ensure_ascii=False), secs, time.time()))
    return {"code": 0}


@router.get("/api/stats/summary")
async def stats_summary(request: Request, range: str = "30d"):
    uid = current_uid(request)
    days = {"7d": 7, "30d": 30}.get(range)
    since_day = time.strftime("%Y-%m-%d", time.localtime(time.time() - days * 86400)) if days else ""
    with _conn() as c:
        rows = c.execute(
            "SELECT mid,song_json,plays,secs,day FROM play_log WHERE user_id=? AND day>=?",
            (uid, since_day)).fetchall()
    songs: dict[str, dict] = {}
    artists: dict[str, dict] = {}
    day_secs: dict[str, float] = {}
    total_secs, total_plays = 0.0, 0
    for r in rows:
        try:
            s = json.loads(r["song_json"])
        except Exception:
            s = {}
        total_secs += r["secs"]
        total_plays += r["plays"]
        day_secs[r["day"]] = day_secs.get(r["day"], 0) + r["secs"]
        e = songs.setdefault(r["mid"], {"song": s, "plays": 0, "secs": 0})
        e["plays"] += r["plays"]
        e["secs"] += r["secs"]
        e["song"] = s or e["song"]
        for name in [x.strip() for x in str(s.get("artist") or "").split(",") if x.strip()]:
            a = artists.setdefault(name, {"name": name, "plays": 0, "secs": 0})
            a["plays"] += r["plays"]
            a["secs"] += r["secs"]
    top_songs = sorted(songs.values(), key=lambda x: (-x["plays"], -x["secs"]))[:20]
    top_artists = sorted(artists.values(), key=lambda x: (-x["plays"], -x["secs"]))[:20]
    return {"code": 0, "data": {
        "range": range,
        "total_secs": int(total_secs), "total_plays": total_plays,
        "song_count": len(songs),
        "top_songs": top_songs, "top_artists": top_artists,
        "days": [{"day": d, "secs": int(v)} for d, v in sorted(day_secs.items())],
    }}
