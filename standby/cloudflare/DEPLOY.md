# Cloudflare 部署清单（music.saki.li 已在 CF）

当前公网解析若仍是 `106.55.60.29`（腾讯云），说明记录多半是 **仅 DNS（灰云）**。  
Worker 故障回退 **必须** 对该主机名开启 **已代理（橙云）**。

---

## 一、DNS 设置（Dashboard，2 分钟）

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com) → 选中 **saki.li**
2. **DNS** → 找到 `music`（或 `music.saki.li`）
3. 内容 / IPv4：填你的**源站或中转** IP  
   - 继续用腾讯云中转：`106.55.60.29`  
   - 或 VPS 公网 IP（若已直接暴露 443）
4. 代理状态点成 **已代理（橙色云朵）**
5. **SSL/TLS** → 概述 → 加密模式：**完全** 或 **完全（严格）**  
   - 中转有有效证书 → 优先「完全（严格）」  
   - 证书有问题可先「完全」
6. 等 1～2 分钟后，用公共 DNS 查询：

```bash
nslookup music.saki.li 1.1.1.1
```

应变成 Cloudflare 任播 IP（常见 `104.x` / `172.64.x` / `188.114.x`），**不再是** `106.55.60.29`。

本地若解析成 `198.18.x.x`，那是代理软件假 IP，以 `1.1.1.1` 查询为准。

---

## 二、部署 Worker

### 方式 A：本机 wrangler（推荐，含完整小游戏）

```bash
cd standby/cloudflare
npm install
npx wrangler login          # 浏览器登录 CF
npx wrangler deploy
```

然后：

1. **Workers 与 Pages** → `anon-music-failover`
2. **设置 → 域和路由** → 添加路由  
   - 路由：`music.saki.li/*`  
   - 区域：`saki.li`

### 方式 B：仅 Pages 备用状态页（不改主路由）

```bash
cd standby/cloudflare
npx wrangler pages deploy ./public --project-name=anon-music-standby
```

再给 `status.saki.li` 绑这个 Pages 项目。主站挂了可打开状态页。

---

## 三、验证

```bash
# 经过 CF
curl -sSI https://music.saki.li/healthz | grep -i cf-ray

# 源站正常
curl -sS https://music.saki.li/healthz
# {"status":"ok"}

# 停源站或断中转后
curl -sSI https://music.saki.li/music | grep -i x-anon-fallback
curl -sS https://music.saki.li/music | head
# 维护页 HTML，而不是 Lucky 502
```

---

## 四、架构（与现有中转兼容）

```text
用户 → Cloudflare（必须橙云）
         → 源站 IP = 腾讯云中转 106.55.60.29
         → 隧道 → Ubuntu:8080 播放器

中转/VPS 挂了时：
用户 → Cloudflare Worker → 维护小游戏页（边缘，不经 Lucky）
```

---

## 五、常见问题

| 现象 | 处理 |
|------|------|
| 解析仍是 106.55.60.29 | 未开橙云 |
| 错误 526/525 | SSL 模式与中转证书不匹配，改「完全」试 |
| 仍是 Lucky 502 | 路由未绑，或仍是灰云 |
| 维护页无样式 | 用 wrangler 部署带 `public/` 的完整版 |
| 恢复不自动跳转 | 源站 `/healthz` 需返回 `{"status":"ok"}` |

---

## 六、本目录

```text
standby/cloudflare/
├── DEPLOY.md
├── worker.js
├── wrangler.toml
├── package.json
└── public/          # 维护页资源
```
