# 维护页备用站（Failover）

当 **腾讯云中转 / 源站** 挂掉时，浏览器只会看到边缘的 `502 Bad Gateway`，请求到不了 Anon Music 自己的 `/maintenance`。

本目录提供一份**自包含静态维护页**（小游戏 + 中文提示）。挂在你另一台永远在线的服务器或对象存储上，中转失败时把流量切过来即可。

```text
standby/
├── index.html          # 入口
├── maintenance.css
├── maintenance.js
├── app-icon.png
└── favicon-32.png
```

页面会周期性探测 `https://music.saki.li/healthz`；恢复后自动跳回 `https://music.saki.li/music`。

---

## 方案对比（推荐从上到下）

| 方案 | 效果 | 需要 |
|------|------|------|
| **A. 边缘反代失败回退** | 中转/源站 502 时，**同域名** `music.saki.li` 直接显示维护页 | Lucky / Nginx / Caddy 支持 `error_page` / backup upstream |
| **B. 健康检查自动切 DNS** | 主站挂了，域名解析切到备用 IP | DNSPod 宕机切换 / Cloudflare Health Checks |
| **C. 独立备用域名** | 主站挂了用户打开 `status.saki.li` 或 `m.saki.li` | 第二台服务器或 Pages/OSS；需用户知道备用地址或客户端写死 |
| **D. 客户端内置** | EXE/APK 启动先本地维护页再探活（已实现） | 已安装客户端；**纯网页用户无效** |

**当前 502 场景最有效的是 A 或 B。**  
源站自己的 `/maintenance` 只能在「流量已经到达源站」时工作；中转整站挂了时必须在**边缘**或**DNS** 做 failover。

---

## A. 边缘失败回退（同域名，体验最好）

在 **Lucky / 腾讯云中转机** 上：

1. 主上游：源站隧道 → `127.0.0.1:8080`（或你的穿透端口）
2. 备用上游：本静态目录（可放在**另一台机**，或中转机本机一个永远在线的 nginx）
3. 主上游 502 / 连接失败时 `error_page` 到备用

### Nginx 示例

```nginx
# 主站（源站隧道）
upstream anon_primary {
    server 127.0.0.1:8080 max_fails=2 fail_timeout=10s;
}

# 备用：另一台服务器上的静态维护站
upstream anon_standby {
    server 备用服务器IP:80 backup;
}

server {
    listen 443 ssl http2;
    server_name music.saki.li;

    # …证书配置…

    location / {
        proxy_pass http://anon_primary;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 3s;
        proxy_read_timeout 30s;
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_intercept_errors on;
        error_page 502 503 504 = @standby;
    }

    location @standby {
        proxy_pass http://anon_standby;
        proxy_set_header Host $host;
    }
}
```

备用站若只托管静态文件，也可直接：

```nginx
location @standby {
    root /var/www/anon-standby;
    try_files /index.html =502;
}
```

把本目录内容拷到 `/var/www/anon-standby/` 即可。

### Caddy 示例

```caddy
music.saki.li {
    reverse_proxy 127.0.0.1:8080 {
        health_uri /healthz
        health_interval 10s
        fail_duration 20s
        # 不健康时用 handle_errors 回退
    }
    handle_errors {
        @5xx expression `{err.status_code} >= 500`
        handle @5xx {
            root * /var/www/anon-standby
            rewrite * /index.html
            file_server
        }
    }
}
```

### Lucky

在 Lucky 面板找「反向代理 / 负载均衡 / 故障转移」：

- 主节点：源站隧道
- 备节点：静态维护站或第二台服务器
- 健康检查：`GET /healthz`，失败切备用

不同版本菜单名略有差异，逻辑相同。

---

## B. DNS 健康检查切换

若边缘本身也挂了，只能靠 DNS：

1. **主记录** `music.saki.li` → 中转 `106.55.60.29`
2. **备用记录** → 第二台服务器公网 IP（跑本静态站或完整源站）
3. DNSPod / Cloudflare：**宕机切换 / Health Check**，主失败后把 A 记录切到备用

注意：TTL 建议 60～120 秒；切换有缓存延迟。

---

## C. 独立备用域名（最快可上线）

任意一台有 80/443 的服务器：

```bash
# 例如 /var/www/anon-standby
rsync -av standby/ user@备用机:/var/www/anon-standby/
```

Nginx：

```nginx
server {
    listen 80;
    server_name status.saki.li;   # 或任意子域
    root /var/www/anon-standby;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

也可丢到 **Cloudflare Pages / GitHub Pages / 对象存储静态网站**（整目录上传即可，无后端）。

用户访问 `https://status.saki.li/` 即维护页；源站恢复后页面会自动跳回正式站。

可把该地址写进：

- 客户端启动失败提示
- 朋友圈 / 群公告
- 主站 README（备用状态页，不是 Demo）

---

## 修改探测地址

编辑 `standby/index.html` 顶部：

```html
data-target="https://music.saki.li/music"
data-health="https://music.saki.li/healthz"
```

- `data-health`：恢复探测地址（需源站可达且返回 `{"status":"ok"}`）
- `data-target`：恢复后跳转地址

源站 `healthz` 已允许跨域 `GET`（`Access-Control-Allow-Origin: *`），备用站可跨域轮询。

---

## 分层策略（建议你最终采用）

