# 国内友好架构：日常不走 CF，挂了才用 CF 维护页

## 你要的效果

| 场景 | 流量路径 | 体验 |
|------|----------|------|
| 主站正常 | 用户 → **直连中转/源站**（DNS **灰云**） | 国内延迟低 |
| 主站挂了 | 用户打开 **CF Pages 状态页** | 维护小游戏 + 自动跳回 |

**不要**再把 `music.saki.li` 全程橙云代理（会绕 Cloudflare 全球网络，国内延迟/丢包升高）。

```text
日常（快）:
  music.saki.li  ──DNS 仅解析(灰云)──► 腾讯中转 / 国内源站 ──► VPS:8080

挂了（兜底）:
  status.saki.li ──CF Pages(橙云)──► 维护页，探测 music/healthz，恢复后自动跳 /music
```

Worker 故障回退（绑在 `music.saki.li/*`）已**默认关闭**，仅作可选。

---

## 一、主站 DNS（必须灰云）

Dashboard → **saki.li** → **DNS** → `music`：

1. 类型 **A**，内容填你的**国内中转 IP**（例如以前的 `106.55.60.29`）  
   或源站公网 IP（若 80/443 已对公网开放且证书正常）
2. 代理状态：**仅 DNS（灰色云朵）**  ← 关键
3. SSL：灰云时由**中转/源站自己**提供 HTTPS，与 CF SSL 模式无关

验证：

```bash
nslookup music.saki.li 1.1.1.1
# 应直接是你的中转/源站 IP，不是 104.x / 172.67.x
```

> 当前若腾讯中转仍返回 DNSPod 拦截页，需要先修好中转/隧道；CF 橙云+Tunnel 虽能通，但国内会慢——这是你已感受到的。

---

## 二、CF 只负责状态/维护页（Pages）

### 1）部署

```bash
cd standby/cloudflare
npm install
npx wrangler login   # 若未登录
npm run deploy:pages
```

会得到类似：

```text
https://anon-music-standby.pages.dev
```

### 2）绑自定义域名（推荐）

Dashboard → **Workers 与 Pages** → `anon-music-standby` → **自定义域**：

- 添加 `status.saki.li`（或 `music-status.saki.li`）
- 按提示加 CNAME（一般会自动加，**可橙云**——只影响状态页，不影响播歌）

### 3）状态页行为

- 探测：`https://music.saki.li/healthz`（需源站 CORS，已支持）
- 恢复：`{"status":"ok"}` 后自动跳 `https://music.saki.li/music`
- 等待时：节拍跑者小游戏

可把状态页链接写在主站 502 说明、QQ 群、个人主页。

---

## 三、（可选）DNS 故障自动切到维护页

若希望「主站 IP 不通时域名自动变成维护页」，用 DNS 厂商的**宕机切换**（不是全程橙云）：

| 厂商 | 做法 |
|------|------|
| DNSPod / 腾讯云 DNS | 监控 `music` A 记录；失败时切换到 Pages 的 CNAME |
| Cloudflare | Load Balancing / 健康检查（可能收费） |

平时仍指向中转 IP（灰云）；挂了再切到 `anon-music-standby.pages.dev`。

---

## 四、源站本地维护页（中转通、后端挂）

VPS 上的 FastAPI 仍提供 `/maintenance`：  
中转正常但 `8080` 挂了时，用户直连中转也能看到维护页（不经过 CF）。

---

## 五、可选：Worker 绑主域名（不推荐日常）

仅当你接受国内绕 CF 时：

1. 取消注释 `wrangler.toml` 里的 `routes`
2. `npm run deploy:worker`
3. `music` 必须橙云

这会回到「全程代理」模式，**国内慢**。

---

## 六、Cloudflare Tunnel 说明

本机 `cloudflared` 适合：

- 源站无公网 / 端口打不开时，**临时**用橙云 + Tunnel 救急  
- 或给海外用户一条 CF 线路  

不适合作为国内主力入口。国内主力请用 **灰云 + 国内中转**。

隧道可保留作备用；不要和「国内主站灰云」冲突时抢同一条 DNS。

---

## 检查清单

- [ ] `music` DNS = 中转/源站 IP，**灰云**
- [ ] `curl https://music.saki.li/healthz` → `{"status":"ok"}` 且延迟可接受
- [ ] `npm run deploy:pages` 成功
- [ ] `status.saki.li` 打开是维护/状态页
- [ ] 主站 Worker 路由列表为空（不绑 `music.saki.li/*`）
