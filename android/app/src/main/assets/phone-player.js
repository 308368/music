function createPhonePlayerSurface(page, background) {
  const miniOpen = $("#miniOpen");
  const pageClose = $("#npClose");
  const deck = $("#turntable");
  const arm = $(".arm-pivot", deck);
  const errorStatus = $("#recordError");
  const queuePanel = $("#queuePanel");
  const queueToggle = $("#queueToggle");
  const queueClose = $("#queueClose");
  const editor = createPhoneQueueEditor(queuePanel, queueClose);
  const trackControls = $$("#pPrev, #pNext, #pPlay, #pFav, #pProgress, #npMode, #npPrev, #npNext, #npPlay, #npFav, #npSeek, #npLyricsToggle, #npCover");
  let queueBackPending = false;

  function syncPlayback() {
    const message = Player.error;
    if (errorStatus.textContent !== message) errorStatus.textContent = message;
    errorStatus.hidden = !message;
    const active = !document.hidden && isOpen() && !deck.hidden && Boolean(Player.current())
      && !Player.paused && !Player.waiting && !Player.audio.ended && !message;
    if (active === deck.classList.contains("is-playing")) return;
    deck.classList.toggle("is-playing", active);
    if (!active) {
      deck.classList.remove("is-spinning");
      return;
    }
    const lowering = arm.getAnimations?.().find((animation) => animation.transitionProperty === "transform");
    const spin = () => {
      if (deck.classList.contains("is-playing")) deck.classList.add("is-spinning");
    };
    if (lowering) lowering.finished.then(spin, () => {});
    else spin();
  }

  function isOpen() {
    return page.classList.contains("open");
  }

  function setQueueOpen(open) {
    queueBackPending = false;
    if (open && !isOpen()) return;
    if (open === queuePanel.classList.contains("open")) return;
    queuePanel.classList.toggle("open", open);
    queuePanel.inert = !open;
    page.inert = open || !isOpen();
    queueToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      editor.render();
      queueClose.focus({ preventScroll: true });
      $(".queue-item.active", queuePanel)?.scrollIntoView({ block: "nearest" });
    } else {
      editor.cancelEdits(false);
      if (isOpen()) queueToggle.focus({ preventScroll: true });
    }
  }

  function closeQueue() {
    if (!queuePanel.classList.contains("open")) return false;
    if (history.state?.playerQueue) {
      if (!queueBackPending) {
        queueBackPending = true;
        history.back();
      }
    } else setQueueOpen(false);
    return true;
  }

  function toggleQueue() {
    if (closeQueue()) return;
    if (!isOpen()) return;
    history.pushState({ ...history.state, playerQueue: true }, "");
    setQueueOpen(true);
  }

  queueClose.addEventListener("click", closeQueue);
  $("#queueBackdrop").addEventListener("click", closeQueue);
  queuePanel.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = $$('button:not([disabled]):not([tabindex="-1"])', queuePanel).filter((button) => !button.closest("[hidden]"));
    const first = controls[0], last = controls.at(-1);
    const target = event.shiftKey && document.activeElement === first ? last
      : !event.shiftKey && document.activeElement === last ? first : null;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });

  document.addEventListener("visibilitychange", syncPlayback);

  return {
    isOpen, setQueueOpen, toggleQueue, syncPlayback, renderQueue: editor.render,
    handleQueueEscape() {
      if (!queuePanel.classList.contains("open")) return false;
      return editor.cancelEdits(true) || closeQueue();
    },
    setTrackAvailable(available) {
      trackControls.forEach((control) => { control.disabled = !available; });
    },
    open() {
      background.forEach((surface) => { surface.inert = true; });
      page.inert = false;
      page.classList.add("open");
      pageClose.focus({ preventScroll: true });
      syncPlayback();
    },
    close() {
      page.classList.remove("open");
      setQueueOpen(false);
      page.inert = true;
      background.forEach((surface) => { surface.inert = false; });
      (Player.current() ? miniOpen : $(".tab.active"))?.focus({ preventScroll: true });
      syncPlayback();
    },
    setLyricsOpen(open) {
      if (open && document.activeElement === $("#npCover")) $("#npLyricsToggle").focus({ preventScroll: true });
      deck.hidden = open;
      syncPlayback();
    },
    setProgress(value) {
      $("#npSeek").style.setProperty("--played", `${Number(value) / 10}%`);
    },
  };
}

