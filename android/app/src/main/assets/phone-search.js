function initPhoneSearch() {
  const view = $("#searchView"), input = $("#searchInput"), main = $("#mainContent");
  const labels = { song: "歌曲", lyric: "歌词", artist: "歌手", playlist: "歌单" };
  const prompts = { song: "输入歌曲名称", lyric: "输入记得的一句歌词", artist: "输入歌手名称", playlist: "输入歌单名称" };
  const sources = { neko: "Neko", netease: "网易云音乐", qq: "QQ 音乐", qishui: "汽水音乐" };
  let kind = "song", timer, searchJob, detailJob, detailKey, returnScroll = 0, returnFocus;
  const chevron = '<svg class="search-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
  view.innerHTML = '<div class="search-types" role="group" aria-label="搜索分类"></div><div id="phoneResults"></div><div id="searchDetail" hidden></div>';
  const types = $(".search-types", view), results = $("#phoneResults", view), detail = $("#searchDetail", view);
  types.innerHTML = Object.entries(labels).map(([key, label]) => `<button type="button" data-kind="${key}">${label}</button>`).join("");
  const empty = (message) => `<div class="empty-state" role="status">${icon("search")}<p>${esc(message)}</p></div>`;

  function setKind(next) {
    kind = next;
    input.placeholder = prompts[kind];
    input.setAttribute("aria-label", prompts[kind]);
    $$("button", types).forEach(button => button.setAttribute("aria-pressed", String(button.dataset.kind === kind)));
  }

  function renderTracks(target, tracks) {
    target.innerHTML = tracks.map((song, index) => listItem(song, index, true)).join("");
    $$(".list-item", target).forEach((row, i) => {
      if (!tracks[i].snippet) return;
      const snippet = document.createElement("span");
      snippet.className = "lyric-hit";
      snippet.textContent = tracks[i].snippet;
      $(".meta", row).append(snippet);
    });
    bindList(target, tracks, true);
  }

  function renderChoices(target, rows, playlist) {
    const activeId = document.activeElement?.dataset.choice;
    target.innerHTML = rows.map((row, index) => {
      const subtitle = playlist ? [sources[row.source], row.owner, Number.isInteger(row.count) ? row.count + " 首" : ""].filter(Boolean).join(" · ") : "";
      const key = playlist ? row.source + "/" + row.id : row.name;
      return `<button class="search-choice" type="button" data-index="${index}" data-choice="${esc(key)}">
        <span class="search-choice-symbol">${icon(playlist ? "queue" : "user")}</span>
        <span class="search-choice-meta"><strong>${esc(row.name)}</strong>${subtitle ? `<small>${esc(subtitle)}</small>` : ""}</span>${chevron}</button>`;
    }).join("");
    $$("button", target).forEach((button, index) => {
      button.addEventListener("click", () => {
        const row = rows[index];
        returnScroll = main.scrollTop;
        returnFocus = button.dataset.choice;
        const entry = { kind, query: input.value, name: row.name, id: row.id, source: row.source };
        history.pushState({ view: "search", searchDetail: entry }, "", "#search/detail");
        openDetail(entry);
      });
      if (activeId && button.dataset.choice === activeId) button.focus({ preventScroll: true });
    });
  }

  function renderError(target, message, error, retry) {
    target.innerHTML = errorState(message, error.message, "重试");
    $(".retry", target).addEventListener("click", retry);
  }

  async function playlists(query, job) {
    const found = new Map(), failed = new Set(), pending = new Set(Object.keys(sources));
    results.innerHTML = '<div class="list"></div><div class="search-progress" role="status"></div>';
    const list = $(".list", results), progress = $(".search-progress", results);
    function paint() {
      if (job.signal.aborted) return;
      const sorted = Array.from(found.values()).sort((a,b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"));
      renderChoices(list, sorted, true);
      const notes = [];
      if (pending.size) notes.push("正在查询" + Array.from(pending, k => sources[k]).join("、"));
      if (failed.size) notes.push(Array.from(failed, k => sources[k]).join("、") + "暂时无法查询");
      if (!pending.size && !sorted.length && failed.size < Object.keys(sources).length) notes.push("没有找到匹配的歌单");
      progress.textContent = notes.join("。");
      if (!pending.size && failed.size) {
        const retry = document.createElement("button");
        retry.className = "secondary-button";
        retry.textContent = "重试失败来源";
        retry.onclick = () => {
          const keys = Array.from(failed);
          failed.clear();
          keys.forEach(k => pending.add(k));
          paint();
          keys.forEach(load);
        };
        progress.append(retry);
      }
    }
    async function load(source) {
      try {
        const data = await API.searchTyped({ q: query, type: "playlist", source, limit: 18 }, { signal: job.signal, timeout: 35000 });
        for (const item of data.results) {
          if (!item.id || !item.name) continue;
          found.set(source + "/" + item.id, { ...item, source, score: Number(item.score) || 0 });
        }
        if (data.partial) failed.add(source);
      } catch { failed.add(source); }
      pending.delete(source);
      paint();
    }
    paint();
    await Promise.all(Array.from(pending, load));
  }

  async function runSearch(query, job) {
    if (kind === "playlist") return playlists(query, job);
    try {
      const data = await API.searchTyped({ q: query, type: kind, limit: 50 }, { signal: job.signal });
      if (job.signal.aborted) return;
      if (!data.results.length) { results.innerHTML = empty("没有找到匹配的" + labels[kind]); return; }
      results.innerHTML = '<div class="list"></div>';
      if (kind === "artist") renderChoices($(".list", results), data.results, false);
      else renderTracks($(".list", results), data.results);
    } catch (error) {
      if (!job.signal.aborted) renderError(results, "搜索失败", error, () => schedule(false));
    }
  }
  function schedule(debounce) {
    clearTimeout(timer);
    searchJob?.abort();
    const query = input.value.trim(), job = new AbortController();
    searchJob = job;
    results.innerHTML = query ? loadingState("正在搜索" + labels[kind]) : empty(prompts[kind]);
    if (query) timer = setTimeout(() => runSearch(query, job), debounce ? 320 : 0);
  }

  function closeDetail(restore = true) {
    if (detail.hidden) return;
    detailJob?.abort();
    detailKey = null;
    detail.hidden = true;
    main.classList.remove("search-detail-open");
    types.hidden = results.hidden = false;
    if (restore) {
      main.scrollTop = returnScroll;
      const button = $$("[data-choice]", results).find(b => b.dataset.choice === returnFocus);
      button?.focus({ preventScroll: true });
    }
  }
  async function openDetail(entry) {
    detailJob?.abort();
    const job = new AbortController();
    detailJob = job;
    detailKey = entry;
    detail.hidden = false;
    types.hidden = results.hidden = true;
    main.classList.add("search-detail-open");
    main.scrollTop = 0;
    detail.innerHTML = `<button class="search-back" type="button">${chevron}返回搜索</button><h2 class="page-title">${esc(entry.name)}</h2><div class="search-detail-body"></div>`;
    const back = $(".search-back", detail), body = $(".search-detail-body", detail);
    back.onclick = () => history.back();
    back.focus({ preventScroll: true });
    body.innerHTML = loadingState("正在加载曲目");
    const playlist = entry.kind === "playlist";
    try {
      const data = playlist
        ? await API.playlistDetail({ id: entry.id, source: entry.source }, { signal: job.signal, timeout: 120000 })
        : await API.searchTyped({ type: "artistTracks", q: entry.name, limit: 50 }, { signal: job.signal });
      if (job.signal.aborted) return;
      const entries = data.results;
      const playable = playlist ? entries.map(row => row.track).filter(Boolean) : entries;
      body.innerHTML = '<div class="search-detail-head"><span></span><button class="search-play-all" type="button">' + icon("play") + '播放全部</button></div><div class="list"></div>';
      $(".search-detail-head span", body).textContent = playlist
        ? sources[entry.source] + " · 已匹配 " + playable.length + " / " + entries.length + " 首"
        : playable.length + " 首作品";
      const playAll = $(".search-play-all", body);
      playAll.disabled = !playable.length;
      playAll.onclick = () => Player.playQueue(playable);
      const list = $(".list", body);
      if (!entries.length) { list.innerHTML = empty("暂无曲目"); return; }
      renderTracks(list, playable);
      if (playlist) {
        const rows = Array.from(list.children);
        let n = 0;
        const fragment = document.createDocumentFragment();
        for (const row of entries) {
          if (row.track) { fragment.append(rows[n++]); continue; }
          const item = document.createElement("div");
          item.className = "search-unmatched";
          item.innerHTML = `<span><strong>${esc(row.title)}</strong><small>${esc(row.channel)}</small></span><small>曲库未匹配</small>`;
          fragment.append(item);
        }
        list.replaceChildren(fragment);
      }
    } catch (error) {
      if (!job.signal.aborted) renderError(body, "曲目加载失败", error, () => openDetail(entry));
    }
  }
  types.addEventListener("click", event => {
    const key = event.target.closest("[data-kind]")?.dataset.kind;
    if (!key || key === kind) return;
    setKind(key);
    schedule(false);
  });
  input.addEventListener("input", event => {
    if (!event.isComposing) schedule(true);
  });
  input.addEventListener("compositionend", () => schedule(true));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) { input.blur(); schedule(false); }
  });
  window.addEventListener("popstate", event => {
    if (event.state?.nowPlaying) return;
    const entry = event.state?.searchDetail;
    if (entry && view.classList.contains("active")) {
      if (entry.kind !== detailKey?.kind || entry.name !== detailKey?.name || entry.id !== detailKey?.id || entry.source !== detailKey?.source) openDetail(entry);
    } else closeDetail();
  });
  $$(".tab").forEach(tab => tab.addEventListener("click", () => closeDetail(false), true));
  setKind("song");
  schedule(false);
}
