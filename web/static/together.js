/* 一起听（多人同步播放）——前端。
   房主：监听播放引擎事件，把 当前歌/进度/播放态 上报房间。
   成员：轮询房间状态，秒级跟随房主的切歌/播放/暂停/进度（服务器时间戳补偿 + 本地插值）。
   房主掉线自动转让（后端 _prune），角色变化时前端切换同步方向。guest 也能用（随机昵称）。 */
(function () {
  'use strict';
  const api = (p, o) => apiFetch(p, o).then(r => r.json());
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; };
  const attr = (t) => esc(t).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const jpost = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // 客户端标识（区分设备会话，guest 也有；刷新不变）
  let cid = '';
  try { cid = localStorage.getItem('together_cid') || ''; } catch (e) {}
  if (!cid) { cid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); try { localStorage.setItem('together_cid', cid); } catch (e) {} }
  function myName() {
    const u = window.AppUser;
    if (u && (u.nickname || u.name || u.email)) return u.nickname || u.name || String(u.email).split('@')[0];
    let n = ''; try { n = localStorage.getItem('together_name') || ''; } catch (e) {}
    if (!n) { n = '听众' + Math.floor(Math.random() * 900 + 100); try { localStorage.setItem('together_name', n); } catch (e) {} }
    return n;
  }

  const S = {
    room: null, memberToken: '', joiningInvite: '', role: null, hostName: '', members: [], chatLen: 0,
    lastNow: null, lastSeq: -1, pollT: null, reportT: null, applying: false,
    pollEpoch: 0, polling: false, net: 'connecting', lastOk: 0, failCount: 0,
  };

  // ---------------- 面板 UI ----------------
  const style = document.createElement('style');
  style.textContent = `
  .tg-panel{position:fixed;right:20px;top:76px;bottom:135px;width:360px;max-width:94vw;z-index:10001;
    background:var(--bg-float);border:1px solid var(--line);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.6);
    display:none;flex-direction:column;overflow:hidden;}
  .tg-panel.open{display:flex;}
  .tg-hd{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);}
  .tg-hd .tg-title{font-weight:800;font-size:15px;flex:1;}
  .tg-hd .tg-x{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;line-height:1;}
  .tg-body{flex:1;overflow-y:auto;padding:16px;}
  .tg-lobby .tg-big{width:100%;padding:13px;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:12px;}
  .tg-create{background:var(--brand);color:#04210f;}
  .tg-join-row{display:flex;gap:8px;}
  .tg-join-row input{flex:1;background:var(--bg-inset);border:1px solid var(--line);border-radius:10px;padding:11px 12px;color:var(--text);font-size:15px;text-transform:uppercase;letter-spacing:2px;}
  .tg-join-row input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(34,197,94,.1);}
  .tg-join-row button{background:var(--fill-2);border:1px solid var(--line);color:var(--text-bright);border-radius:10px;padding:0 16px;cursor:pointer;font-weight:650;}
  .tg-tip{color:var(--muted);font-size:12.5px;line-height:1.6;margin-top:14px;}
  .tg-roombar{display:flex;align-items:center;gap:8px;background:var(--bg-inset);border-radius:12px;padding:12px 14px;margin-bottom:14px;}
  .tg-roombar .tg-code{font-size:22px;font-weight:800;letter-spacing:3px;font-variant-numeric:tabular-nums;}
  .tg-roombar .tg-copy{margin-left:auto;background:var(--panel);border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:12.5px;cursor:pointer;}
  .tg-roombar .tg-copy:hover{color:var(--text-bright);}
  .tg-role{font-size:12.5px;color:var(--muted);margin-bottom:10px;}
  .tg-role b{color:var(--brand);}
  .tg-mems{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;}
  .tg-mem{display:inline-flex;align-items:center;gap:5px;background:var(--fill-1);border-radius:999px;padding:5px 12px;font-size:12.5px;}
  .tg-mem.host::before{content:"👑";font-size:11px;}
  .tg-mem button{display:inline-block;border:0;background:none;color:var(--brand);font-size:11px;cursor:pointer;padding:0 0 0 3px;}.tg-mem:hover button{display:inline;}
  .tg-status{display:flex;align-items:center;justify-content:center;gap:7px;color:var(--muted);font-size:12px;margin:-4px 0 12px;}.tg-status i{width:7px;height:7px;border-radius:50%;background:#f5c542;}.tg-status.ok i{background:var(--brand)}.tg-status.bad i{background:#f87171}
  .tg-share{display:flex;gap:8px;justify-content:center;margin:0 0 14px}.tg-share button{border:1px solid var(--line);background:var(--fill-1);color:var(--text);border-radius:9px;padding:7px 12px;cursor:pointer;font-size:12px}
  .tg-chat{border-top:1px solid var(--line);padding-top:12px;}
  .tg-msgs{display:flex;flex-direction:column;gap:8px;max-height:180px;overflow-y:auto;margin-bottom:10px;}
  .tg-msg{font-size:13px;line-height:1.45;}
  .tg-msg .who{color:var(--brand);font-weight:600;margin-right:5px;}
  .tg-msg.sys{color:var(--muted);font-style:italic;font-size:12px;text-align:center;}
  .tg-say{display:flex;gap:8px;}
  .tg-say input{flex:1;background:var(--bg-inset);border:1px solid var(--line);border-radius:10px;padding:9px 12px;color:var(--text);font-size:13px;}
  .tg-say button{background:var(--brand);color:#04210f;border:none;border-radius:10px;padding:0 14px;cursor:pointer;font-weight:700;}
  .tg-leave{width:100%;margin-top:14px;background:none;border:1px solid var(--line);color:var(--ncm);border-radius:10px;padding:10px;cursor:pointer;}
  @media(max-width:820px){.tg-panel{left:0;right:0;bottom:0;top:auto;width:100%;max-width:100%;max-height:76vh;border-radius:16px 16px 0 0;}}
  /* ===== 一起听独立页面 ===== */
  .tg-page{max-width:660px;margin:24px auto;}
  .tg-page .tg-hero{background:linear-gradient(135deg,#123524,#0d2438 70%);border:1px solid var(--line);
    border-radius:20px;padding:34px 30px;text-align:center;margin-bottom:20px;}
  .tg-page .tg-hero h1{font-size:26px;margin:0 0 10px;}
  .tg-page .tg-hero p{color:var(--muted);font-size:13.5px;line-height:1.8;margin:0 0 22px;}
  .tg-page .tg-big{padding:13px 34px;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;}
  .tg-page .tg-join-row{max-width:340px;margin:14px auto 0;}
  .tg-page .tg-roombar{max-width:420px;margin:0 auto 14px;}
  .tg-page .tg-mems{justify-content:center;}
  .tg-page .tg-enter{width:100%;max-width:420px;margin:16px auto 0;display:flex;gap:10px;}
  .tg-page .tg-enter button{flex:1;padding:13px;border:none;border-radius:12px;font-weight:700;cursor:pointer;}
  .tg-page .tg-enter .tg-go{background:var(--brand);color:#04210f;}
  .tg-page .tg-enter .tg-out{background:none;border:1px solid var(--line);color:var(--ncm);}
  .tg-page .tg-chatcard{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;}
  .tg-page .tg-msgs{max-height:300px;}
  /* ===== 全屏播放页弹幕 ===== */
  .dm-layer{position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden;}
  .dm-item{position:absolute;left:100%;white-space:nowrap;font-size:16px;font-weight:600;color:#fff;
    text-shadow:0 1px 5px rgba(0,0,0,.85);animation:dm-move linear;will-change:transform;}
  .dm-item .dm-who{color:var(--brand,#22c55e);margin-right:6px;font-size:13px;}
  .dm-item.me{color:#a8ff78;}
  @keyframes dm-move{to{transform:translateX(calc(-100vw - 100%));}}
  /* 弹幕输入条：进房后出现在全屏页底部控制区上方（文档流内，自动适配移动端） */
  .dm-bar{display:none;position:relative;z-index:3;max-width:520px;margin:0 auto 10px;gap:8px;}
  .np-overlay.tg-live .dm-bar{display:flex;}
  .dm-bar input{flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:999px;
    padding:9px 16px;color:#fff;font-size:13px;min-width:0;}
  .dm-bar input::placeholder{color:rgba(255,255,255,.4);}
  .dm-bar button{background:var(--brand,#22c55e);color:#04210f;border:none;border-radius:999px;padding:0 18px;cursor:pointer;font-weight:700;}
  .np-overlay.lyrics-only .dm-bar{display:none!important;}
  `;
  document.head.appendChild(style);

  // ---------------- 弹幕（全屏播放页，进房后聊天消息横向飘过） ----------------
  const Danmaku = {
    layer: null, laneT: [0, 0, 0, 0, 0, 0],
    ensure() {
      const np = window.NowPlaying; if (!np || !np.el) return null;
      if (!this.layer || !this.layer.isConnected) {
        this.layer = document.createElement('div');
        this.layer.className = 'dm-layer';
        np.el.appendChild(this.layer);
      }
      return this.layer;
    },
    push(name, text, self) {
      const np = window.NowPlaying;
      if (!np || !np.el || !np.el.classList.contains('open')) return;   // 只在全屏页可见时飘
      const layer = this.ensure(); if (!layer) return;
      const d = document.createElement('div');
      d.className = 'dm-item' + (self ? ' me' : '');
      d.innerHTML = `<span class="dm-who">${esc(name || '')}</span>${esc(text || '')}`;
      let lane = 0, bt = Infinity;
      for (let i = 0; i < this.laneT.length; i++) { if (this.laneT[i] < bt) { bt = this.laneT[i]; lane = i; } }
      this.laneT[lane] = Date.now() + 2400;
      d.style.top = (10 + lane * 9) + '%';
      const dur = 9 + Math.random() * 3;
      d.style.animationDuration = dur.toFixed(2) + 's';
      layer.appendChild(d);
      setTimeout(() => d.remove(), dur * 1000 + 300);
    },
  };
  // 自己刚发的弹幕立即上屏；轮询回包按 name|text 去重。用时间戳数组(多重集)：
  // 每发一条 push 一个 token，每条回包消费一个 → 连发相同文本不会互相覆盖漏飘/幻影多飘；
  // 过期项(>30s，覆盖后台节流)在下次查同 key 时清掉，消除永久泄漏。
  const _dmSent = new Map();
  function dmMarkSent(text) { const k = myName() + '|' + text; const a = _dmSent.get(k) || []; a.push(Date.now()); _dmSent.set(k, a); }
  function dmIsMine(m) {
    const k = (m.name || '') + '|' + (m.text || '');
    const a = _dmSent.get(k);
    if (!a) return false;
    while (a.length && Date.now() - a[0] >= 30000) a.shift();
    const hit = a.length > 0;
    if (hit) a.shift();
    if (!a.length) _dmSent.delete(k);
    return hit;
  }

  const panel = document.createElement('div');
  panel.className = 'tg-panel';
  panel.innerHTML = `<div class="tg-hd"><span class="tg-title">🎧 一起听</span><button class="tg-x">✕</button></div><div class="tg-body" id="tgBody"></div>`;
  document.body.appendChild(panel);
  panel.querySelector('.tg-x').onclick = () => panel.classList.remove('open');
  const body = panel.querySelector('#tgBody');

  function renderLobby() {
    body.className = 'tg-body tg-lobby';
    body.innerHTML = `
      <button class="tg-big tg-create" id="tgCreate">创建房间</button>
      <div class="tg-join-row"><input id="tgCode" maxlength="6" placeholder="输入房间码"><button id="tgJoin">加入</button></div>
      <div class="tg-tip">创建房间后把房间码发给好友，一起同步听歌。<br>房主播什么、切到哪、暂停或继续，房间里所有人实时跟随。房主离开会自动把控制权交给其他人。</div>`;
    body.querySelector('#tgCreate').onclick = doCreate;
    body.querySelector('#tgJoin').onclick = () => doJoin(body.querySelector('#tgCode').value);
    body.querySelector('#tgCode').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(e.target.value); });
  }

  function renderRoom(view) {
    body.className = 'tg-body';
    if (!view) { S.chatLen = 0; S.pollEpoch++; }   // 重建面板(如重新打开)→ 清了聊天 DOM，重置游标让下次 poll 拉全量重填；作废在途旧响应
    const isHost = S.role === 'host';
    body.innerHTML = `
      <div class="tg-roombar"><span class="tg-code">${esc(S.room)}</span><button class="tg-copy" id="tgCopy">复制房间码</button></div>
      <div class="tg-status ${S.net === 'bad' ? 'bad' : 'ok'}"><i></i><span>${S.net === 'ok' ? '房间连接正常' : (S.net === 'bad' ? '连接中断，正在重连…' : '正在连接房间…')}</span></div>
      <div class="tg-share"><button id="tgShare">复制邀请链接</button><button id="tgNativeShare">系统分享</button></div>
      <div class="tg-role">你是 <b>${isHost ? '房主' : '听众'}</b> · ${isHost ? '你的播放会同步给所有人' : '正在跟随 ' + esc(S.hostName) + ' 播放'}</div>
      <div class="tg-mems" id="tgMems"></div>
      <div class="tg-chat">
        <div class="tg-msgs tg-msgs-box" id="tgMsgs"></div>
        <div class="tg-say"><input id="tgText" maxlength="200" placeholder="说点什么…"><button id="tgSend">发送</button></div>
      </div>
      <button class="tg-leave" id="tgLeave">退出房间</button>`;
    body.querySelector('#tgCopy').onclick = () => {
      try { navigator.clipboard.writeText(S.room); } catch (e) {}
      body.querySelector('#tgCopy').textContent = '已复制';
      setTimeout(() => { const b = body.querySelector('#tgCopy'); if (b) b.textContent = '复制房间码'; }, 1500);
    };
    const invite = () => `${location.origin}${location.pathname}#/together?room=${encodeURIComponent(S.room)}`;
    body.querySelector('#tgShare').onclick = async () => { try { await navigator.clipboard.writeText(invite()); window.appNotice && window.appNotice('邀请链接已复制'); } catch (e) { window.appNotice && window.appNotice('复制失败，请手动发送房间码', 'warning'); } };
    body.querySelector('#tgNativeShare').onclick = async () => { if (navigator.share) { try { await navigator.share({ title: '一起听', text: `加入房间 ${S.room}`, url: invite() }); } catch (e) {} } else body.querySelector('#tgShare').click(); };
    body.querySelector('#tgLeave').onclick = doLeave;
    const send = async () => { const i = body.querySelector('#tgText'); const t = i.value.trim(); if (t && await sendChat(t)) i.value = ''; };
    body.querySelector('#tgSend').onclick = send;
    body.querySelector('#tgText').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    renderMembers(); renderChat(view ? view.chat : []);
  }

  function renderMembers() {
    const html = S.members.map(m => `<span class="tg-mem ${m.host ? 'host' : ''}">${esc(m.name)}${S.role === 'host' && !m.host ? `<button data-transfer="${attr(m.member_id)}" title="转让房主">转让</button>` : ''}</span>`).join('');
    const panelEl = body.querySelector('#tgMems'); if (panelEl) panelEl.innerHTML = html;
    const pageEl = document.getElementById('tgpMems'); if (pageEl) pageEl.innerHTML = html;
    document.querySelectorAll('[data-transfer]').forEach(b => b.onclick = async () => { const ok = await window.appConfirm({ title: '转让房主', message: '转让后将由对方控制播放，确定继续吗？', okText: '转让' }); if (ok) { const r = await jpost('/api/together/transfer', { member_token: S.memberToken, room: S.room, target: b.dataset.transfer }); window.appNotice(r.code === 0 ? '房主已转让' : (r.msg || '转让失败'), r.code === 0 ? 'info' : 'error'); pollOnce(); } });
  }
  function roleText() {
    const isHost = S.role === 'host';
    return `你是 <b style="color:var(--brand)">${isHost ? '房主' : '听众'}</b> · ${isHost ? '你的播放会同步给房间里所有人' : '正在跟随 ' + esc(S.hostName) + ' 的播放'}`;
  }
  function renderChat(msgs, backfill) {
    if (!msgs || !msgs.length) return;
    // 面板与独立页面的消息容器都在（.tg-msgs-box），各自追加一份
    document.querySelectorAll('.tg-msgs-box').forEach(el => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
      msgs.forEach(m => {
        const d = document.createElement('div');
        if (m.sys) { d.className = 'tg-msg sys'; d.textContent = m.name + ' ' + m.text; }
        else { d.className = 'tg-msg'; d.innerHTML = `<span class="who">${esc(m.name)}</span>${esc(m.text)}`; }
        el.appendChild(d);
      });
      if (atBottom) el.scrollTop = el.scrollHeight;
    });
    // 全屏页弹幕（系统消息不飘；自己发的已即时上屏，轮询回包去重）。
    // backfill=全量历史回填，不飘弹幕，避免进房/重开时几十条旧消息成批刷屏。
    if (!backfill) msgs.forEach(m => { if (!m.sys && !dmIsMine(m)) Danmaku.push(m.name, m.text, false); });
  }

  // 发聊天（面板 / 页面 / 弹幕条共用）：自己的弹幕立即上屏
  async function sendChat(text) {
    if (!text || !S.room) return false;
    try {
      const r = await jpost('/api/together/chat', { member_token: S.memberToken, room: S.room, text });
      if (!r || r.code !== 0) { window.appNotice && window.appNotice((r && r.msg) || '消息发送失败', 'warning'); return false; }
      dmMarkSent(text); Danmaku.push(myName(), text, true); return true;
    } catch (e) { window.appNotice && window.appNotice('消息发送失败，请检查网络', 'error'); return false; }
  }

  // ---------------- 全屏页弹幕输入条（进房后显示在底部控制区上方） ----------------
  function mountDmBar() {
    const np = window.NowPlaying; if (!np || !np.el) return;
    if (np.el.querySelector('.dm-bar')) return;
    const footer = np.el.querySelector('.np-footer'); if (!footer) return;
    const bar = document.createElement('div');
    bar.className = 'dm-bar';
    bar.innerHTML = `<input maxlength="200" placeholder="发个弹幕，房间里的人都能看到…"><button>发送</button>`;
    footer.insertBefore(bar, footer.firstChild);
    const input = bar.querySelector('input');
    const go = async () => { const t = input.value.trim(); if (t && await sendChat(t)) input.value = ''; };
    bar.querySelector('button').onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }
  function syncLive() {
    const np = window.NowPlaying;
    if (np && np.el) np.el.classList.toggle('tg-live', !!S.room);
    if (S.room) mountDmBar();
  }

  // ---------------- 房间生命周期 ----------------
  async function doCreate() {
    try { const r = await jpost('/api/together/create', { cid, name: myName() }); if (r.code === 0) enterRoom(r.room, r.view, r.member_token); else window.appNotice(r.msg || '创建失败', 'error'); } catch (e) { window.appNotice('创建房间失败，请检查网络', 'error'); }
  }
  async function doJoin(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return;
    const r = await jpost('/api/together/join', { cid, room: code, name: myName() });
    if (r.code === 0) enterRoom(r.room, r.view, r.member_token);
    else window.appNotice && window.appNotice(r.msg || '加入失败', 'error');
  }
  async function doLeave() {
    stopLoops();
    if (S.room) jpost('/api/together/leave', { member_token: S.memberToken, room: S.room });
    S.room = null; S.memberToken = ''; S.role = null; S.net = 'connecting'; S.lastNow = null; S.lastSeq = -1; S.chatLen = 0; S.pollEpoch++;
    window.__togetherFollowing = false;
    syncBtn(); syncLive(); renderLobby(); refreshPage();
  }
  function enterRoom(room, view, memberToken) {
    S.room = room; S.memberToken = memberToken || ''; S.net = 'connecting'; S.lastOk = 0; S.failCount = 0; S.chatLen = 0; S.pollEpoch++;
    applyView(view, true);
    syncBtn(); syncLive();
    renderRoom(view);
    startLoops();
    refreshPage();
    try { localStorage.setItem('together_last_room', room); } catch (e) {}
  }

  function applyView(view, initial, backfill) {
    if (!view) return;
    const roleChanged = S.role !== view.role;
    S.role = view.role; S.hostName = view.host_name; S.members = view.members || [];
    // 成员跟随标记必须在 syncToNow 之前置位：入房首拍 songchange 会触发 Queue.save，
    // 守卫不生效就会把用户持久化队列覆盖成房主单曲（不变量 4）
    window.__togetherFollowing = (S.role === 'member' && !!S.room);
    // backfill(csince=0 全量回填)：只填聊天 DOM，不飘弹幕（否则历史消息成批刷屏）
    if (view.chat && view.chat.length && !initial) renderChat(view.chat, backfill);
    S.chatLen = view.chat_next != null ? view.chat_next : S.chatLen;   // 单调消息游标（非数组长度）
    // 成员：seq 变化时同步播放
    if (S.role === 'member' && view.now && view.seq !== S.lastSeq) {
      S.lastSeq = view.seq; S.lastNow = { ...view.now, recvServerTs: view.server_ts };
      syncToNow(true);
    } else if (S.role === 'member' && view.now) {
      S.lastNow = { ...view.now, recvServerTs: view.server_ts };
      syncToNow(false);   // 每次轮询做进度校准（房主没切歌时 seq 不变）
    }
    if (roleChanged) {
      if (S.role === 'host') { stopMemberReactions(); startHostReport(); }
      else { stopHostReport(); }
      // 只更新角色提示文字，不整体重建面板（renderRoom 会清空已显示的聊天记录）
      const roleEl = body.querySelector('.tg-role');
      if (roleEl) {
        const isHost = S.role === 'host';
        roleEl.innerHTML = `你是 <b>${isHost ? '房主' : '听众'}</b> · ${isHost ? '你的播放会同步给所有人' : '正在跟随 ' + esc(S.hostName) + ' 播放'}`;
      }
      const pageRole = document.getElementById('tgpRole'); if (pageRole) pageRole.innerHTML = roleText();   // 独立页面角色文案同步
    }
    renderMembers();
  }

  // ---------------- 成员：跟随房主 ----------------
  function effectivePos(now, serverTs) {
    const elapsed = now.playing ? Math.max(0, serverTs - now.ts) : 0;
    return (now.position || 0) + elapsed;
  }
  function syncToNow(seqChanged) {
    const p = window.player, now = S.lastNow;
    if (!p || !now || !now.song) return;
    const serverTs = now.recvServerTs || (now.ts + 0.1);
    const target = effectivePos(now, serverTs);
    const curId = p.currentSong && p.currentSong.id;
    if (now.song.id !== curId) {
      if (seqChanged) {   // 切歌：加载房主的歌，加载后 seek 到对齐位置
        S.applying = true;
        p.playQQMusicPlaylist([now.song], 0);
        S._pendingSeek = { at: target, playing: now.playing, ts: Date.now() };
        setTimeout(() => { S.applying = false; }, 1500);
      }
      return;
    }
    // 同一首：进度纠偏（偏差 > 2.5s 才 seek，避免频繁打断）
    const audio = p.audio;
    if (audio) {
      const drift = Math.abs((audio.currentTime || 0) - target);
      if (drift > 2.5 && isFinite(target)) { try { p.seekTo(target); } catch (e) {} }
      const isPlaying = !audio.paused;
      if (now.playing && !isPlaying) { S.applying = true; p.play && p.play(); setTimeout(() => S.applying = false, 400); }
      else if (!now.playing && isPlaying) { S.applying = true; p.pause && p.pause(); setTimeout(() => S.applying = false, 400); }
    }
  }
  // 新歌加载完成后执行挂起的 seek（songchange 时）
  let _memberHooked = false;
  function stopMemberReactions() {}
  function hookMemberOnce() {
    if (_memberHooked) return; _memberHooked = true;
    const p = window.player; if (!p || !p.on) return;
    p.on('songchange', () => {
      if (S.role === 'member' && S._pendingSeek) {
        const ps = S._pendingSeek; S._pendingSeek = null;
        const doIt = () => {
          try { if (isFinite(ps.at) && ps.at > 0.5) p.seekTo(ps.at); } catch (e) {}
          if (ps.playing) { p.play && p.play(); } else { p.pause && p.pause(); }
        };
        setTimeout(doIt, 600);   // 等 url/时长就绪
      }
    });
  }

  // ---------------- 房主：上报播放状态 ----------------
  let _hostHooked = false, _hostReporting = false;
  // posOverride：切歌瞬间 audio.currentTime 还是上一首的进度（songchange 早于 audio 归零），
  // 若直接上报会让成员 seek 到旧进度、甚至超出新歌时长。切歌时强制 position=0。
  function currentNow(posOverride) {
    const p = window.player; if (!p || !p.currentSong) return null;
    const s = p.currentSong;
    return {
      song: { id: s.id, name: s.name || '', artists: s.artists || '', picUrl: s.picUrl || s.pic || '', duration: s.duration || 0 },
      position: (posOverride != null) ? posOverride : ((p.audio && p.audio.currentTime) || 0),
      playing: (posOverride != null) ? true : !!(p.audio && !p.audio.paused),
    };
  }
  function report(posOverride) {
    if (!_hostReporting || S.role !== 'host' || !S.room) return;
    const now = currentNow(posOverride); if (!now) return;
    jpost('/api/together/state', { member_token: S.memberToken, room: S.room, ...now });
  }
  function startHostReport() {
    _hostReporting = true;
    if (_hostHooked) { report(); return; }
    _hostHooked = true;
    const p = window.player; if (!p || !p.on) return;
    p.on('songchange', () => report(0));   // 切歌：position 归零（audio 尚未归零，用真实值会上报旧进度）
    p.on('playstate', () => report());
    // 定时刷新进度，供后加入者对齐（3s 一次；切歌/播放态另有即时上报）
    if (!S.reportT) S.reportT = setInterval(() => { if (_hostReporting) report(); }, 3000);
    report();
  }
  function stopHostReport() { _hostReporting = false; }

  // ---------------- 轮询循环 ----------------
  async function pollOnce() {
    if (!S.room || S.polling) return;
    S.polling = true;
    const ep = S.pollEpoch, backfill = S.chatLen === 0, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    if (!S.lastOk) { S.net = 'connecting'; updateNet(); }
    try {
      const r = await api(`/api/together/poll?room=${encodeURIComponent(S.room)}&member_token=${encodeURIComponent(S.memberToken)}&csince=${S.chatLen}`, { signal: controller.signal });
      if (ep !== S.pollEpoch || !S.room) return;
      if (!r || r.alive === false) { window.appNotice && window.appNotice('房间已关闭或身份已失效', 'warning'); doLeave(); return; }
      S.net = 'ok'; S.lastOk = Date.now(); S.failCount = 0; updateNet();
      applyView(r, false, backfill);
    } catch (e) {
      S.failCount++;
      if (!S.lastOk || Date.now() - S.lastOk > 5000 || S.failCount >= 2) { S.net = 'bad'; updateNet(); }
    } finally { clearTimeout(timeout); S.polling = false; }
  }
  function updateNet() { const text = S.net === 'ok' ? '房间连接正常' : (S.net === 'bad' ? '连接中断，正在重连…' : '正在连接房间…'); document.querySelectorAll('.tg-status').forEach(el => { el.classList.toggle('ok', S.net === 'ok'); el.classList.toggle('bad', S.net === 'bad'); el.classList.toggle('connecting', S.net === 'connecting'); const s = el.querySelector('span'); if (s) s.textContent = text; }); }
  function startLoops() {
    hookMemberOnce();
    if (S.role === 'host') startHostReport();
    if (!S.pollT) S.pollT = setInterval(pollOnce, 1200);
  }
  function stopLoops() {
    if (S.pollT) { clearInterval(S.pollT); S.pollT = null; }
    if (S.reportT) { clearInterval(S.reportT); S.reportT = null; }
    stopHostReport();
  }
  window.addEventListener('pagehide', () => { if (S.room) { try { navigator.sendBeacon('/api/together/leave', new Blob([JSON.stringify({ member_token: S.memberToken, room: S.room })], { type: 'application/json' })); } catch (e) {} } });

  // ---------------- 一起听独立页面（#/together 路由，app.js router 调 renderPage） ----------------
  let _pageEl = null;
  function refreshPage() {
    if (_pageEl && _pageEl.isConnected && (location.hash || '').indexOf('#/together') === 0) renderPage(_pageEl.parentElement || document.getElementById('view'));
  }
  function renderPage(view, inviteRoom = '') {
    if (!view) return;
    inviteRoom = String(inviteRoom || '').trim().toUpperCase();
    if (inviteRoom && !S.room && S.joiningInvite !== inviteRoom) { S.joiningInvite = inviteRoom; setTimeout(async () => { await doJoin(inviteRoom); S.joiningInvite = ''; }, 0); }
    const inRoom = !!S.room;
    view.innerHTML = `<div class="tg-page" id="tgPage">
      ${inRoom ? `
      <div class="tg-hero">
        <h1>🎧 一起听 · 房间 ${esc(S.room)}</h1>
        <p id="tgpRole">你是 <b style="color:var(--brand)">${S.role === 'host' ? '房主' : '听众'}</b> · ${S.role === 'host' ? '你的播放会同步给房间里所有人' : '正在跟随 ' + esc(S.hostName) + ' 的播放'}</p>
        <div class="tg-roombar"><span class="tg-code">${esc(S.room)}</span><button class="tg-copy" id="tgpCopy">复制房间码</button></div><div class="tg-status ${S.net === 'bad' ? 'bad' : 'ok'}"><i></i><span>${S.net === 'ok' ? '房间连接正常' : (S.net === 'bad' ? '连接中断，正在重连…' : '正在连接房间…')}</span></div>
        <div class="tg-share"><button id="tgpShare">复制邀请链接</button><button id="tgpNativeShare">系统分享</button></div>
        <div class="tg-mems" id="tgpMems">${S.members.map(m => `<span class="tg-mem ${m.host ? 'host' : ''}">${esc(m.name)}${S.role === 'host' && !m.host ? `<button data-transfer="${attr(m.member_id)}">转让</button>` : ''}</span>`).join('')}</div>
        <div class="tg-enter">
          <button class="tg-go" id="tgpGo">进入播放厅（全屏 + 弹幕）</button>
          <button class="tg-out" id="tgpLeave">退出房间</button>
        </div>
      </div>
      <div class="tg-chatcard">
        <div class="tg-msgs tg-msgs-box" id="tgpMsgs"></div>
        <div class="tg-say"><input id="tgpText" maxlength="200" placeholder="说点什么，会以弹幕飘过播放厅…"><button id="tgpSend">发送</button></div>
      </div>` : `
      <div class="tg-hero">
        <h1>🎧 一起听</h1>
        <p>创建房间并把房间码发给好友，全网同步一起听歌。<br>房主播放、切歌、暂停或继续，房间内成员都会实时同步；<br>进入播放厅还能发弹幕，房主离开后会自动移交控制权。</p>
        <button class="tg-big tg-create" id="tgpCreate">创建房间</button>
        <div class="tg-join-row"><input id="tgpCode" maxlength="6" placeholder="输入房间码"><button id="tgpJoin">加入房间</button></div>
      </div>`}
    </div>`;
    _pageEl = view.querySelector('#tgPage');
    if (inRoom) {
      view.querySelector('#tgpCopy').onclick = () => {
        try { navigator.clipboard.writeText(S.room); } catch (e) {}
        view.querySelector('#tgpCopy').textContent = '已复制';
        setTimeout(() => { const b = view.querySelector('#tgpCopy'); if (b) b.textContent = '复制房间码'; }, 1500);
      };
      const invite = `${location.origin}${location.pathname}#/together?room=${encodeURIComponent(S.room)}`;
      view.querySelector('#tgpShare').onclick = async () => { try { await navigator.clipboard.writeText(invite); window.appNotice('邀请链接已复制'); } catch (e) { window.appNotice('复制失败，请手动发送房间码', 'warning'); } };
      view.querySelector('#tgpNativeShare').onclick = async () => { if (navigator.share) { try { await navigator.share({ title: 'Anon Music 一起听', text: `加入房间 ${S.room}`, url: invite }); } catch (e) {} } else view.querySelector('#tgpShare').click(); };
      renderMembers();
      view.querySelector('#tgpGo').onclick = () => { if (window.NowPlaying) window.NowPlaying.open(); };
      view.querySelector('#tgpLeave').onclick = doLeave;
      const send = async () => { const i = view.querySelector('#tgpText'); const t = i.value.trim(); if (t && await sendChat(t)) i.value = ''; };
      view.querySelector('#tgpSend').onclick = send;
      view.querySelector('#tgpText').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
      // 让下次轮询把聊天记录全量拉回来填进页面（面板容器同时重填 → 先清空防止重复）
      document.querySelectorAll('.tg-msgs-box').forEach(el => { el.innerHTML = ''; });
      S.chatLen = 0; S.pollEpoch++;   // 作废在途旧响应，避免清空后旧回包把 chat_next 顶上去导致丢消息
    } else {
      view.querySelector('#tgpCreate').onclick = doCreate;
      view.querySelector('#tgpJoin').onclick = () => doJoin(view.querySelector('#tgpCode').value);
      view.querySelector('#tgpCode').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(e.target.value); });
    }
  }

  // 一起听入口在侧栏 NAV（#/together 路由），不再挂顶栏按钮。syncBtn 保留为兼容 no-op。
  function syncBtn() {}
  renderLobby();
  // 调试：?tg=1 自动打开面板（无头截图用）
  if (/[?&]tg=1\b/.test(location.search)) setTimeout(() => { panel.classList.add('open'); renderLobby(); }, 900);

  window.Together = {
    open: () => { location.hash = '#/together'; },
    inRoom: () => !!S.room,
    renderPage,
  };
})();
