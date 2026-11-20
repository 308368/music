// API 客户端：同源优先；直接打开文件时回落到本机 8080。
const API = (() => {
  const BASE = location.protocol === "file:" ? "http://127.0.0.1:8080" : "";

  async function get(path, { signal, timeout = 65000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const forwardAbort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
      const response = await fetch(BASE + path, { signal: controller.signal, headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof body.error === "string" ? body.error : body.error?.message || body.message;
        throw new Error(message || `请求失败（${response.status}）`);
      }
      return body;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error.name === "AbortError") throw new Error("请求超时，请稍后重试");
      if (error instanceof TypeError) throw new Error("无法连接服务，请确认后端已启动");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  return {
    BASE,
    search: (q, limit = 50, options) => get(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`, options),
    stream: (id, options) => get(`/api/stream?id=${encodeURIComponent(id)}`, options),
    proxyUrl: (id) => `${BASE}/api/proxy?id=${encodeURIComponent(id)}`,
    lyrics: (song, options) => {
      const params = new URLSearchParams({
        title: song?._title || song?.title || "",
        artist: song?.channel || "",
        album: song?.album || "",
        duration: song?.duration || "",
      });
      return get(`/api/lyrics?${params}`, { timeout: 15000, ...options });
    },
    playlist: (n = 20, options) => get(`/api/playlist?n=${n}`, { timeout: 120000, ...options }),
    health: (options) => get("/health", { timeout: 5000, ...options }),
  };
})();
