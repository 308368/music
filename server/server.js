import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const app = express();
app.use(cors());
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

// 静态托管前端
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, "..", "web")));

// 运行时探测 python(优先环境变量, 否则 "python" 命令名), 跨平台稳
const PYBIN = process.env.YTDLP_PYTHON || "python";
const YTDLP_PROXY = String(process.env.YTDLP_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "").trim();
const MAX_YTDLP_JOBS = Math.max(1, Math.min(Number(process.env.YTDLP_CONCURRENCY) || 4, 8));
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
const SEARCH_TTL = 15 * 60_000;
const STREAM_TTL = 5 * 60_000;
const UPSTREAM_TIMEOUT = 120_000;
const LYRICS_API_BASE = String(process.env.LYRICS_API_BASE || "https://lrclib.net/api").replace(/\/+$/, "");
const LYRICS_TTL = 12 * 60 * 60_000;
const LYRICS_MISS_TTL = 30 * 60_000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const mediaProviderError = (error, stderr) => {
  const diagnostic = `${error?.message || ""}\n${stderr || ""}`;
  // 详细诊断只留在服务端，避免把 yt-dlp 的重试日志、乱码和本机路径暴露给页面。
  console.error("yt-dlp failed:", diagnostic.trim().slice(0, 4000));
  if (/No module named yt_dlp|ModuleNotFoundError/i.test(diagnostic)) {
    const dependency = /ytmusicapi/i.test(diagnostic) ? "ytmusicapi" : "yt-dlp";
    return new HttpError(503, `服务器缺少 ${dependency}，请执行 pip install -r requirements.txt`);
  }
  if (/timed out|ETIMEDOUT|timeout/i.test(diagnostic)) {
    return new HttpError(504, "媒体服务响应超时，请稍后重试");
  }
  if (/WinError 10013|Failed to establish a new connection|Unable to download|Network is unreachable|Connection refused/i.test(diagnostic)) {
    return new HttpError(503, "无法连接媒体服务，请检查服务器网络或代理设置");
  }
  return new HttpError(502, "媒体服务暂时不可用，请稍后重试");
};
const parseIntInRange = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
};
const readVideoId = (value) => {
  const id = String(value || "").trim();
  if (!VIDEO_ID.test(id)) throw new HttpError(400, "invalid video id");
  return id;
};

let activeYtJobs = 0;
const ytWaiters = [];
const withYtSlot = async (work) => {
  if (activeYtJobs >= MAX_YTDLP_JOBS) await new Promise((resolve) => ytWaiters.push(resolve));
  activeYtJobs += 1;
  try {
    return await work();
  } finally {
    activeYtJobs -= 1;
    ytWaiters.shift()?.();
  }
};

const runYtDlp = (args, timeout) => withYtSlot(() => new Promise((resolve, reject) => {
  const proxyArgs = YTDLP_PROXY ? ["--proxy", YTDLP_PROXY] : [];
  execFile(
    PYBIN,
    ["-m", "yt_dlp", "--no-warnings", ...proxyArgs, ...args],
    { encoding: "utf8", timeout, maxBuffer: 4 << 20, windowsHide: true },
    (err, stdout, stderr) => {
      if (err) return reject(mediaProviderError(err, stderr));
      resolve(stdout || "");
    },
  );
}));

