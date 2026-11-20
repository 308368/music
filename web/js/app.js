const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (value) => String(value || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
let toastTimer;
const toast = (message) => {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
};
const userErrorMessage = (value) => {
  const message = String(value || "").replace(/\s+/g, " ").trim();
  if (!message) return "请求未完成，请稍后重试";
  if (/WARNING:|ERROR:|Traceback|WinError|PSConnection|\uFFFD/.test(message)) {
    return "媒体服务暂时不可用，请检查网络连接后重试";
  }
  return message.length > 160 ? `${message.slice(0, 157)}…` : message;
};
const loadingState = (label) => `<div class="loading" role="status"><span class="spinner"></span><span>${label}</span></div>`;
const errorState = (title, detail, action) => `<div class="empty-state error-state">${icon("refresh")}<p>${esc(title)}</p><span>${esc(userErrorMessage(detail))}</span><button class="secondary-button retry" type="button">${esc(action)}</button></div>`;

function go(view) {
  $$(".view").forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  $$(".tab").forEach((tab) => { const active = tab.dataset.go === view; tab.classList.toggle("active", active); active ? tab.setAttribute("aria-current", "page") : tab.removeAttribute("aria-current"); });
  $(".topbar .title").textContent = ({ home: "汽水音乐", search: "搜索", profile: "我的音乐" })[view];
  $("#searchShell").hidden = view !== "search";
  if (view === "search") setTimeout(() => $("#searchInput")?.focus(), 50);
  if (view === "profile") renderProfile();
  history.replaceState({ view }, "", `#${view}`);
  $("#mainContent").scrollTo({ top: 0, behavior: "instant" });
}

const songCard = (song, index) => `<button class="song-card" type="button" data-index="${index}" data-id="${esc(song.id)}" aria-label="播放 ${esc(song._title || song.title)}">
  <span class="cover-wrap"><img class="cover" loading="lazy" src="${esc(song.thumbnail)}" alt="" width="240" height="240">${song.duration ? `<span class="dur">${esc(song.duration)}</span>` : ""}</span>
  <span class="meta"><span class="t">${esc(song._title || song.title || "未知歌曲")}</span><span class="s">${esc(song.channel || "未知歌手")}</span></span>
</button>`;

async function loadHome() {
  const el = $("#homeView"); el.innerHTML = loadingState("正在准备推荐歌曲");
  try {
    const { results = [] } = await API.playlist(20);
    if (!results.length) { el.innerHTML = errorState("暂时没有推荐", "稍后再来看看", "重新加载"); }
    else {
      results.forEach((song) => { song._title = song.query || song.title; });
      el.innerHTML = `<header class="section-h"><h2>今天听点什么</h2><span>${results.length} 首精选</span></header><div class="grid">${results.map(songCard).join("")}</div>`;
      Player.seedQueue(results);
      $$(".song-card", el).forEach((card) => card.addEventListener("click", () => Player.playQueue(results, results[Number(card.dataset.index)].id)));
      bindPlayingState(el);
    }
  } catch (error) { el.innerHTML = errorState("推荐加载失败", error.message, "重新加载"); }
  $(".retry", el)?.addEventListener("click", loadHome);
}

const listItem = (song, index, actions = false) => `<div class="list-item" data-index="${index}" data-id="${esc(song.id)}">
  <button class="song-main" type="button" aria-label="播放 ${esc(song._title || song.title)}"><img class="cover" loading="lazy" src="${esc(song.thumbnail)}" alt="" width="52" height="52"><span class="meta"><span class="t">${esc(song._title || song.title || "未知歌曲")}</span><span class="s">${esc(song.channel || "未知歌手")}</span></span><span class="dur">${esc(song.duration || "")}</span></button>
  ${actions ? `<button class="icon-button fav-btn" type="button" aria-label="收藏">${icon("heart")}</button><button class="icon-button add-next" type="button" aria-label="下一首播放">${icon("plus")}</button>` : ""}
</div>`;

function bindList(el, list, actions = false) {
  $$(".list-item", el).forEach((row) => {
    const song = list[Number(row.dataset.index)];
    $(".song-main", row).addEventListener("click", () => Player.playQueue(list, song.id));
    if (!actions) return;
    const fav = $(".fav-btn", row);
    const updateFav = () => { const active = Player.isFav(song.id); fav.classList.toggle("active", active); fav.setAttribute("aria-label", active ? "取消收藏" : "收藏"); };
    fav.addEventListener("click", () => { const active = Player.toggleFav(song); updateFav(); toast(active ? "已加入收藏" : "已取消收藏"); });
    $(".add-next", row).addEventListener("click", () => toast(Player.appendNext(song) ? "已加入下一首" : "这首歌已在播放器中"));
    updateFav();
  });
  bindPlayingState(el);
}

function bindPlayingState(el) {
  const id = Player.current()?.id;
  $$('[data-id]', el).forEach((row) => row.classList.toggle("is-playing", row.dataset.id === id));
}

let searchTimer;
let searchController;
function onSearchInput(value) {
  clearTimeout(searchTimer); searchController?.abort();
  searchTimer = setTimeout(() => doSearch(value), 320);
}
async function doSearch(raw) {
  const query = raw.trim(); const el = $("#searchView");
  if (!query) { el.innerHTML = `<div class="empty-state">${icon("search")}<p>搜索想听的歌</p><span>输入歌曲或歌手名称开始搜索</span></div>`; return; }
  const controller = new AbortController();
  searchController = controller;
  el.innerHTML = loadingState(`正在搜索“${esc(query)}”`);
  try {
    const { results = [] } = await API.search(query, 50, { signal: controller.signal });
    if (controller !== searchController) return;
    if (!results.length) { el.innerHTML = `<div class="empty-state">${icon("search")}<p>没有找到相关歌曲</p><span>换个歌名或歌手试试</span></div>`; return; }
    results.forEach((song) => { song._title = song.title || query; });
    el.innerHTML = `<header class="section-h"><h2>搜索结果</h2><span>${results.length} 首</span></header><div class="list">${results.map((song, i) => listItem(song, i, true)).join("")}</div>`;
    bindList(el, results, true);
  } catch (error) {
    if (controller.signal.aborted || controller !== searchController) return;
    el.innerHTML = errorState("搜索失败", error.message, "重试");
    $(".retry", el)?.addEventListener("click", () => doSearch(query));
  }
}

function renderProfile() {
  const el = $("#profileView"); const favs = Player.favs(); const historyItems = Player.history();
  const section = (items, title, empty) => `<section class="library-section"><header class="section-h"><h2>${title}</h2><span>${items.length ? `${items.length} 首` : ""}</span></header>${items.length ? `<div class="list">${items.map((song, i) => listItem(song, i)).join("")}</div>` : `<div class="library-empty">${empty}</div>`}</section>`;
  el.innerHTML = `<div class="profile-head"><span class="avatar">${icon("music")}</span><div><strong>本地音乐库</strong><span>收藏 ${favs.length} · 最近播放 ${historyItems.length}</span></div></div>${section(favs, "我的收藏", "在搜索结果中收藏喜欢的歌曲")}${section(historyItems, "最近播放", "播放过的歌曲会出现在这里")}`;
  const sections = $$(".library-section", el);
  if (favs.length) bindList(sections[0], favs);
  if (historyItems.length) bindList(sections[1], historyItems);
}

function bindPlayerBar() {
  const bar = $("#player"), play = $("#pPlay"), progress = $("#pProgress"), miniFav = $("#pFav");
  const nowPlaying = $("#nowPlaying"), npPlay = $("#npPlay"), npSeek = $("#npSeek"), npFav = $("#npFav");
  const backgroundSurfaces = [$(".topbar"), $("#mainContent"), $(".tabbar"), bar];
  let queueSignature = "";
  let seekDragging = false;
  let restoreFocus = null;
  let closeTimer = null;
  let lyricsOpen = false;
  let lyricsSongId = "";
  let lyricsLines = [];
  let activeLyricIndex = -1;
  let lyricsController = null;
  const lyricsCache = new Map();
  const lyricsPanel = $("#lyricsPanel"), lyricsContent = $("#lyricsContent"), lyricsToggle = $("#npLyricsToggle"), npCover = $("#npCover"), modeButton = $("#npMode");
  const modeMeta = {
    sequence: { label: "顺序播放", icon: "sequence" },
    "repeat-one": { label: "单曲循环", icon: "repeat-one" },
    shuffle: { label: "随机播放", icon: "shuffle" },
  };
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  const coverUrl = (value) => {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? `url("${url.href.replace(/"/g, "%22")}")` : ""; }
    catch { return ""; }
  };
  const setFavoriteButton = (button, active) => {
    button.classList.toggle("active", active);
    button.setAttribute("aria-label", active ? "取消收藏" : "收藏");
    button.setAttribute("aria-pressed", String(active));
  };
  const toggleCurrentFavorite = () => {
    const song = Player.current();
    if (!song) return;
    toast(Player.toggleFav(song) ? "已加入收藏" : "已取消收藏");
  };
  const parseSyncedLyrics = (source) => {
    const lines = [];
    String(source || "").split(/\r?\n/).forEach((raw) => {
      const timestamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g)];
      const text = raw.replace(/\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g, "").trim();
      if (!text) return;
      timestamps.forEach((match) => lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text }));
    });
    return lines.sort((a, b) => a.time - b.time);
  };
  const renderLyricsState = (title, detail, retry = false) => {
    lyricsContent.innerHTML = `<div class="lyrics-state">${icon(retry ? "refresh" : "lyrics")}<strong>${esc(title)}</strong><span>${esc(detail)}</span>${retry ? '<button class="secondary-button lyrics-retry" type="button">重新加载</button>' : ""}</div>`;
    $(".lyrics-retry", lyricsContent)?.addEventListener("click", () => loadLyrics(Player.current(), { refresh: true }));
  };
  const renderLyrics = (result) => {
    lyricsLines = parseSyncedLyrics(result.syncedLyrics);
    activeLyricIndex = -1;
    if (result.instrumental) { renderLyricsState("纯音乐", "这首歌没有人声歌词"); return; }
    if (lyricsLines.length) {
      lyricsContent.innerHTML = lyricsLines.map((line, index) => `<button class="lyric-line" type="button" data-lyric-index="${index}" data-time="${line.time}" aria-label="歌词：${esc(line.text)}，跳转到 ${formatTime(line.time)}">${esc(line.text)}</button>`).join("");
      $$(".lyric-line", lyricsContent).forEach((line) => line.addEventListener("click", () => Player.seek(Number(line.dataset.time) / Player.duration)));
      updateActiveLyric();
      return;
    }
    if (result.plainLyrics) { lyricsContent.innerHTML = `<p class="lyrics-plain">${esc(result.plainLyrics)}</p>`; return; }
    renderLyricsState("暂时没有歌词", "这首歌还没有可用的歌词");
  };
  const loadLyrics = async (song, { refresh = false } = {}) => {
    if (!song) return;
    lyricsController?.abort();
    const controller = new AbortController();
    lyricsController = controller;
    lyricsSongId = song.id;
    lyricsLines = [];
    activeLyricIndex = -1;
    renderLyricsState("正在加载歌词", "马上就好");
    try {
      let result = !refresh && lyricsCache.get(song.id);
      if (!result) {
        result = await API.lyrics(song, { signal: controller.signal });
        lyricsCache.set(song.id, result);
      }
      if (lyricsSongId !== song.id) return;
      renderLyrics(result);
    } catch (error) {
      if (controller.signal.aborted || lyricsSongId !== song.id) return;
      renderLyricsState("歌词加载失败", userErrorMessage(error.message), true);
    }
  };
  const setLyricsOpen = (open) => {
    lyricsOpen = Boolean(open);
    npCover.hidden = lyricsOpen;
    lyricsPanel.hidden = !lyricsOpen;
    lyricsToggle.classList.toggle("active", lyricsOpen);
    lyricsToggle.setAttribute("aria-expanded", String(lyricsOpen));
    lyricsToggle.setAttribute("aria-label", lyricsOpen ? "显示封面" : "显示歌词");
    if (lyricsOpen && Player.current() && lyricsSongId !== Player.current().id) loadLyrics(Player.current());
  };
  const updateActiveLyric = () => {
    if (!lyricsOpen || !lyricsLines.length) return;
    let nextIndex = -1;
    for (let index = 0; index < lyricsLines.length && lyricsLines[index].time <= Player.currentTime + .08; index += 1) nextIndex = index;
    if (nextIndex === activeLyricIndex) return;
    activeLyricIndex = nextIndex;
    $$(".lyric-line", lyricsContent).forEach((line, index) => {
      const active = index === activeLyricIndex;
      line.classList.toggle("active", active);
      active ? line.setAttribute("aria-current", "true") : line.removeAttribute("aria-current");
    });
    if (activeLyricIndex >= 0) {
      const activeLine = $$(".lyric-line", lyricsContent)[activeLyricIndex];
      activeLine?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  };
  const syncModeButton = () => {
    const meta = modeMeta[Player.mode];
    modeButton.innerHTML = icon(meta.icon);
    modeButton.dataset.mode = Player.mode;
    modeButton.classList.toggle("active", Player.mode !== "sequence");
    modeButton.setAttribute("aria-label", `播放模式：${meta.label}，点击切换`);
  };
  const renderQueue = () => {
    const list = Player.queue;
    const signature = `${Player.index}:${Player.paused}:${list.map((song) => song.id).join("|")}`;
    if (signature === queueSignature) return;
    queueSignature = signature;
    $("#queueCount").textContent = `${list.length} 首`;
    $("#queueList").innerHTML = list.map((song, index) => `<button class="queue-item${index === Player.index ? " active" : ""}" type="button" data-queue-index="${index}" aria-current="${index === Player.index ? "true" : "false"}"><span class="queue-number">${index === Player.index ? icon(Player.paused ? "play" : "music") : index + 1}</span><span class="queue-meta"><strong>${esc(song._title || song.title || "未知歌曲")}</strong><span>${esc(song.channel || "未知歌手")}</span></span><span class="dur">${esc(song.duration || "")}</span></button>`).join("");
    $$(".queue-item", $("#queueList")).forEach((item) => item.addEventListener("click", () => Player.playIndex(Number(item.dataset.queueIndex))));
  };
  const detailUrl = (song) => `#song/${encodeURIComponent(song.id)}`;
  const openNowPlaying = ({ updateHistory = true } = {}) => {
    if (!Player.current()) return;
    if (!nowPlaying.hidden) return;
    clearTimeout(closeTimer);
    restoreFocus = document.activeElement;
    backgroundSurfaces.forEach((surface) => { surface.inert = true; });
    nowPlaying.hidden = false;
    $("#app").classList.add("now-playing-open");
    if (updateHistory) history.pushState({ nowPlaying: true, view: history.state?.view || "home" }, "", detailUrl(Player.current()));
    requestAnimationFrame(() => { nowPlaying.classList.add("open"); $("#npClose").focus(); });
  };
  const closeNowPlaying = ({ fromHistory = false } = {}) => {
    if (nowPlaying.hidden) return;
    if (!fromHistory && history.state?.nowPlaying) { history.back(); return; }
    nowPlaying.classList.remove("open");
    $("#app").classList.remove("now-playing-open");
    closeTimer = setTimeout(() => { nowPlaying.hidden = true; backgroundSurfaces.forEach((surface) => { surface.inert = false; }); restoreFocus?.focus?.(); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 240);
  };
  $("#miniOpen").addEventListener("click", openNowPlaying);
  play.addEventListener("click", Player.toggle); $("#pPrev").addEventListener("click", Player.prev); $("#pNext").addEventListener("click", Player.next);
  miniFav.addEventListener("click", toggleCurrentFavorite);
  npFav.addEventListener("click", toggleCurrentFavorite); npPlay.addEventListener("click", Player.toggle);
  $("#npPrev").addEventListener("click", Player.prev); $("#npNext").addEventListener("click", Player.next);
  modeButton.addEventListener("click", () => { const mode = Player.cycleMode(); toast(`已切换为${modeMeta[mode].label}`); });
  npCover.addEventListener("click", () => setLyricsOpen(true));
  lyricsToggle.addEventListener("click", () => setLyricsOpen(!lyricsOpen));
  $("#npClose").addEventListener("click", closeNowPlaying);
  $("#queueToggle").addEventListener("click", () => {
    const panel = $("#queuePanel"); const expanded = panel.hidden;
    panel.hidden = !expanded; $("#queueToggle").setAttribute("aria-expanded", String(expanded));
    if (expanded) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  progress.addEventListener("click", (event) => { const rect = progress.getBoundingClientRect(); Player.seek((event.clientX - rect.left) / rect.width); });
  progress.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return; event.preventDefault(); Player.seek((Player.currentTime + (event.key === "ArrowRight" ? 5 : -5)) / Player.duration); });
  npSeek.addEventListener("pointerdown", () => { seekDragging = true; });
  npSeek.addEventListener("pointerup", () => { seekDragging = false; Player.seek(Number(npSeek.value) / 1000); });
  npSeek.addEventListener("pointercancel", () => { seekDragging = false; });
  npSeek.addEventListener("change", () => { seekDragging = false; Player.seek(Number(npSeek.value) / 1000); });
  npSeek.addEventListener("input", () => { if (seekDragging) $("#npCurrent").textContent = formatTime(Player.duration * Number(npSeek.value) / 1000); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !nowPlaying.hidden) { event.preventDefault(); closeNowPlaying(); } });
  window.addEventListener("popstate", (event) => {
    if (event.state?.nowPlaying) openNowPlaying({ updateHistory: false });
    else closeNowPlaying({ fromHistory: true });
  });
  Player.on(() => {
    const song = Player.current(); if (!song) { bar.classList.remove("show"); return; }
    bar.classList.add("show"); const cover = $("#pCover"); cover.style.backgroundImage = coverUrl(song.thumbnail); cover.classList.toggle("has-src", Boolean(song.thumbnail));
    $("#pTitle").textContent = song._title || song.title || "未知歌曲"; $("#pSub").textContent = Player.error || song.channel || "";
    $("#miniOpen").setAttribute("aria-label", `打开 ${song._title || song.title || "当前歌曲"} 的播放详情`);
    play.innerHTML = icon(Player.waiting ? "refresh" : Player.paused ? "play" : "pause"); play.classList.toggle("waiting", Player.waiting); play.setAttribute("aria-label", Player.paused ? "播放" : "暂停");
    const value = Player.duration ? Math.round(Player.currentTime / Player.duration * 100) : 0; $("#pFill").style.width = `${value}%`; progress.setAttribute("aria-valuenow", value);
    const favorite = Player.isFav(song.id); setFavoriteButton(miniFav, favorite); setFavoriteButton(npFav, favorite);
    $("#npCover").style.backgroundImage = coverUrl(song.thumbnail);
    $("#npTitle").textContent = song._title || song.title || "未知歌曲"; $("#npArtist").textContent = song.channel || "未知歌手";
    npPlay.innerHTML = icon(Player.waiting ? "refresh" : Player.paused ? "play" : "pause"); npPlay.classList.toggle("waiting", Player.waiting); npPlay.setAttribute("aria-label", Player.paused ? "播放" : "暂停");
    if (!seekDragging) npSeek.value = Player.duration ? Math.round(Player.currentTime / Player.duration * 1000) : 0;
    $("#npCurrent").textContent = formatTime(Player.currentTime); $("#npDuration").textContent = formatTime(Player.duration);
    syncModeButton();
    if (lyricsOpen && lyricsSongId !== song.id) loadLyrics(song);
    updateActiveLyric();
    if (!nowPlaying.hidden && history.state?.nowPlaying && location.hash !== detailUrl(song)) history.replaceState({ ...history.state, nowPlaying: true }, "", detailUrl(song));
    renderQueue();
  });
  Player.audio.dispatchEvent(new Event("durationchange"));
  return { openNowPlaying };
}

