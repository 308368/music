const songs = [
  { title: "广东爱情故事", artist: "广东雨神", duration: 214 },
  { title: "Beauty And A Beat", artist: "Justin Bieber / Nicki Minaj", duration: 227 },
  { title: "Always Online", artist: "林俊杰", duration: 225 },
  { title: "雨爱", artist: "杨丞琳", duration: 260 },
  { title: "我怀念的", artist: "孙燕姿", duration: 289 },
  { title: "勇气", artist: "梁静茹", duration: 241 },
];

const $ = (id) => document.getElementById(id);
const buttons = (selector) => document.querySelectorAll(selector);
const favorites = new Set();
let order = songs.map((_, index) => index);
let queue = [...order];
let current = 1;
let playing = false;
let repeatQueue = false;
let seconds = 92;
const queueList = $("queueList");
let queueDrag = null;

const formatTime = (time) => `${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`;

function drawSignal(canvas, seed, featured = false) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const wash = ctx.createLinearGradient(width / 3, 0, width, height);
  wash.addColorStop(0, "oklch(19% .023 244)");
  wash.addColorStop(1, "oklch(32% .055 228)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
  const lines = featured ? 32 : 20;
  for (let row = 0; row < lines; row++) {
    const depth = row / (lines - 1);
    ctx.strokeStyle = `oklch(${45 + depth * 32}% .085 222 / ${.26 + depth * .36})`;
    ctx.lineWidth = featured ? 1.25 : width / 180;
    ctx.beginPath();
    for (let step = 0; step <= 120; step++) {
      const x = step / 120;
      const peak = Math.exp(-Math.pow((x - (featured ? .78 : .56)) * (featured ? 6 : 4), 2));
      const ripple = Math.sin(x * 14 + depth * 2 + seed * .47) + .26 * Math.sin(x * 33 + depth * 4 + seed);
      const y = featured ? .66 + depth * .34 : .32 + depth * .48;
      const bend = ripple * peak * (.13 + depth * .06);
      const coordinate = (y + bend) * height;
      if (step === 0) ctx.moveTo(0, coordinate);
      else ctx.lineTo(x * width, coordinate);
    }
    ctx.stroke();
  }
}

function renderList(list, indices) {
  list.replaceChildren();
  indices.forEach((index, position) => {
    const { title, artist, duration } = songs[index];
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "song";
    button.dataset.song = index;
    button.setAttribute("aria-current", String(index === current));
    button.innerHTML = '<span class="rank" aria-hidden="true"></span><canvas class="tile" width="100" height="100" aria-hidden="true"></canvas><span><span class="song-title"></span><span class="song-artist"></span></span><span class="time"></span>';
    button.querySelector(".rank").textContent = String(position + 1).padStart(2, "0");
    button.querySelector(".song-title").textContent = title;
    button.querySelector(".song-artist").textContent = artist;
    button.querySelector(".time").textContent = formatTime(duration);
    drawSignal(button.querySelector("canvas"), index);
    row.append(button);
    if (list === queueList) {
      row.className = "queue-row";
      row.dataset.queueTrack = index;
      row.insertAdjacentHTML("beforeend", '<button class="icon-button queue-remove" type="button" title="移出队列"><svg class="icon" aria-hidden="true"><use href="#close"/></svg></button><button class="icon-button queue-handle" type="button" title="长按并拖动排序" aria-describedby="queueMoveHint" aria-keyshortcuts="ArrowUp ArrowDown"><svg class="icon" aria-hidden="true"><use href="#queue-grip"/></svg></button>');
      row.querySelector(".queue-remove").setAttribute("aria-label", `移出 ${title}`);
      row.querySelector(".queue-handle").setAttribute("aria-label", `调整 ${title} 的位置`);
    }
    list.append(row);
  });
}

function updateTime() {
  const duration = songs[current]?.duration || 0;
  const progress = `${duration ? seconds / duration * 100 : 0}%`;
  $("progress").style.width = progress;
  $("elapsed").textContent = formatTime(seconds);
  $("duration").textContent = formatTime(duration);
  $("seek").max = duration;
  $("seek").value = seconds;
  $("seek").style.setProperty("--played", progress);
}

function updatePlayback() {
  buttons("[data-toggle]").forEach((button) => {
    button.querySelector("use").setAttribute("href", playing ? "#pause" : "#play");
    button.setAttribute("aria-label", playing ? "暂停" : "播放");
  });
  updateTime();
  syncTurntable();
}

