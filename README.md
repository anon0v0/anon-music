# Anon Music — 桌面 / 安卓 原生外壳

把已部署的 **Anon Music 网页播放器**（`/music`）包成 **Windows .exe** 和 **安卓 .apk**。

## 这是什么 / 原理

播放器的后端（QQ SDK、网易 `:3003`、登录 Cookie、邮件）都在你的服务器上，前端用相对路径
访问同源接口。所以这个外壳**不重写任何功能**，只是一个用系统 WebView 打开你那个远程
HTTPS 域名的原生窗口 —— **永远和服务端保持同步，零跨域 / 零 Cookie 问题**。

- 桌面：Tauri v2 + 系统 WebView2（Windows 10/11 自带）。
- 安卓：Tauri v2 + 系统 WebView。
- 同一套工程、同一个配置，分别产出 `.exe` 和 `.apk`。

> 注：网页本身已做成可安装 **PWA**（浏览器「安装到主屏 / 安装应用」即可），手机端日常用 PWA
> 最省事；本工程用于产出可分发的安装包。

## 唯一必做的配置：你的对外地址

外壳要加载的远程地址通过仓库变量注入，**改这一处即可**：

1. GitHub 仓库 ▸ **Settings ▸ Secrets and variables ▸ Actions ▸ Variables ▸ New variable**
2. 名称 `APP_URL`，值填你的真实地址，例如：`https://music.yourdomain.com/music`

（本地构建时改 `src-tauri/tauri.conf.json` 的 `app.windows[0].url`，或运行
`node scripts/set-app-url.mjs https://music.yourdomain.com/music`。仓库里默认是占位域名
`music.example.com`，不改装出来会打不开。）

## 出包（推荐：GitHub Actions，无需本地环境）

把本目录推到一个 GitHub 仓库后：

- **打 tag 触发正式构建并发 Release**
  ```bash
  git tag v0.1.0 && git push origin v0.1.0
  ```
  Actions 跑完后，`.exe`(NSIS) / `.msi` 和 `.apk` 会自动附到对应的 GitHub Release。
- **手动试跑**：Actions 页选 `build` ▸ Run workflow（`workflow_dispatch`），产物在该次运行的
  Artifacts 里下载。

工作流见 [`.github/workflows/build.yml`](.github/workflows/build.yml)：
- `windows` job（windows-latest）→ NSIS 安装包 `.exe` + `.msi`
- `android` job（ubuntu-latest）→ `.apk`（用 CI 生成的 debug 级 keystore 自动签名，可直接 sideload）

## 安装提示

- **Windows**：未做代码签名，首次运行 SmartScreen 会提示「未知发布者」→ 更多信息 ▸ 仍要运行。
  想去掉提示需购买代码签名证书。
- **安卓**：需在系统里允许「安装未知来源应用」。当前用 debug 级签名，能装能用；要上架
  Google Play 需换成你自己的正式 keystore（把它放进仓库 Secret，并改 workflow 的签名步骤）。

## 本地构建（可选，需自备工具链）

```bash
npm install
node scripts/set-app-url.mjs https://music.yourdomain.com/music
# 桌面（需 Rust + 对应平台 WebView 依赖）
npm run tauri build
# 安卓（需 Android SDK/NDK + JDK17 + Rust android targets）
npm run tauri android init
npm run tauri android build -- --apk
```

## 目录

- `src/` — 离线占位页（正常运行时窗口直接加载远程域名，不展示这里）。
- `src-tauri/tauri.conf.json` — 窗口与打包配置（`app.windows[0].url` = 要加载的地址）。
- `src-tauri/icons/` — 由 `app-icon.png` 经 `npx tauri icon` 生成的全平台图标。
- `scripts/set-app-url.mjs` — 注入对外地址的小脚本。
