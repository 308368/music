import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const serverDir = join(root, "server");
const port = 18080 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let server;
let lyricsServer;

async function waitUntilReady() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready: ${lastError?.message || "timeout"}`);
}

before(async () => {
  lyricsServer = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname !== "/get") { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      trackName: url.searchParams.get("track_name"), artistName: url.searchParams.get("artist_name"),
      instrumental: false, plainLyrics: "第一句\n第二句", syncedLyrics: "[00:01.00]第一句\n[00:04.50]第二句",
    }));
  });
  await new Promise((resolve) => lyricsServer.listen(0, "127.0.0.1", resolve));
  const lyricsAddress = lyricsServer.address();
  server = spawn(process.execPath, ["server.js"], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(port), YTDLP_PYTHON: "__codex_missing_python__", LYRICS_API_BASE: `http://127.0.0.1:${lyricsAddress.port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitUntilReady();
});

after(() => { if (server && !server.killed) server.kill(); lyricsServer?.close(); });

test("health endpoint reports a ready service", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.py, "string");
});

test("static app shell is served", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  const html = await response.text();
  assert.match(html, /id="app"/);
  assert.match(html, /js\/player\.js/);
  assert.match(html, /js\/app\.js/);
});

test("mini player exposes favorite and navigable song details", async () => {
  const [html, appJs, css] = await Promise.all([
    readFile(join(root, "web", "index.html"), "utf8"),
    readFile(join(root, "web", "js", "app.js"), "utf8"),
    readFile(join(root, "web", "css", "app.css"), "utf8"),
  ]);
  assert.match(html, /id="miniOpen"/);
  assert.match(html, /id="pFav"[^>]+aria-label="收藏"/);
  assert.match(html, /id="nowPlaying"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(html, /id="npTitle"/);
  assert.match(html, /id="npArtist"/);
  assert.match(html, /id="npMode"/);
  assert.match(html, /id="npLyricsToggle"/);
  assert.match(html, /id="lyricsPanel"/);
  assert.match(appJs, /history\.pushState\(\{ nowPlaying: true/);
  assert.match(appJs, /window\.addEventListener\("popstate"/);
  assert.match(appJs, /requested\.match\(\/\^song/);
  assert.match(appJs, /Player\.playIndex\(detailIndex, false\)/);
  assert.match(appJs, /Player\.toggleFav\(song\)/);
  assert.match(appJs, /parseSyncedLyrics/);
  assert.match(appJs, /Player\.cycleMode\(\)/);
  assert.match(css, /\.pctl \.icon-button\{width:44px;height:44px\}/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test("cheap API validation does not invoke upstream", async () => {
  const emptySearch = await fetch(`${base}/api/search?q=`);
  assert.equal(emptySearch.status, 200);
  assert.deepEqual(await emptySearch.json(), { query: "", results: [] });
  const missingStream = await fetch(`${base}/api/stream`);
  assert.equal(missingStream.status, 400);
  assert.equal(typeof (await missingStream.json()).error, "string");
  const missingLyrics = await fetch(`${base}/api/lyrics`);
  assert.equal(missingLyrics.status, 400);
});

test("lyrics endpoint returns synchronized and plain lyrics", async () => {
  const response = await fetch(`${base}/api/lyrics?title=${encodeURIComponent("测试歌曲")}&artist=${encodeURIComponent("测试歌手")}&duration=3:30`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.found, true);
  assert.match(body.syncedLyrics, /\[00:01\.00\]第一句/);
  assert.match(body.plainLyrics, /第二句/);
});

test("upstream failures return a short public message", async () => {
  const response = await fetch(`${base}/api/search?q=test&limit=1`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length <= 80);
  assert.doesNotMatch(body.error, /spawn|WARNING|Traceback|WinError/i);
});

test("package declares runtime and quality scripts", async () => {
  const pkg = JSON.parse(await readFile(join(serverDir, "package.json"), "utf8"));
  assert.equal(pkg.engines.node, ">=22.21.0");
  assert.equal(pkg.scripts.start, "node start.js");
  assert.ok(pkg.scripts.check && pkg.scripts.test && pkg.scripts["test:e2e"]);
});
