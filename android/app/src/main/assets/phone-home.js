const loadPhoneHome = (() => {
  let busy = false;
  let tracks = [];

  function paintSignal(canvas) {
    const pen = canvas.getContext("2d");
    if (!pen) return;
    const { width, height } = canvas;
    const base = pen.createLinearGradient(width / 3, 0, width, height);
    base.addColorStop(0, "#0d1820");
    base.addColorStop(1, "#10303d");
    pen.fillStyle = base;
    pen.fillRect(0, 0, width, height);
    for (let row = 0; row < 32; row++) {
      const depth = row / 31;
      pen.strokeStyle = `rgba(108, 218, 245, ${.07 + depth * .24})`;
      pen.lineWidth = 1.25;
      pen.beginPath();
      for (let step = 0; step <= 120; step++) {
        const x = step / 120;
        const peak = Math.exp(-(((x - .78) * 6) ** 2));
        const ripple = Math.sin(x * 14 + depth * 2 + 1.41) + .26 * Math.sin(x * 33 + depth * 4 + 3);
        const y = (.66 + depth * .34 + ripple * peak * (.13 + depth * .06)) * height;
        if (step === 0) pen.moveTo(0, y);
        else pen.lineTo(x * width, y);
      }
      pen.stroke();
    }
  }

  function buildHome(view) {
    view.innerHTML = `<div class="playlist-feature">
      <canvas width="860" height="460" aria-hidden="true"></canvas>
      <div class="playlist-heading">
        <div><h2>本月抖音热曲</h2><p id="homePeriod"></p><p id="homePlaylist" hidden></p></div>
        <button class="icon-button playlist-refresh" id="homeRefresh" type="button" aria-label="刷新抖音热曲" title="刷新抖音热曲">${icon("refresh")}</button>
      </div>
      <button class="play-all" id="homePlayAll" type="button" disabled>${icon("play")}播放全部</button>
    </div><div id="homeResults"></div>`;
    paintSignal($("canvas", view));
    $("#homeRefresh", view).addEventListener("click", () => load(true));
    $("#homePlayAll", view).addEventListener("click", () => Player.playQueue(tracks));
  }

  function renderTracks(outlet) {
    outlet.innerHTML = `<ol class="list home-tracks" aria-label="本月抖音热曲">${tracks.map((track, index) =>
      `<li class="list-item" data-id="${esc(track.id)}" data-index="${index}">
        <button class="song-main" type="button">
          <span class="track-rank" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
          <span class="track-art">${track.thumbnail ? `<img class="cover" loading="lazy" src="${esc(track.thumbnail)}" alt="" width="40" height="40">` : icon("music")}</span>
          <span class="meta"><span class="t">${esc(track._title)}</span><span class="s">${esc(track.channel || "未知歌手")}</span></span>
          <span class="dur">${esc(track.duration || "")}</span>
        </button>
      </li>`).join("")}</ol>`;
    bindList(outlet, tracks);
    Player.seedQueue(tracks);
  }

  async function load(refresh = false) {
    if (busy) return;
    busy = true;
    const view = $("#homeView");
    if (!$("#homeResults", view)) buildHome(view);
    const period = $("#homePeriod", view), source = $("#homePlaylist", view);
    const playAll = $("#homePlayAll", view), refreshButton = $("#homeRefresh", view);
    const outlet = $("#homeResults", view);
    const now = new Date();
    period.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
    source.hidden = true;
    playAll.disabled = refreshButton.disabled = true;
    refreshButton.classList.add("is-busy");
    tracks = [];
    outlet.innerHTML = loadingState(refresh ? "正在刷新抖音热曲" : "正在查找本月抖音热曲");
    try {
      const { results = [], title, source: playlist, message } = await API.playlist(20, { refresh });
      const month = /^(\d{4})年(\d{1,2})月抖音热曲$/.exec(title);
      if (month) period.textContent = `${month[1]} 年 ${month[2]} 月`;
      source.textContent = playlist || "";
      source.hidden = !playlist;
      tracks = results.map((song) => ({ ...song, _title: song.query || song.title || "未知歌曲" }));
      if (tracks.length) renderTracks(outlet);
      else outlet.innerHTML = errorState("暂无可播放的热曲", message || "稍后再试", "重新加载");
    } catch (error) {
      outlet.innerHTML = errorState("热曲加载失败", error.message, "重新加载");
    } finally {
      busy = false;
      refreshButton.disabled = false;
      refreshButton.classList.remove("is-busy");
      playAll.disabled = !tracks.length;
      $(".retry", outlet)?.addEventListener("click", () => load(true));
    }
  }

  return load;
})();
