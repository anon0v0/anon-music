# Anon Music 浏览器回归

需要 Node.js、Playwright 和 Chrome / Chromium。三个脚本均会在同一进程启动仅绑定 127.0.0.1 的临时静态服务，不必启动生产后端。所有 `/api/**` 使用隔离 fixture，不写入生产账户或曲库。媒体 fixture 是动态生成的 WAV，由真实 HTMLMediaElement 播放。

```bash
NODE_PATH=/path/to/tools/node_modules BROWSER_PATH=/path/to/chrome node tests/ui-regression.cjs
NODE_PATH=/path/to/tools/node_modules BROWSER_PATH=/path/to/chrome node tests/ios-interactions.cjs
NODE_PATH=/path/to/tools/node_modules BROWSER_PATH=/path/to/chrome node tests/ios-visual.cjs
```

Windows 默认 `BROWSER_PATH=C:/Program Files/Google/Chrome/Application/chrome.exe`；可用 `BASE_URL=http://host/music` 检查已部署资源。测试输出放在 `PI_SCRATCH_DIR`，未设置则放系统临时目录。`SECTION=S1` 至 `S7` 可单独运行原回归的指定分组。

## 当前覆盖

- **70 项基础回归**：响应式、侧栏、10 个页面路由、真实音频播放暂停/上下首/循环模式/倍速/音质/进度/音量、歌词及翻译/歌词跳转、队列、收藏、歌单、登录注册弹窗、评论、浏览器下载、本地导入播放与持久化、主题切换、快速导航缓存。
- **7 项 iOS 交互专项**（独立子代理编写并运行，主代理修复后复测）：CDP 真实触摸拖动直线进度与 touchcancel、下拉收起和面板手势隔离、ESC 层级/Tab 焦点/返回焦点、旋转后歌词居中、播放/暂停/隐藏时 RAF 生命周期、窄屏队列与音质/倍速、音量触摸中断清理与背景 inert 隔离。
- **视觉 QA**（独立子代理编写并运行）：7 种尺寸的卡片宽度/间距、首屏标题高度、内外横向溢出、控件 hit test、全屏遮挡、无波形/直线进度高度、深浅主题按钮对比度、减少动态效果。`report.json` 包含度量与缺陷，存在缺陷时脚本退出码为 1。

视觉验收指标：桌面推荐封面约 148px、间距 24px；手机封面 132px、间距 16px；桌面播放条 82px、手机 58px；播放器 4px 直线进度，无波形 Canvas。截图用于实际效果预览，DOM/对比度自动测试不能替代审美判断或真实 iPhone GPU 性能测试。

## 验证边界

- 真实 QQ / 网易云搜索、音频及歌词另外做上线前后冒烟验证；写请求拦截，不修改生产音乐库。
- 未使用真实邮箱发送验证码或注册账号，已验证表单和登录/注册模式切换。
- 一起听入口和既有后端测试保留，未进行多设备长期同步验收。
- 未构建/发布 EXE/APK；原生桥接未改动，前端资源生成单独验证，不能替代原生真机测试。
- 版权、会员权限和上游接口状态由音源决定。
- 改版前 `test_source_config.py` 已有 6 个失败，对应线上缺失的源配置模块/示例/路由，不属于本轮视觉重做。

`run_tests.py` 保留原有后端/兼容性安全检查；更新视觉静态断言为直线进度与小卡片要求，不删除功能测试。
