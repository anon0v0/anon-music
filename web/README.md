# Anon Music Web

Anon Music 的网页后端与播放器源码。后端使用 FastAPI + SQLite，前端为原生 HTML/CSS/JavaScript；桌面版和 Android 版由仓库根目录的 Tauri 外壳加载该网页。

## 功能

- QQ 音乐与网易云兼容 API 双源搜索、播放、歌词、歌单和排行榜
- 账号、收藏、最近播放、自建歌单及一起听
- PWA、桌面歌词、下载和移动端适配

## 音源设计

网站维护一个**服务器私有默认网易云兼容 API**：

- 所有用户统一使用服务器默认音源。
- 默认音源地址不会通过网页 API 返回，也不会写入网页、APK 或 EXE。
- 网页端不提供自定义音源设置。

默认服务需要兼容项目实际调用的网易云 API 路由，例如：

- `/cloudsearch`
- `/song/url/v1`
- `/song/detail`
- `/lyric/new`
- `/toplist`
- `/top/playlist`
- `/playlist/detail`
- `/playlist/track/all`
- `/album`
- `/comment/music`

QQ 音乐不是简单的 URL 音源：它依赖账号凭据和设备状态，因此目前由部署者在服务器端统一配置，不会把凭据下发给普通用户。管理员扫码登录写入 `ANON_MUSIC_QQ_CREDENTIAL` 指定的私有 JSON 文件；不要复用或依赖其他项目的配置目录。

## 环境要求

- Python 3.10+
- Node.js（只用于 JavaScript 语法检查）
- 一个可用的网易云兼容 API
- 可选：QQMusicApi 登录凭据

## 安装

```bash
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

编辑 `.env`，至少设置数据文件路径和私有默认音源：

```dotenv
ANON_MUSIC_DB=/var/lib/anon-music/player_data.db
ANON_MUSIC_DEVICE=/var/lib/anon-music/qq_device.json
ANON_MUSIC_QQ_CREDENTIAL=/var/lib/anon-music/qq_credential.json
ANON_MUSIC_DEFAULT_NCM_BASE=http://127.0.0.1:3000
```

不要提交真实 `.env`、数据库、设备文件、Cookie、日志或管理员哈希。

启动：

```bash
set -a
. ./.env
set +a
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8080
```

检查：

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
```

## QQMusicApi 版本

项目锁定：

- `qqmusic-api-python 0.6.9`
- `niquests 3.20.1`

`0.6.9` 会在响应模型中自动解密歌词。代码同时兼容旧版仍提供 `.decrypt()` 的响应对象。

## 测试

```bash
.venv/bin/python -m compileall -q main.py player_ext.py player_features.py player_together.py player_config.py
for f in static/*.js; do node --check "$f"; done
.venv/bin/python tests/test_qqmusic_compat.py
.venv/bin/python tests/run_tests.py
```

## 生产部署建议

- 使用 systemd 管理 FastAPI。
- 通过 `EnvironmentFile` 注入私有配置。
- 使用 Nginx/Caddy 提供 HTTPS。
- 应用端口只监听回环地址。
- 数据库、QQ 设备文件和环境文件权限设为仅服务用户可读。
- 升级前备份数据库、代码和虚拟环境。

示例 systemd：

```ini
[Unit]
Description=Anon Music Web
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/anon-music/web
EnvironmentFile=/etc/anon-music-web.env
ExecStart=/opt/anon-music/web/.venv/bin/python /opt/anon-music/web/main.py
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 仓库结构

```text
web/
├── main.py
├── player_ext.py
├── player_features.py
├── player_together.py
├── player_config.py
├── requirements.txt
├── .env.example
├── static/
└── tests/
```

Tauri 外壳通过 GitHub Actions 构建 Windows 安装包与 Android APK。仓库变量 `APP_URL` 应设置为部署后的 Anon Music 网页地址。

## 隐私与开源说明

公开源码不应包含：

- GitHub Token、QQ Cookie、musickey、refresh token
- 管理员密码或哈希
- SMTP 密码
- 数据库和用户资料
- QQ 设备文件
- 生产日志、备份和绝对服务器路径
- Android 签名密钥

`.env.example` 只包含示例值。真实默认音源和凭据只存在于部署服务器。聊天或日志里出现过的临时 Token 应立即撤销并重新生成。

## License

仓库根目录许可证适用于本项目代码；第三方音乐 API 和 SDK 分别遵循其自身许可证。使用者应自行遵守所在地法律、平台服务条款和版权要求。
