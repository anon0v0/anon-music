# Anon Music

Anon Music 是一个自托管双音源音乐网页播放器，并提供基于 Tauri 2 的 Windows 和 Android 客户端外壳。

## 仓库内容

```text
├── src/                 # Tauri 页面和启动界面
├── src-tauri/           # Rust/Tauri 配置
├── scripts/             # APP_URL 注入及 Android 构建脚本
├── .github/workflows/   # EXE/MSI/APK 自动构建
└── web/                 # FastAPI 网页后端与完整播放器
```

## 架构

- `web/` 是实际网页服务：FastAPI、SQLite 和原生 JavaScript 播放器。
- Tauri 客户端加载部署后的网页地址，不在客户端中保存服务器音源凭据。
- GitHub Actions 根据仓库变量 `APP_URL` 构建 Windows 安装包和 Android APK。

## 音源配置

服务器通过环境变量保存一个私有默认网易云兼容 API：

```dotenv
ANON_MUSIC_DEFAULT_NCM_BASE=http://127.0.0.1:3000
```

该地址不会通过网页 API、APK 或 EXE 返回。访客只能使用默认音源；登录用户可以在网页的 `设置 → 自定义音源` 中保存自己的网易云兼容 API 地址。配置按账号隔离，删除后恢复默认音源。

QQ 音乐依赖服务器端账号凭据及设备状态，不属于简单 URL 音源；部署者需要自行完成 QQMusicApi 登录配置，凭据不会提交到仓库或下发给用户。

完整部署、接口兼容要求、测试和隐私说明见 [`web/README.md`](web/README.md)。

## 网页后端快速启动

```bash
cd web
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 后加载环境变量
set -a && . ./.env && set +a
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8080
```

健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

## 构建客户端

安装依赖：

```bash
npm install
```

本地桌面构建：

```bash
npm run tauri build
```

GitHub Actions：

1. 在仓库 `Settings → Secrets and variables → Actions → Variables` 中设置 `APP_URL`。
2. 手动运行 `build` workflow，或推送 `v*` 标签。
3. Windows job 生成 EXE/MSI；Android job 生成 APK。
4. Android 稳定覆盖安装需要配置 `ANDROID_KEYSTORE_BASE64` Secret。

## 隐私与安全

仓库不应包含：

- 数据库、用户资料和播放记录
- QQ Cookie、musickey、refresh token 或设备 JSON
- SMTP 密码、管理员哈希、GitHub Token
- 真实 `.env`、生产日志和备份
- Android keystore

请只提交 `.env.example`。任何曾粘贴到聊天、Issue 或日志中的访问 Token 都应撤销并重新生成。

## 版本

当前网页后端适配：

- 网易云 API Enhanced `4.37.0`
- QQMusicApi `0.6.9`
- niquests `3.20.1`

## License

本项目代码与第三方依赖分别遵循各自许可证。使用者应自行遵守平台服务条款、版权规则和所在地法律。