document.addEventListener("DOMContentLoaded", () => {
  $("#searchInput").addEventListener("input", (event) => onSearchInput(event.target.value));
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => go(tab.dataset.go)));
  const requested = location.hash.slice(1);
  const detailMatch = requested.match(/^song\/(.+)$/);
  let highlightedId;
  Player.on(() => {
    const id = Player.current()?.id;
    if (id !== highlightedId) {
      highlightedId = id;
      bindPlayingState($("#mainContent"));
    }
  });
  const playerUi = bindPlayerBar();
  go(["home", "search", "profile"].includes(requested) ? requested : history.state?.view || "home");
  if (detailMatch) {
    let requestedId = "";
    try { requestedId = decodeURIComponent(detailMatch[1]); } catch {}
    const detailIndex = Player.queue.findIndex((song) => song.id === requestedId);
    if (detailIndex >= 0) {
      if (detailIndex !== Player.index) Player.playIndex(detailIndex, false);
      history.replaceState({ nowPlaying: true, view: "home" }, "", `#song/${encodeURIComponent(requestedId)}`);
      playerUi.openNowPlaying({ updateHistory: false });
    }
  }
  loadHome();
  API.health().then(() => $(".status-dot").classList.add("online")).catch(() => {});
  document.addEventListener("keydown", (event) => { if (event.code === "Space" && !/INPUT|BUTTON|TEXTAREA/.test(event.target.tagName)) { event.preventDefault(); Player.toggle(); } });
});
