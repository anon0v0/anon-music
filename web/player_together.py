"""一起听（多人同步播放）——短轮询实现，使用服务端成员令牌鉴权。"""
import time
import random
import secrets
import threading

from fastapi import APIRouter, Body

router = APIRouter()
_lock = threading.Lock()
_rooms: dict[str, dict] = {}

MEMBER_TTL = 25.0
CHAT_KEEP = 50
NAME_MAX = 20
TEXT_MAX = 200
MAX_MEMBERS = 20
ROOM_MAX_AGE = 6 * 3600
CHAT_INTERVAL = 0.65
_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _now() -> float:
    return time.time()


def _clean_name(value) -> str:
    return str(value or "").strip()[:NAME_MAX] or "听众"


def _gen_code() -> str:
    for _ in range(20):
        code = "".join(random.choice(_CODE_CHARS) for _ in range(5))
        if code not in _rooms:
            return code
    return "".join(random.choice(_CODE_CHARS) for _ in range(6))


def _new_member(name: str) -> tuple[str, dict]:
    member_id = secrets.token_hex(8)
    return member_id, {
        "name": name,
        "token": secrets.token_urlsafe(32),
        "seen": _now(),
        "joined": _now(),
        "last_chat": 0,
    }


def _member_by_token(room: dict, token: str):
    if not token:
        return None, None
    for member_id, member in room["members"].items():
        if secrets.compare_digest(member["token"], token):
            return member_id, member
    return None, None


def _add_chat(room: dict, msg: dict):
    msg["mid"] = room["chat_seq"]
    room["chat_seq"] += 1
    room["chat"].append(msg)
    room["chat"] = room["chat"][-CHAT_KEEP:]


def _prune(room: dict):
    now = _now()
    members = room["members"]
    if now - room.get("created", now) > ROOM_MAX_AGE:
        members.clear()
        return
    for member_id in [key for key, member in members.items() if now - member["seen"] > MEMBER_TTL]:
        members.pop(member_id, None)
    if room["host"] not in members and members:
        room["host"] = max(members.items(), key=lambda item: item[1]["seen"])[0]
        room["host_name"] = members[room["host"]]["name"]
        room["seq"] += 1


def _room_view(room: dict, member_id: str, csince: int) -> dict:
    _prune(room)
    new_chat = [msg for msg in room["chat"] if msg.get("mid", 0) >= csince]
    return {
        "seq": room["seq"],
        "now": room["now"],
        "host_name": room["host_name"],
        "role": "host" if member_id == room["host"] else "member",
        # member_id 是公开显示 ID，不是鉴权凭据；令牌绝不出现在房间视图中。
        "members": [
            {"member_id": key, "name": member["name"], "host": key == room["host"]}
            for key, member in sorted(room["members"].items(), key=lambda item: item[1]["joined"])
        ],
        "member_count": len(room["members"]),
        "chat": new_chat,
        "chat_next": room["chat_seq"],
        "server_ts": _now(),
        "alive": bool(room["members"]),
    }


@router.post("/api/together/create")
async def together_create(body: dict = Body(...)):
    name = _clean_name(body.get("name"))
    with _lock:
        code = _gen_code()
        member_id, member = _new_member(name)
        _rooms[code] = {
            "host": member_id,
            "host_name": name,
            "created": _now(),
            "members": {member_id: member},
            "now": None,
            "seq": 0,
            "chat": [],
            "chat_seq": 0,
        }
        return {
            "code": 0,
            "room": code,
            "member_token": member["token"],
            "view": _room_view(_rooms[code], member_id, 0),
        }


@router.post("/api/together/join")
async def together_join(body: dict = Body(...)):
    room_id = str(body.get("room") or "").strip().upper()
    name = _clean_name(body.get("name"))
    with _lock:
        room = _rooms.get(room_id)
        if not room:
            return {"code": -1, "msg": "房间不存在或已关闭"}
        _prune(room)
        if not room["members"]:
            _rooms.pop(room_id, None)
            return {"code": -1, "msg": "房间已过期"}
        if len(room["members"]) >= MAX_MEMBERS:
            return {"code": -1, "msg": f"房间已满（最多 {MAX_MEMBERS} 人）"}
        member_id, member = _new_member(name)
        room["members"][member_id] = member
        _add_chat(room, {"name": name, "text": "加入了房间", "sys": True, "ts": _now()})
        return {
            "code": 0,
            "room": room_id,
            "member_token": member["token"],
            "view": _room_view(room, member_id, 0),
        }


