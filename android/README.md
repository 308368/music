# 汽水音乐 Android 个人自用版

APK 提供热门歌曲搜索、歌词、收藏、队列和原生音频播放。手机使用自己的网络连接 Neko 歌姬计划在线曲库，电脑可以关机。收藏和播放进度保存在手机里。

首页按手机当前年月查找汽水音乐公开歌单，只选最相关的一张。明确标注当月的榜单优先，其次是当年持续更新的热歌榜。App 通过 Neko 的歌单详情接口或汽水音乐公开分享页读取曲目，再按歌名和歌手匹配 Neko 音源，最多展示 20 首。结果缓存到当天结束。点首页的刷新图标可清掉当日缓存并重新查找。

## 安装与上网

1. 安装 `app/build/outputs/apk/debug/app-debug.apk`。这是调试签名包，最低要求 Android 8.0，包含 ARM64 手机和 x86_64 模拟器版本。
2. 打开 App，进入 **搜索**，输入歌名和歌手，例如 `晴天 周杰伦`，点击对应专辑的歌曲即可播放。搜索和播放可用性取决于手机网络和在线曲库收录情况。
3. 如需通过 HTTP 代理连接曲库，打开首页右上角 **网络设置**，填写手机代理软件显示的地址和端口。保存后推荐、搜索、歌词、封面和音频均使用该代理。更改代理会暂停当前播放。

网络设置支持无需认证的 HTTP 代理。页面使用 Android System WebView，旧设备出现空白或布局异常时可更新系统 WebView。

原生后台播放时可在通知栏暂停、继续和切歌。若系统单独回收播放器页面，原生服务可继续播放当前曲目。重新打开 App 会接回播放状态。

## 音源与许可

本程序由 Neko歌姬计划 API 提供技术支持。当前 APK 用于个人自用。向公众提供接入版本时，需要另行遵守接口的开源、署名、源码公示和公开应用的语言要求。详见 [Neko 歌姬计划 API 文档](https://github.com/FantasyNetworkCN/NekoMusicDocs) 和[许可及附加条款](https://github.com/FantasyNetworkCN/NekoMusicDocs/blob/main/LICENSE)。

## 从源码构建

本目录使用 JDK 17 或 22、Android SDK Platform 35、Python 3.13 和项目内的 Gradle Wrapper。构建时下载 Chaquopy 和 Python 依赖，APK 包含所需的运行时。

```powershell
.\gradlew.bat :app:assembleDebug
```

Gradle 从相邻的 `../web` 打包界面，并加入安卓播放适配层和网络设置。安卓端的曲目查询和音频处理位于 `app/src/main/python`，运行在手机上。