```text
1. 客户端 EXE/APK     → 本地维护页（已有）
2. 边缘 Lucky/Nginx   → 502 时同域名回退 standby 静态页  ← 网页用户关键
3. 第二台服务器        → 挂 standby 或完整 web 副本
4. DNS 宕机切换        → 边缘整台挂了时兜底
```

**只部署源站 `/maintenance` 不够**：中转炸了时流量到不了源站。  
**必须把维护页放到「中转失败时仍能碰到」的位置**——边缘本机、第二台服务器、或公共静态托管。

---

## 本地预览

```bash
cd standby
python -m http.server 8790
# 浏览器打开 http://127.0.0.1:8790/
```

---

## 注意

- 备用站只有静态文件，**不能播歌**；只负责告知维护 + 小游戏消磨时间。
- 恢复跳转依赖正式域名 `healthz` 重新可达；若 DNS 仍指向坏掉的中转，需先修好 DNS/中转。
- 不要把生产密钥放进备用站；本目录无需任何环境变量。

---

## Cloudflare（推荐：VPS 掉线也能出维护页）

Cloudflare 边缘几乎不挂。把 `music.saki.li` 接入 CF 后，用 **Worker 故障回退**：

```text
用户 → Cloudflare 边缘
         ├─ 源站正常 → 透传中转 / VPS
         └─ 超时 / 502 / 连不上 → 边缘直接返回维护小游戏页
```

**不需要**再依赖腾讯云 Lucky 的 502 页；VPS 整机掉线时用户仍看到你的维护页。

### 方案 1：Worker + 内置静态资源（同域名，最佳）

前置：

1. 域名 NS 已切到 Cloudflare（或 CNAME 接入）
2. DNS 记录 `music` → 你的中转/源站 IP，**代理状态：已代理（橙云）**
3. SSL/TLS 模式建议 **Full**（源站有证书）或 **Full (strict)**

本机部署（需 Node.js + 登录 CF）：

```bash
cd standby/cloudflare
npm install
npx wrangler login
npx wrangler deploy
```

然后在 Cloudflare Dashboard：

1. **Workers & Pages** → `anon-music-failover` → **Triggers / 域和路由**
2. 添加路由：`music.saki.li/*`
3. 确认 DNS 橙云已开

验证：

```bash
# 正常时应透传源站
curl -sS https://music.saki.li/healthz

# 故意停源站或断隧道后，应看到维护页 HTML，而不是 Lucky 502
curl -sS https://music.saki.li/music | head
```

响应头里可能有 `x-anon-fallback: assets` 表示已走边缘维护页。

### 方案 2：只挂 Pages 备用域名（最简单）

不改主站路由，单独做一个状态页：

```bash
cd standby/cloudflare
npm install
npx wrangler pages deploy ../ --project-name=anon-music-standby
# 或只上传 public：
npx wrangler pages deploy ./public --project-name=anon-music-standby
```

得到 `https://anon-music-standby.pages.dev`，可再绑 `status.saki.li`。

主站挂了时让用户打开状态页；或在 DNS 宕机切换时把 `music` 指到 Pages（仅静态，不能播歌）。

### 方案 3：Worker 回退到 Pages

若不想把资源打进 Worker，可把 `STANDBY_BASE` 设为 Pages 地址，Worker 只负责探测源站并在失败时 `fetch` Pages。

在 `wrangler.toml`：

```toml
[vars]
STANDBY_BASE = "https://anon-music-standby.pages.dev"
```

### 和现有腾讯云中转怎么配合

| 层级 | 作用 |
|------|------|
| Cloudflare | 最外层；源站挂了出维护页 |
| 腾讯云 Lucky | 可选中转；CF 源站 IP 可仍填中转 |
| Ubuntu 源站 | 真正的 FastAPI |

也可以 **去掉中转**，CF 直接回源 VPS（若 VPS 有公网且防火墙放行 443）。  
国内访问 CF 可能偏慢，你当前「CF + 国内中转」的结构可以保留，只要 **DNS 先解析到 CF**。

### 注意

- Worker 免费额度通常足够个人站；超限会另计费，见 CF 文档。
- 回退页**不能播歌**，只负责提示 + 小游戏。
- `/healthz` 在源站挂掉时由 Worker 返回 `{"status":"offline"}` 503，维护页会继续等待，不会误跳转。
- 源站恢复后，维护页探测到 `{"status":"ok"}` 会自动回 `/music`。
- 若仍看到腾讯云 / DNSPod 拦截页，说明 DNS **没有** 走 CF（还在直连 `106.55.60.29`），请先把域名接入 CF。

### 目录

```text
standby/cloudflare/
├── worker.js          # 故障回退逻辑
├── wrangler.toml
├── package.json
└── public/            # 维护页静态资源（部署进 Worker Assets）
```

---

## 国内访问建议（2026-07）

**不要**对 `music.saki.li` 全程橙云代理，延迟和丢包会明显升高。

推荐：

1. 主站 DNS **灰云** → 国内中转 / 源站  
2. 挂了时打开 CF Pages 状态页：见 `cloudflare/DEPLOY.md`  
   - 项目：`anon-music-standby`  
   - 默认域名：`https://anon-music-standby.pages.dev`  
3. 主域名 **不要** 绑定 Worker 路由 `music.saki.li/*`