// YouTube 缩略图(hqdefault 必然存在, maxresdefault 可能 404)
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// 搜索只使用 YouTube Music 的 songs 分类，避免普通视频、节目和长歌单混入。
const inFlight = new Map();
function musicSearch(query, n, { fresh = false } = {}) {
  const key = `music:${query}:${n}`;
  const hit = urlCache.get(key);
  if (!fresh && hit && hit.expiry > Date.now()) return Promise.resolve(hit.value);
  if (inFlight.has(key)) return inFlight.get(key);

  const encodedQuery = Buffer.from(query, "utf8").toString("base64");
  const helper = join(__dirname, "ytmusic_search.py");
  const pending = withYtSlot(() => new Promise((resolve, reject) => {
    execFile(
      PYBIN,
      [helper, encodedQuery, String(n)],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 2 << 20, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(mediaProviderError(error, stderr));
        try {
          const raw = JSON.parse(stdout || "[]");
          const items = raw.filter((item) => VIDEO_ID.test(item.id || "")).slice(0, n).map((item, i) => ({
            id: item.id,
            title: String(item.title || "未知歌曲"),
            channel: String(item.channel || "未知歌手"),
            duration: String(item.duration || ""),
            album: String(item.album || ""),
            thumbnail: thumb(item.id),
            rank: i + 1,
            resultType: "song",
          }));
          resolve(items);
        } catch {
          reject(new HttpError(502, "歌曲搜索服务返回了无效数据"));
        }
      },
    );
  })).then((items) => {
    urlCache.set(key, { value: items, expiry: Date.now() + SEARCH_TTL });
    return items;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

// LRU 缓存(yt-dlp URL 带签名且过期, 设 5 分钟 TTL)
class LRU {
  constructor(cap) { this.cap = cap; this.m = new Map(); }
  get(k) {
    if (!this.m.has(k)) return undefined;
    const v = this.m.get(k);
    this.m.delete(k);
    this.m.set(k, v);
    return v;
  }
  set(k, v) {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.cap) {
      const first = this.m.keys().next().value;
      this.m.delete(first);
    }
  }
}
const urlCache = new LRU(200);

const durationSeconds = (value) => {
  const raw = String(value || "").trim();
  if (/^\d+:\d{2}$/.test(raw)) {
    const [minutes, seconds] = raw.split(":").map(Number);
    return minutes * 60 + seconds;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
};
const readLyricsField = (value, name, required = false) => {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (required && !text) throw new HttpError(400, `${name} is required`);
  if (text.length > 180) throw new HttpError(400, `${name} is too long`);
  return text;
};
const limitedLyrics = (value) => typeof value === "string" ? value.slice(0, 200_000) : "";

async function findLyrics({ title, artist, album, duration }) {
  const key = `lyrics:${title}:${artist}:${album}:${duration}`;
  const hit = urlCache.get(key);
  if (hit && hit.expiry > Date.now()) return hit.value;
  const baseParams = new URLSearchParams({ track_name: title, artist_name: artist });
  const params = new URLSearchParams(baseParams);
  if (album) params.set("album_name", album);
  if (duration) params.set("duration", String(duration));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const headers = {
        Accept: "application/json",
        "User-Agent": "DouyinMusicWeb/1.0 (local educational prototype)",
        "Lrclib-Client": "DouyinMusicWeb/1.0",
    };
    let response = await fetch(`${LYRICS_API_BASE}/get?${params}`, { signal: controller.signal, headers });
    if (response.status === 404 && (album || duration)) {
      response = await fetch(`${LYRICS_API_BASE}/get?${baseParams}`, { signal: controller.signal, headers });
    }
    if (response.status === 404) {
      const value = { found: false, instrumental: false, plainLyrics: "", syncedLyrics: "" };
      urlCache.set(key, { value, expiry: Date.now() + LYRICS_MISS_TTL });
      return value;
    }
    if (response.status === 429) throw new HttpError(503, "歌词服务请求过于频繁，请稍后重试");
    if (!response.ok) throw new HttpError(503, "歌词服务暂时不可用，请稍后重试");
    const body = await response.json();
    const value = {
      found: true,
      instrumental: Boolean(body.instrumental),
      trackName: String(body.trackName || title).slice(0, 180),
      artistName: String(body.artistName || artist).slice(0, 180),
      plainLyrics: limitedLyrics(body.plainLyrics),
      syncedLyrics: limitedLyrics(body.syncedLyrics),
    };
    urlCache.set(key, { value, expiry: Date.now() + LYRICS_TTL });
    return value;
  } catch (error) {
    if (error?.name === "AbortError") throw new HttpError(504, "歌词加载超时，请稍后重试");
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "无法连接歌词服务，请检查网络或代理设置");
  } finally {
    clearTimeout(timeout);
  }
}