function syncTurntable() {
  const deck = $("turntable");
  const active = playing && !$("nowPlaying").inert && !document.hidden;
  if (active === deck.classList.contains("is-playing")) return;
  deck.classList.toggle("is-playing", active);
  if (!active) {
    deck.classList.remove("is-spinning");
    return;
  }
  const arm = deck.querySelector(".arm-pivot");
  const lowering = arm.getAnimations().find((animation) => animation.transitionProperty === "transform");
  const startSpinning = () => {
    if (deck.classList.contains("is-playing")) deck.classList.add("is-spinning");
  };
  if (lowering) lowering.finished.then(startSpinning, () => {});
  else startSpinning();
}

function updateFavorites() {
  const isFavorite = favorites.has(current);
  buttons("[data-favorite]").forEach((button) => {
    button.classList.toggle("is-favorite", isFavorite);
    button.setAttribute("aria-pressed", String(isFavorite));
  });
  $("favoriteHint").hidden = favorites.size > 0;
  $("favoriteCount").textContent = `${favorites.size} 首`;
  renderList($("favoriteList"), [...favorites]);
}

function updateTrack() {
  const { title, artist } = songs[current] || { title: "暂未播放", artist: "" };
  $("pTitle").textContent = $("detailSong").textContent = title;
  $("pSub").textContent = $("detailArtist").textContent = artist;
  $("miniOpen").setAttribute("aria-label", current < 0 ? "打开播放详情" : `打开 ${title} 的播放详情`);
  drawSignal($("miniArt"), Math.max(current, 0));
  drawSignal($("detailArt"), Math.max(current, 0));
  buttons("[data-song]").forEach((button) => {
    button.setAttribute("aria-current", String(Number(button.dataset.song) === current));
  });
  buttons("[data-toggle], [data-step], [data-favorite], #seek, #loopPlayback").forEach((button) => {
    button.disabled = current < 0;
  });
  updateFavorites();
  updatePlayback();
}

function selectTrack(index, startPlaying = true) {
  current = index;
  seconds = 0;
  playing = startPlaying && index >= 0;
  updateTrack();
}

function startQueue(indices, index) {
  queue = [...indices];
  selectTrack(index);
}

function stepTrack(offset) {
  if (!queue.length) return;
  const position = (queue.indexOf(current) + offset + queue.length) % queue.length;
  selectTrack(queue[position]);
}

function renderQueue() {
  const scroll = queueList.scrollTop;
  renderList(queueList, queue);
  queueList.scrollTop = scroll;
  $("queueCount").textContent = `${queue.length} 首`;
  $("queueEmpty").hidden = queue.length > 0;
  $("clearQueue").disabled = !queue.length;
  if (!queue.length) $("queueConfirm").hidden = true;
}

function focusQueueTrack(index, control) {
  const button = queueList.querySelector(`[data-queue-track="${index}"] .${control}`);
  if (button) {
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: "nearest" });
  } else {
    $("collapseQueue").focus();
  }
}

function moveQueueTrack(index, position) {
  const from = queue.indexOf(index);
  if (from < 0 || from === position || position < 0 || position >= queue.length) return;
  queue.splice(from, 1);
  queue.splice(position, 0, index);
  renderQueue();
  focusQueueTrack(index, "queue-handle");
  $("queueStatus").textContent = `${songs[index].title} 已移到第 ${position + 1} 首`;
}

function removeQueueTrack(index) {
  const position = queue.indexOf(index);
  if (position < 0) return;
  queue.splice(position, 1);
  const neighbor = queue[Math.min(position, queue.length - 1)];
  if (current === index) selectTrack(neighbor ?? -1, playing);
  renderQueue();
  focusQueueTrack(neighbor, "queue-remove");
  $("queueStatus").textContent = `已移出 ${songs[index].title}`;
}

function positionDraggedRow() {
  const { row, y } = queueDrag;
  const before = [...queueList.children].find((item) => {
    if (item === row) return false;
    const target = item.getBoundingClientRect();
    return y < target.top + target.height / 2;
  }) || null;
  if (row.nextElementSibling === before) return;
  queueList.insertBefore(row, before);
  queueList.querySelectorAll(".rank").forEach((rank, index) => {
    rank.textContent = String(index + 1).padStart(2, "0");
  });
}

