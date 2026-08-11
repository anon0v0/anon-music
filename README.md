# Anon Music

<p align="center">
  <img src="newlogo.png" alt="Anon Music" width="128" height="128" />
</p>

<p align="center">
  <strong>自托管双音源音乐播放器</strong><br/>
  网页 + Windows 桌面 + Android，一套服务端，多端同体验
</p>

Anon Music 把 **QQ 音乐** 与 **网易云兼容 API** 聚合到同一个暗色播放器里：搜索、歌单、歌词、账号收藏、一起听，以及可选的桌面歌词与本地下载。服务端是 FastAPI；Windows / Android 客户端是 Tauri 2 外壳，加载你自己部署的网页地址，**不在客户端里塞音源密钥**。

> 本仓库面向**自托管**。请自行部署体验；暂不提供公共演示站（避免把个人生产环境暴露成公开 Demo，也减少滥用与版权风险）。

---

## 功能一览

| 能力 | 说明 |
|------|------|
| 双音源 | QQ 音乐 + 网易云兼容 API，搜索 / 播放 / 歌词 / 歌单 / 排行榜 |
| 账号与库 | 登录后独立收藏、最近播放、自建歌单；未登录为公共共享数据 |
| 一起听 | 多人同步播放房间 |
| 歌词 | 逐字歌词、桌面歌词（桌面壳） |
| 客户端 | 网页 / PWA；Windows EXE·MSI；Android APK（GitHub Actions 构建） |
| 体验 | 暗色 UI、主题与背景、下载管理、维护页离线小游戏 |

---

## 架构

```text
┌─────────────────┐     HTTPS      ┌──────────────────────┐
│  浏览器 / PWA   │ ─────────────► │                      │
│  Windows (Tauri)│                │   web/  FastAPI      │
│  Android (Tauri)│ ─────────────► │   SQLite + 播放器    │
└─────────────────┘   加载网页 URL  └──────────┬───────────┘
                                              │
                         ┌────────────────────┼────────────────────┐
                         ▼                    ▼                    ▼
                  网易云兼容 API          QQMusicApi           你的 SMTP 等
               (服务端私有地址)        (服务端登录凭据)         (可选)
```

| 目录 | 作用 |
|------|------|
| [`web/`](web/) | 网页后端 + 完整播放器（核心） |
| [`src-tauri/`](src-tauri/) | Tauri 2：托盘、下载、全局快捷键、Android 媒体控制 |
| [`src/`](src/) | 壳内启动页（含维护 / 离线小游戏） |
| [`scripts/`](scripts/) | 构建时注入 `APP_URL`、Android 注入脚本 |
| [`.github/workflows/`](.github/workflows/) | 打 tag 或手动触发 → 产出 EXE / MSI / APK |

详细部署、环境变量与测试见 **[`web/README.md`](web/README.md)**。

---

## 快速开始（网页）

需要：Python 3.10+、一台网易云兼容 API、可选 QQ 登录凭据。

```bash
cd web
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# 编辑 .env：数据库路径、默认音源、管理员与 SMTP 等

set -a && . ./.env && set +a   # Windows 请用你习惯的方式加载环境变量
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8080
```

```bash
curl http://127.0.0.1:8080/healthz
# 浏览器打开 http://127.0.0.1:8080/music
```

生产建议：只监听回环 + Nginx/Caddy HTTPS 反代；密钥只放在服务器环境变量，**不要提交 `.env`**。

---

## 音源说明（必读）

1. **网易云侧**  
   服务端通过环境变量配置私有默认 API：

   ```dotenv
   ANON_MUSIC_DEFAULT_NCM_BASE=http://127.0.0.1:3000
   ```

   该地址**不会**通过网页接口、APK 或 EXE 下发。所有用户统一使用服务器默认音源；网页端**不提供**自定义音源设置。

2. **QQ 音乐侧**  
   依赖账号与设备状态，由部署者在服务端完成扫码 / 凭据配置，写入例如 `ANON_MUSIC_QQ_CREDENTIAL` 指定文件。凭据不得提交进 Git，也不得下发给普通用户。

3. **合规**  
   仅供学习与自用交流。请遵守各平台服务条款、版权法与所在地法律；勿将本项目用于未授权的商业分发。

---

## 构建 Windows / Android 客户端

客户端**不打包你的后端**，只加载构建时注入的网页地址。

```bash
npm install
# 可选本地注入地址（CI 会用仓库变量 APP_URL）
node scripts/set-app-url.mjs https://你的域名/music
npm run tauri build
```

### GitHub Actions

1. 仓库 **Settings → Secrets and variables → Actions → Variables**  
   设置 `APP_URL` = `https://你的域名/music`
2. 手动跑 `build` workflow，或推送 `v*` 标签  
3. Artifacts / Release 中下载 EXE、MSI、APK  
4. Android 若要**稳定覆盖安装**，配置 Secret `ANDROID_KEYSTORE_BASE64`

图标源文件为仓库根目录 **`newlogo.png`**；`tauri icon` 与网页 favicon / PWA 图标均由其生成。

---

## 隐私与仓库卫生

请勿提交：

- 数据库、用户资料、播放记录  
- QQ Cookie / musickey / refresh token / 设备 JSON  
- SMTP 密码、管理员哈希、GitHub Token  
- 真实 `.env`、生产日志、备份、Android keystore  

只保留 `.env.example` 作模板。聊天或 Issue 里出现过的 Token 应立即作废并轮换。

---

## 版本参考

| 组件 | 版本 |
|------|------|
| 客户端 | Tauri 2（产品版本见 `src-tauri/tauri.conf.json`） |
| QQ 接口库 | `qqmusic-api-python` **0.6.9** |
| HTTP | `niquests` **3.20.1** |
| 网易云上游（示例） | API Enhanced 系，以你实际部署为准 |

---

## License

本仓库代码与第三方依赖分别遵循各自许可证。使用即表示你理解并自行承担合规与运维责任。

## 许可证

本项目采用 **GPL-3.0**（见 [LICENSE](LICENSE)）。

其中 `src-tauri/mobile/MusicService.kt` 的媒体卡片自定义动作实现
（`PlaybackState.CustomAction` + `onCustomAction` 回调）参考自
[NeriPlayer](https://github.com/cwuom/NeriPlayer)（GPL-3.0），据此本项目整体采用同一许可证。
