// 常驻播放器：音频代理、播放队列、本地历史与收藏。
const Player = (() => {
  const audio = new Audio();
  audio.preload = "metadata";
  let queue = [];
  let index = -1;
  let error = "";
  let resumePosition = 0;
  let lastSavedPosition = 0;
  const modes = ["sequence", "repeat-one", "shuffle"];
  let mode = "sequence";
  let shuffleHistory = [];
  const subs = new Set();
  const on = (fn) => { subs.add(fn); return () => subs.delete(fn); };
  const emit = () => subs.forEach((fn) => { try { fn(); } catch {} });

  const readArray = (key) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string") : [];
    } catch { return []; }
  };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  try {
    const saved = JSON.parse(localStorage.getItem("luna_player") || "{}");
    if (Array.isArray(saved.queue)) queue = saved.queue.filter((item) => item && typeof item.id === "string");
    if (Number.isInteger(saved.index) && saved.index >= 0 && saved.index < queue.length) index = saved.index;
    if (modes.includes(saved.mode)) mode = saved.mode;
    const progress = JSON.parse(localStorage.getItem("luna_progress") || "null");
    if (queue[index] && progress?.id === queue[index].id && Number.isFinite(progress.seconds) && progress.seconds > 0) {
      resumePosition = progress.seconds;
    }
  } catch {}
  const save = () => write("luna_player", { queue, index, mode });
  const history = () => readArray("luna_history");
  const favs = () => readArray("luna_favs");
  const pushHistory = (song) => write("luna_history", [song, ...history().filter((x) => x.id !== song.id)].slice(0, 50));
  const toggleFav = (song) => {
    const list = favs();
    const found = list.findIndex((x) => x.id === song.id);
    if (found >= 0) list.splice(found, 1); else list.unshift(song);
    write("luna_favs", list.slice(0, 200));
    emit();
    return found < 0;
  };
  const isFav = (id) => favs().some((x) => x.id === id);
  const current = () => index >= 0 && index < queue.length ? queue[index] : null;
  const savePosition = (seconds) => {
    if (!current() || !Number.isFinite(seconds)) return;
    lastSavedPosition = seconds;
    write("luna_progress", { id: current().id, seconds });
  };
  const capturePosition = () => {
    if (audio.src && audio.readyState >= 1 && !resumePosition) {
      savePosition(audio.ended ? 0 : audio.currentTime);
    }
  };

  const syncMediaSession = (song) => {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window) || !song) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song._title || song.title || "未知歌曲", artist: song.channel || "",
      artwork: song.thumbnail ? [{ src: song.thumbnail }] : [],
    });
  };
  const playIndex = (nextIndex, autoplay = true, { remember = true, startAt = 0 } = {}) => {
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= queue.length) return false;
    if (mode === "shuffle" && remember && index >= 0 && index !== nextIndex) {
      shuffleHistory.push(index);
      shuffleHistory = shuffleHistory.slice(-100);
    }
    index = nextIndex;
    const song = queue[index];
    error = "";
    resumePosition = startAt;
    savePosition(startAt);
    audio.src = API.proxyUrl(song.id);
    syncMediaSession(song);
    pushHistory(song);
    save(); emit();
    if (autoplay) audio.play().catch(() => {});
    return true;
  };
  const playQueue = (list, startId, autoplay = true) => {
    const songs = Array.isArray(list) ? list.filter((song) => song?.id) : [];
    if (!songs.length) return false;
    queue = songs;
    shuffleHistory = [];
    const found = startId ? queue.findIndex((song) => song.id === startId) : 0;
    return playIndex(found >= 0 ? found : 0, autoplay, { remember: false });
  };
  const seedQueue = (list) => {
    if (!current() && Array.isArray(list) && list.length) { queue = list.filter((song) => song?.id); index = -1; save(); }
  };
  const appendNext = (song) => {
    if (!song?.id || current()?.id === song.id) return false;
    const found = queue.findIndex((item) => item.id === song.id);
    if (found >= 0) {
      queue.splice(found, 1);
      if (found < index) index--;
    }
    queue.splice(Math.max(0, index + 1), 0, song);
    if (index < 0) index = 0;
    shuffleHistory = [];
    save(); emit();
    return true;
  };
  const randomIndex = () => {
    if (queue.length < 2) return index;
    let candidate = index;
    while (candidate === index) candidate = Math.floor(Math.random() * queue.length);
    return candidate;
  };
  const next = (fromEnded = false) => {
    if (!current()) return false;
    if (fromEnded === true && mode === "repeat-one") {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      emit();
      return true;
    }
    if (mode === "shuffle") return playIndex(randomIndex());
    return index < queue.length - 1 && playIndex(index + 1);
  };
  const prev = () => {
    if (audio.currentTime > 4) { audio.currentTime = 0; return true; }
    if (mode === "shuffle" && shuffleHistory.length) {
      return playIndex(shuffleHistory.pop(), true, { remember: false });
    }
    return index > 0 && playIndex(index - 1);
  };
  const cycleMode = () => {
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    shuffleHistory = [];
    save(); emit();
    return mode;
  };
  const toggle = async () => {
    if (!current()) return;
    try {
      if (!audio.src) { playIndex(index, true, { startAt: resumePosition }); return; }
      if (audio.paused) await audio.play(); else audio.pause();
    }
    catch { error = "浏览器阻止了播放，请再次点击播放"; emit(); }
  };
  const seek = (fraction) => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
  };

  ["timeupdate", "durationchange", "play", "pause", "waiting", "canplay"].forEach((event) => audio.addEventListener(event, emit));
  audio.addEventListener("error", () => { error = "播放失败，音频链接可能已失效"; emit(); });
  audio.addEventListener("loadedmetadata", () => {
    if (!resumePosition) return;
    const position = resumePosition;
    resumePosition = 0;
    if (!Number.isFinite(audio.duration) || position < audio.duration) audio.currentTime = position;
    capturePosition();
    emit();
  });
  audio.addEventListener("timeupdate", () => {
    if (Math.abs(audio.currentTime - lastSavedPosition) >= 5) capturePosition();
  });
  audio.addEventListener("pause", capturePosition);
  audio.addEventListener("seeked", capturePosition);
  window.addEventListener?.("pagehide", capturePosition);
  audio.addEventListener("ended", () => { savePosition(0); if (!next(true)) emit(); });
  if ("mediaSession" in navigator) {
    const setMediaAction = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    };
    setMediaAction("play", () => audio.play());
    setMediaAction("pause", () => audio.pause());
    setMediaAction("previoustrack", prev);
    setMediaAction("nexttrack", next);
    setMediaAction("seekto", ({ seekTime }) => { if (Number.isFinite(seekTime)) audio.currentTime = seekTime; });
  }
  return {
    audio, on, current, playIndex, playQueue, seedQueue, appendNext, next, prev, toggle, seek, cycleMode,
    get queue() { return queue.slice(); }, get index() { return index; },
    get paused() { return audio.paused; }, get currentTime() { return resumePosition || audio.currentTime || 0; },
    get duration() { return audio.duration || 0; }, get waiting() { return audio.readyState < 3 && !audio.paused; },
    get error() { return error; }, get mode() { return mode; }, history, favs, toggleFav, isFav,
  };
})();