function scrollWhileDragging() {
  const bounds = queueList.getBoundingClientRect();
  const edgeSize = Math.min(48, bounds.height / 5);
  const scroll = queueList.scrollTop;
  if (queueDrag.y < bounds.top + edgeSize) queueList.scrollTop -= 6;
  if (queueDrag.y > bounds.bottom - edgeSize) queueList.scrollTop += 6;
  if (queueList.scrollTop !== scroll) positionDraggedRow();
  queueDrag.frame = requestAnimationFrame(scrollWhileDragging);
}

function finishQueueDrag(commit) {
  if (!queueDrag) return;
  const { pointer, row, timer, frame, active } = queueDrag;
  queueDrag = null;
  clearTimeout(timer);
  cancelAnimationFrame(frame);
  if (queueList.hasPointerCapture(pointer)) queueList.releasePointerCapture(pointer);
  row.classList.remove("is-moving");
  if (!active) return;
  const index = Number(row.dataset.queueTrack);
  const destination = [...queueList.children].indexOf(row);
  if (commit) moveQueueTrack(index, destination);
  else {
    renderQueue();
    if ($("queueDrawer").open) focusQueueTrack(index, "queue-handle");
  }
}

queueList.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".queue-handle");
  if (!handle || queueDrag || !event.isPrimary || event.button !== 0) return;
  const pointer = event.pointerId;
  queueDrag = {
    pointer, row: handle.closest(".queue-row"), x: event.clientX, startY: event.clientY,
    y: event.clientY, timer: 0, frame: 0, active: false,
  };
  queueList.setPointerCapture(pointer);
  queueDrag.timer = setTimeout(() => {
    queueDrag.active = true;
    queueDrag.row.classList.add("is-moving");
    queueDrag.frame = requestAnimationFrame(scrollWhileDragging);
  }, 320);
});

queueList.addEventListener("pointermove", (event) => {
  if (queueDrag?.pointer !== event.pointerId) return;
  queueDrag.y = event.clientY;
  if (queueDrag.active) positionDraggedRow();
  else if (Math.hypot(event.clientX - queueDrag.x, event.clientY - queueDrag.startY) > 8) finishQueueDrag(false);
});
queueList.addEventListener("pointerup", (event) => {
  if (queueDrag?.pointer === event.pointerId) finishQueueDrag(true);
});
for (const type of ["pointercancel", "lostpointercapture"]) {
  queueList.addEventListener(type, (event) => {
    if (queueDrag?.pointer === event.pointerId && event.target === queueList) finishQueueDrag(false);
  });
}
queueList.addEventListener("contextmenu", (event) => {
  if (queueDrag || event.target.closest(".queue-handle")) event.preventDefault();
});
queueList.addEventListener("keydown", (event) => {
  const handle = event.target.closest(".queue-handle");
  if (!handle || queueDrag || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const index = Number(handle.closest(".queue-row").dataset.queueTrack);
  moveQueueTrack(index, queue.indexOf(index) + (event.key === "ArrowUp" ? -1 : 1));
});
queueList.addEventListener("click", (event) => {
  const remove = event.target.closest(".queue-remove");
  if (remove && !queueDrag) removeQueueTrack(Number(remove.closest(".queue-row").dataset.queueTrack));
});

function showPlayerPage() {
  const open = location.hash === "#now-playing";
  const playerPage = $("nowPlaying");
  $("browseView").inert = open;
  playerPage.inert = !open;
  playerPage.classList.toggle("is-open", open);
  if (open) $("collapsePlayer").focus({ preventScroll: true });
  else {
    if ($("queueDrawer").open) $("queueDrawer").close();
    $("miniOpen").focus({ preventScroll: true });
  }
  syncTurntable();
}

function collapsePlayer() {
  if (history.state?.fromMiniPlayer) history.back();
  else {
    const url = new URL(location.href);
    url.hash = "";
    history.replaceState(null, "", url);
    showPlayerPage();
  }
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-song")) {
    const index = Number(button.dataset.song);
    const list = button.closest(".song-list");
    if (list === $("queueList")) selectTrack(index);
    else startQueue([...list.querySelectorAll("[data-song]")].map((row) => Number(row.dataset.song)), index);
  }
  if (button.hasAttribute("data-step")) stepTrack(Number(button.dataset.step));
  if (button.hasAttribute("data-toggle")) {
    playing = !playing;
    if (playing && seconds >= songs[current].duration) seconds = 0;
    updatePlayback();
  }
  if (button.hasAttribute("data-favorite")) {
    if (favorites.has(current)) favorites.delete(current);
    else favorites.add(current);
    updateFavorites();
  }
  if (button.hasAttribute("data-close")) button.closest("dialog").close();
});