function createPhoneQueueEditor(panel, closeButton) {
  const list = $("#queueList", panel);
  const count = $("#queueCount", panel);
  const empty = $("#queueEmpty", panel);
  const clear = $("#queueClear", panel);
  const confirm = $("#queueConfirm", panel);
  const cancel = $("#queueClearCancel", panel);
  const status = $("#queueStatus", panel);
  let renderedQueue;
  let selected = -1;
  let drag;

  const rows = () => Array.from(list.children);
  const focusRow = (index, control) => {
    const button = $(`[data-queue-index="${index}"] .${control}`, list);
    (button || closeButton).focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest" });
  };
  const renumber = () => rows().forEach((row, index) => {
    $(".queue-number", row).textContent = String(index + 1).padStart(2, "0");
  });

  function render() {
    const queue = Player.queue;
    if (!renderedQueue || queue.length !== renderedQueue.length || queue.some((song, index) => song !== renderedQueue[index])) {
      stopDrag();
      const scroll = list.scrollTop;
      renderedQueue = queue;
      selected = null;
      list.innerHTML = queue.map((song, index) => {
        const title = esc(song._title || song.title || "未知歌曲");
        const art = song.thumbnail ? `<img src="${esc(song.thumbnail)}" width="40" height="40" loading="lazy" alt="">` : icon("music");
        return `<li class="record-queue-row" data-queue-index="${index}">
          <button class="queue-item" type="button"><span class="queue-number" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span class="record-queue-art">${art}</span><span class="queue-meta"><strong>${title}</strong><span>${esc(song.channel || "未知歌手")}</span></span><span class="dur">${esc(song.duration || "")}</span></button>
          <button class="icon-button queue-remove" type="button" aria-label="移出 ${title}">${icon("close")}</button>
          <button class="icon-button queue-handle" type="button" aria-label="调整 ${title} 的位置" aria-describedby="queueMoveHint" aria-keyshortcuts="ArrowUp ArrowDown">${icon("queue-grip")}</button>
        </li>`;
      }).join("");
      list.scrollTop = scroll;
      count.textContent = `${queue.length} 首`;
      empty.hidden = Boolean(queue.length);
      clear.disabled = !queue.length;
      if (!queue.length) setConfirm(false);
    }
    if (selected === Player.index) return;
    selected = Player.index;
    rows().forEach((row) => {
      const active = Number(row.dataset.queueIndex) === selected;
      row.classList.toggle("is-current", active);
      const songButton = $(".queue-item", row);
      songButton.classList.toggle("active", active);
      songButton.setAttribute("aria-current", String(active));
    });
  }

  function setConfirm(open) {
    confirm.hidden = !open;
    clear.setAttribute("aria-expanded", String(open));
  }

  function positionDraggedRow() {
    const { row, y } = drag;
    const before = rows().find((item) => {
      if (item === row) return false;
      const rect = item.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    }) || null;
    if (row.nextElementSibling !== before) {
      list.insertBefore(row, before);
      renumber();
    }
  }

  function scrollWhileDragging() {
    if (!drag) return;
    const rect = list.getBoundingClientRect();
    const edge = Math.min(48, rect.height / 5);
    const previous = list.scrollTop;
    if (drag.y < rect.top + edge) list.scrollTop -= 6;
    if (drag.y > rect.bottom - edge) list.scrollTop += 6;
    if (previous !== list.scrollTop) positionDraggedRow();
    drag.frame = requestAnimationFrame(scrollWhileDragging);
  }

  function stopDrag() {
    if (!drag) return null;
    const old = drag;
    drag = null;
    clearTimeout(old.timer);
    cancelAnimationFrame(old.frame);
    if (list.hasPointerCapture(old.pointer)) list.releasePointerCapture(old.pointer);
    old.row.classList.remove("is-moving");
    return old;
  }

  function move(from, to) {
    const queue = Player.queue;
    const song = queue[from];
    if (!song || from === to || to < 0 || to >= queue.length) return false;
    if (song === queue[to]) renderedQueue = null;
    if (!Player.moveQueueItem(from, to)) return false;
    focusRow(to, "queue-handle");
    status.textContent = `${song._title || song.title || "歌曲"} 已移到第 ${to + 1} 首`;
    return true;
  }

  function finishDrag(commit, restoreFocus = true) {
    const old = stopDrag();
    if (!old?.active) return Boolean(old);
    const from = Number(old.row.dataset.queueIndex);
    const to = rows().indexOf(old.row);
    if (commit && move(from, to)) return true;
    if (from !== to) {
      list.append(...rows().sort((a, b) => Number(a.dataset.queueIndex) - Number(b.dataset.queueIndex)));
      renumber();
    }
    if (restoreFocus) focusRow(from, "queue-handle");
    return true;
  }

  list.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".queue-handle");
    if (!handle || drag || !event.isPrimary || event.button !== 0 || Player.queue.length < 2) return;
    const row = handle.closest(".record-queue-row");
    list.setPointerCapture(event.pointerId);
    drag = {
      row, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, y: event.clientY,
      timer: setTimeout(() => {
        drag.active = true;
        row.classList.add("is-moving");
      }, 320),
    };
  });
  list.addEventListener("pointermove", (event) => {
    if (drag?.pointer !== event.pointerId) return;
    drag.y = event.clientY;
    if (drag.active) {
      positionDraggedRow();
      if (!drag.frame) drag.frame = requestAnimationFrame(scrollWhileDragging);
    } else if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
      finishDrag(false);
    }
  });
  list.addEventListener("pointerup", (event) => {
    if (drag?.pointer === event.pointerId) finishDrag(true);
  });
  for (const eventName of ["pointercancel", "lostpointercapture"]) {
    list.addEventListener(eventName, (event) => {
      if (event.target === list && drag?.pointer === event.pointerId) finishDrag(false);
    });
  }
  list.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".queue-handle")) event.preventDefault();
  });
  list.addEventListener("keydown", (event) => {
    const handle = event.target.closest(".queue-handle");
    if (!handle || drag || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const from = Number(handle.closest(".record-queue-row").dataset.queueIndex);
    move(from, from + (event.key === "ArrowUp" ? -1 : 1));
  });
  list.addEventListener("click", (event) => {
    const row = event.target.closest(".record-queue-row");
    if (!row || drag) return;
    const index = Number(row.dataset.queueIndex);
    if (event.target.closest(".queue-item")) {
      Player.playIndex(index);
    } else if (event.target.closest(".queue-remove")) {
      const song = Player.queue[index];
      if (!song || !Player.removeQueueItem(index)) return;
      focusRow(Math.min(index, Player.queue.length - 1), "queue-remove");
      status.textContent = `已移出 ${song._title || song.title || "歌曲"}`;
    }
  });
  clear.addEventListener("click", () => {
    setConfirm(true);
    cancel.focus();
  });
  cancel.addEventListener("click", () => {
    setConfirm(false);
    clear.focus();
  });
  $("#queueClearConfirm", panel).addEventListener("click", () => {
    setConfirm(false);
    if (Player.clearQueue()) status.textContent = "播放队列已清空";
    closeButton.focus();
  });
  return {
    render,
    cancelEdits(restoreFocus) {
      if (finishDrag(false, restoreFocus)) return true;
      if (confirm.hidden) return false;
      setConfirm(false);
      if (restoreFocus) clear.focus();
      return true;
    },
  };
}
