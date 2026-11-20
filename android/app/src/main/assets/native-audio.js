// The existing queue owns track selection. Android owns the one active audio decoder.
(() => {
  const bridge = window.AndroidAudio;
  if (!bridge) return;

  const emptyState = () => ({ currentTime: 0, duration: 0, paused: true, readyState: 0, ended: false });
  const sourceId = (src) => {
    try { return new URL(src, location.href).searchParams.get("id"); }
    catch { return null; }
  };
  let audio;
  class NativeAudio extends EventTarget {
    constructor() {
      super();
      this.state = emptyState();
      this.source = "";
      this.ticket = "";
      this.attaching = false;
      audio = this;
    }
    get src() { return this.source; }
    set src(value) {
      const song = Player.current();
      this.source = String(value);
      this.ticket = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
      this.state = emptyState();
      if (!bridge.load(this.source, song?._title || song?.title || "", song?.channel || "", this.ticket)) {
        this.source = "";
        queueMicrotask(() => this.dispatchEvent(new Event("error")));
      }
    }
    get paused() { return this.state.paused; }
    get duration() { return this.state.duration || NaN; }
    get ended() { return this.state.ended; }
    get readyState() { return this.state.readyState; }
    get currentTime() { return this.state.currentTime; }
    set currentTime(seconds) {
      if (this.attaching || !Number.isFinite(seconds) || seconds < 0) return;
      this.state.currentTime = seconds;
      bridge.seek(seconds);
    }
    play() {
      bridge.setPlaying(true);
      return Promise.resolve();
    }
    pause() { bridge.setPlaying(false); }
  }

  window.Audio = NativeAudio;
  window.receiveNativeAudio = (event, state, ticket) => {
    if (!audio) return;
    if (event === "disconnect") {
      audio.source = "";
      audio.ticket = "";
      audio.state = emptyState();
      audio.dispatchEvent(new Event("pause"));
      return;
    }
    if (audio.ticket && ticket !== audio.ticket) return;
    if (!state.src || sourceId(state.src) !== Player.current()?.id) return;
    const attaching = !audio.source;
    audio.source = state.src;
    audio.ticket = ticket;
    audio.state = state;
    if (attaching && state.readyState >= 1) {
      // A surviving service has a more recent position than localStorage.
      audio.attaching = true;
      try { audio.dispatchEvent(new Event("loadedmetadata")); }
      finally { audio.attaching = false; }
    }
    if (event === "nexttrack") Player.next();
    else if (event === "previoustrack") Player.prev();
    else {
      // Clearing src lets the player's next play gesture reopen a failed stream.
      if (event === "error") audio.source = "";
      audio.dispatchEvent(new Event(event === "sync" ? "durationchange" : event));
    }
  };
  const currentDay = () => {
    const date = new Date();
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  };
  let homeDay = currentDay();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && homeDay !== currentDay()) {
      homeDay = currentDay();
      loadHome();
    }
  });
  document.addEventListener("DOMContentLoaded", () => bridge.ready(), { once: true });
})();