// 取流: 对 watch URL 用 --get-url 拿音频直链; 这个调用不用 --no-playlist
function ytStream(id) {
  const key = "stream:" + id;
  const hit = urlCache.get(key);
  if (hit && hit.expiry > Date.now()) return Promise.resolve(hit);
  if (inFlight.has(key)) return inFlight.get(key);
  const cmd = [
    "-q", "--no-playlist",
    "--get-url",
    "-f", "ba[ext=webm]/ba[ext=m4a]/ba",
    `https://www.youtube.com/watch?v=${id}`,
  ];
  const pending = runYtDlp(cmd, 30_000).then((stdout) => {
      const u = (stdout || "").trim().split("\n").pop();
      if (!u || !u.startsWith("http")) throw new HttpError(502, "no playable stream found");
      const v = {
        url: u,
        mime: u.includes("m4a") ? "audio/mp4" : "audio/webm",
        expiry: Date.now() + STREAM_TTL,
      };
      urlCache.set(key, v);
      return v;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

const port = parseIntInRange(process.env.PORT, 8080, 1, 65535);

const sendError = (res, error, fallbackStatus = 500) => {
  const status = error instanceof HttpError ? error.status : fallbackStatus;
  const message = error instanceof HttpError ? error.message : "internal server error";
  if (!res.headersSent) res.status(status).json({ error: message });
  if (status >= 500) console.error(error);
};

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const limit = parseIntInRange(req.query.limit, 20, 1, 50);
  if (!q) return res.json({ query: "", results: [] });
  if (q.length > 120 || /[\u0000-\u001f\u007f]/.test(q)) return res.status(400).json({ error: "invalid search query" });
  try {
    const items = await musicSearch(q, limit);
    res.json({ query: q, results: items });
  } catch (e) {
    sendError(res, e);
  }
});

app.get("/api/stream", async (req, res) => {
  try {
    const id = readVideoId(req.query.id);
    const s = await ytStream(id);
    res.json({ ...s, id, thumbnail: thumb(id) });
  } catch (e) {
    sendError(res, e);
  }
});

app.get("/api/lyrics", async (req, res) => {
  try {
    const title = readLyricsField(req.query.title, "title", true);
    const artist = readLyricsField(req.query.artist, "artist", true);
    const album = readLyricsField(req.query.album, "album");
    const duration = durationSeconds(req.query.duration);
    res.setHeader("Cache-Control", "public, max-age=1800");
    res.json(await findLyrics({ title, artist, album, duration }));
  } catch (error) {
    sendError(res, error);
  }
});

// 流式代理: 浏览器 <audio> 直接请求, 服务端透传 Range, 规避 googlevideo 的 CORS/防盗链
app.get("/api/proxy", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);
  const abort = () => controller.abort();
  req.once("aborted", abort);
  res.once("close", () => { if (!res.writableEnded) abort(); });
  try {
    const id = readVideoId(req.query.id);
    const range = String(req.headers.range || "bytes=0-");
    if (!/^bytes=\d*-\d*$/.test(range)) throw new HttpError(416, "invalid range");
    const s = await ytStream(id);
    const upstream = await fetch(s.url, {
      headers: { Range: range },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      throw new HttpError(502, `media upstream returned ${upstream.status}`);
    }
    // 透传关键响应头
    const pass = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const h of pass) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(upstream.status);
    if (upstream.body) {
      const reader = upstream.body.getReader();
      const pump = async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(Buffer.from(value))) {
            await new Promise((r) => res.once("drain", r));
          }
        }
        res.end();
      };
      await pump();
    } else {
      res.end();
    }
  } catch (e) {
    if (e?.name === "AbortError") sendError(res, new HttpError(504, "media upstream timed out"));
    else if (e?.cause?.code === "UND_ERR_CONNECT_TIMEOUT") sendError(res, new HttpError(504, "连接音频服务器超时，请检查服务器代理设置"));
    else sendError(res, e, 502);
    if (res.headersSent && !res.writableEnded) res.destroy();
  } finally {
    clearTimeout(timeout);
    req.off("aborted", abort);
  }
});

app.get("/api/playlist", async (req, res) => {
  try {
    const want = parseIntInRange(req.query.n, 20, 1, 20);
    const now = new Date();
    const query = `抖音热门歌曲 ${now.getFullYear()}年${now.getMonth() + 1}月`;
    const results = await musicSearch(query, want, { fresh: true });
    res.setHeader("Cache-Control", "no-store");
    res.json({ query, results });
  } catch (e) {
    sendError(res, e);
  }
});

app.get("/health", (_req, res) => res.json({
  ok: true,
  py: PYBIN,
  uptime: Math.round(process.uptime()),
  activeYtJobs,
  queuedYtJobs: ytWaiters.length,
  proxyEnabled: Boolean(YTDLP_PROXY),
}));

app.listen(port, () => {
  console.log(`douyin-music server on :${port} (py=${PYBIN})`);
});