buttons("[data-go]").forEach((button) => button.addEventListener("click", () => {
  buttons("[data-go]").forEach((tab) => {
    $(tab.dataset.go).hidden = tab !== button;
    if (tab === button) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  $("scroll").scrollTop = 0;
}));

$("playAll").addEventListener("click", () => startQueue(order, order[0]));
$("miniOpen").addEventListener("click", () => {
  history.pushState({ fromMiniPlayer: true }, "", "#now-playing");
  showPlayerPage();
});
$("collapsePlayer").addEventListener("click", collapsePlayer);
window.addEventListener("popstate", showPlayerPage);
document.addEventListener("visibilitychange", syncTurntable);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("nowPlaying").inert && !$("queueDrawer").open) collapsePlayer();
});
$("loopPlayback").addEventListener("click", (event) => {
  repeatQueue = !repeatQueue;
  event.currentTarget.setAttribute("aria-pressed", String(repeatQueue));
});
$("openQueue").addEventListener("click", () => {
  const drawer = $("queueDrawer");
  renderQueue();
  drawer.showModal();
  $("openQueue").setAttribute("aria-expanded", "true");
  drawer.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
});
$("clearQueue").addEventListener("click", () => {
  $("queueConfirm").hidden = false;
  $("cancelClearQueue").focus();
});
$("cancelClearQueue").addEventListener("click", () => {
  $("queueConfirm").hidden = true;
  $("clearQueue").focus();
});
$("confirmClearQueue").addEventListener("click", () => {
  queue = [];
  selectTrack(-1, false);
  $("queueConfirm").hidden = true;
  renderQueue();
  $("collapseQueue").focus();
  $("queueStatus").textContent = "播放队列已清空";
});
$("queueDrawer").addEventListener("cancel", (event) => {
  if (queueDrag) {
    event.preventDefault();
    finishQueueDrag(false);
  } else if (!$("queueConfirm").hidden) {
    event.preventDefault();
    $("cancelClearQueue").click();
  }
});
$("queueDrawer").addEventListener("close", () => {
  finishQueueDrag(false);
  $("queueConfirm").hidden = true;
  $("queueStatus").textContent = "";
  $("openQueue").setAttribute("aria-expanded", "false");
});
$("queueDrawer").addEventListener("click", (event) => {
  const drawer = event.currentTarget;
  if (event.target !== drawer) return;
  const bounds = drawer.getBoundingClientRect();
  if (event.clientY < bounds.top || event.clientX < bounds.left || event.clientX > bounds.right) drawer.close();
});
$("netOpen").addEventListener("click", () => $("network").showModal());
$("seek").addEventListener("input", (event) => {
  seconds = Number(event.target.value);
  updateTime();
});
$("refreshSongs").addEventListener("click", () => {
  order = [...order.slice(1), order[0]];
  renderList($("homeList"), order);
});
$("query").closest("form").addEventListener("submit", (event) => event.preventDefault());
$("query").addEventListener("input", (event) => {
  const query = event.target.value.trim().toLowerCase();
  const matches = query ? order.filter((index) => {
    const { title, artist } = songs[index];
    const text = `${title} ${artist}`.toLowerCase();
    return query.split(/\s+/).every((word) => text.includes(word));
  }) : [];
  $("searchHint").textContent = !query ? "输入歌名或歌手，搜索示例曲目。" : matches.length ? `${matches.length} 首匹配的歌曲` : "没有匹配曲目，试试其他歌名或歌手。";
  renderList($("searchList"), matches);
});

drawSignal($("featureArt"), 3, true);
renderList($("homeList"), order);
updateTrack();
if (location.hash === "#now-playing") showPlayerPage();
setInterval(() => {
  if (!playing || document.hidden) return;
  seconds++;
  if (seconds < songs[current].duration) {
    updateTime();
  } else if (repeatQueue || queue.indexOf(current) < queue.length - 1) {
    stepTrack(1);
  } else {
    playing = false;
    updatePlayback();
  }
}, 1000);
