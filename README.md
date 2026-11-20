# 汽水音乐 Web MVP

一个参考汽水音乐交互语义制作的移动端 Web 音乐播放器。前端使用原生 HTML/CSS/JavaScript，Express 通过 `ytmusicapi` 搜索 YouTube Music 单曲，再由 `yt-dlp` 解析和代理音频流供浏览器播放。

> 本项目用于学习和原型验证，不连接汽水音乐后端，也不绕过会员、付费鉴权或平台风控。使用前请确认音频来源和使用方式符合所在地法律及相关平台条款。

## 功能

- 每次启动按服务器当前年份和月份动态获取 20 首抖音热门歌曲、关键词单曲搜索（最多 50 条）
- 播放、暂停、切歌、进度跳转，以及顺序、单曲循环、随机播放模式
- 播放详情支持同步歌词、逐行高亮和点击歌词跳转；无同步歌词时回退到纯文本
- 收藏、最近播放和本地队列。刷新页面后会保留队列和播放进度，点击播放即可续听
- 支持 HTTP Range 的音频代理
- 移动端暗色界面

收藏、历史和队列只保存在浏览器 `localStorage`；项目没有账号、数据库或云同步。

## 环境与启动

需要 Node.js 22.21+、Python 3.9+、`yt-dlp`、`ytmusicapi` 和可访问 YouTube 的网络。Node 版本要求来自内置环境变量代理支持；项目会让搜索和音频流共用同一代理。

```powershell
python -m pip install --upgrade -r requirements.txt
cd server
npm ci
npm start
```

打开 <http://127.0.0.1:8080>。可用 `PORT` 修改端口，用 `YTDLP_PYTHON` 指定 Python 解释器。如果服务器不能直连 YouTube，可在启动前设置 yt-dlp 代理：

```powershell
$env:YTDLP_PROXY="http://127.0.0.1:7890"
npm start
```

如果使用的是 CMD、Clink 或 Cmder，而不是 PowerShell，请改用：

```bat
set "YTDLP_PROXY=http://127.0.0.1:7890"
npm start
```

端口需要替换为本机代理软件实际监听的 HTTP 代理端口。设置后，启动器会同时配置 yt-dlp 与 Node `fetch`，避免搜索成功但播放直连 `googlevideo.com` 超时。

## 检查与测试

在 `server` 目录执行：

```powershell
npm run check
npm test
```

上述冒烟测试不访问外网，覆盖健康检查、静态页面和基础参数校验。完整外部链路需要先启动服务：

```powershell
npm run test:e2e
```

E2E 验证推荐、搜索、音频解析和 Range 代理，结果写入 `artifacts/e2e/`，失败时返回非零退出码。可通过 `BASE_URL` 和 `E2E_QUERY` 环境变量调整地址和关键词。

## 结构

```text
server/             Express 服务、搜索和音频代理
web/                无构建步骤的前端应用
tests/              不依赖外网的 Node 冒烟测试
e2e_test.py         完整外部链路测试
reverse_report.md   APK 分析和功能映射记录
_reverse/           逆向产物，不参与运行
_shots/             历史界面截图
```

## API

| 路径 | 说明 |
| --- | --- |
| `GET /health` | 服务健康状态 |
| `GET /api/playlist?n=12` | 推荐列表 |
| `GET /api/search?q=...&limit=20` | 搜索歌曲 |
| `GET /api/stream?id=...` | 音频流元信息 |
| `GET /api/proxy?id=...` | 音频代理，支持 Range |
| `GET /api/lyrics?title=...&artist=...` | 从 LRCLIB 获取同步或纯文本歌词 |

## 已知边界

- 搜索使用 YouTube Music 的 `songs` 分类，播放地址由 `yt-dlp` 解析；两者都依赖外部网络，可能受上游变更影响。
- 公开部署前仍需完善鉴权、限流、日志、缓存和来源合规策略。
- 暂无登录、云同步、原生后台播放和 Android 打包；歌词来自 LRCLIB，公开商业发布前需自行确认歌词授权。
- `reverse_report.md` 是研究记录，早期页面描述可能与当前实现不同，以 `web/` 代码为准。