@router.post("/api/together/leave")
async def together_leave(body: dict = Body(...)):
    room_id = str(body.get("room") or "").strip().upper()
    token = str(body.get("member_token") or "")
    with _lock:
        room = _rooms.get(room_id)
        if room:
            member_id, member = _member_by_token(room, token)
            if member_id:
                room["members"].pop(member_id, None)
                _add_chat(room, {"name": member["name"], "text": "离开了房间", "sys": True, "ts": _now()})
            if not room["members"]:
                _rooms.pop(room_id, None)
            else:
                _prune(room)
    return {"code": 0}


@router.post("/api/together/state")
async def together_state(body: dict = Body(...)):
    room_id = str(body.get("room") or "").strip().upper()
    token = str(body.get("member_token") or "")
    with _lock:
        room = _rooms.get(room_id)
        if not room:
            return {"code": -1, "msg": "不在房间中"}
        member_id, member = _member_by_token(room, token)
        if not member_id:
            return {"code": -1, "msg": "成员身份已失效"}
        member["seen"] = _now()
        if member_id != room["host"]:
            return {"code": 0, "ignored": True}
        song = body.get("song")
        try:
            position = max(0.0, min(float(body.get("position") or 0), 86400.0))
        except (TypeError, ValueError):
            position = 0.0
        playing = bool(body.get("playing"))
        prev = room["now"] or {}
        prev_id = (prev.get("song") or {}).get("id")
        new_id = (song or {}).get("id") if isinstance(song, dict) else None
        changed = (new_id != prev_id) or (playing != prev.get("playing")) or abs(
            position - float(prev.get("position") or 0)
            - (_now() - float(prev.get("ts") or _now()) if prev.get("playing") else 0)
        ) > 3.0
        room["now"] = {"song": song, "position": position, "playing": playing, "ts": _now()}
        if changed:
            room["seq"] += 1
        return {"code": 0, "seq": room["seq"]}


@router.post("/api/together/chat")
async def together_chat(body: dict = Body(...)):
    room_id = str(body.get("room") or "").strip().upper()
    token = str(body.get("member_token") or "")
    text = str(body.get("text") or "").strip()[:TEXT_MAX]
    if not text:
        return {"code": 0}
    with _lock:
        room = _rooms.get(room_id)
        if not room:
            return {"code": -1, "msg": "不在房间中"}
        member_id, member = _member_by_token(room, token)
        if not member_id:
            return {"code": -1, "msg": "成员身份已失效"}
        member["seen"] = _now()
        if _now() - member.get("last_chat", 0) < CHAT_INTERVAL:
            return {"code": -1, "msg": "发送太快了，请稍后再试"}
        member["last_chat"] = _now()
        _add_chat(room, {"name": member["name"], "text": text, "ts": _now()})
    return {"code": 0}


@router.post("/api/together/transfer")
async def together_transfer(body: dict = Body(...)):
    room_id = str(body.get("room") or "").strip().upper()
    token = str(body.get("member_token") or "")
    target = str(body.get("target") or "").strip()
    with _lock:
        room = _rooms.get(room_id)
        if not room:
            return {"code": -1, "msg": "房间不存在"}
        member_id, _member = _member_by_token(room, token)
        if not member_id or member_id != room.get("host") or target not in room["members"] or target == member_id:
            return {"code": -1, "msg": "无法转让房主"}
        room["host"] = target
        room["host_name"] = room["members"][target]["name"]
        room["seq"] += 1
        _add_chat(room, {"name": room["host_name"], "text": "成为了新房主", "sys": True, "ts": _now()})
    return {"code": 0}


@router.get("/api/together/poll")
async def together_poll(room: str, member_token: str, csince: int = 0):
    room_id = str(room or "").strip().upper()
    token = str(member_token or "")
    with _lock:
        current = _rooms.get(room_id)
        if not current:
            return {"code": 0, "alive": False}
        member_id, member = _member_by_token(current, token)
        if not member_id:
            return {"code": 0, "alive": False}
        member["seen"] = _now()
        view = _room_view(current, member_id, max(0, int(csince or 0)))
        if not view["alive"]:
            _rooms.pop(room_id, None)
        return {"code": 0, **view}
