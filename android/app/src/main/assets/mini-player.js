(() => {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const player = document.querySelector("#player");

  player.querySelectorAll(".mini-line").forEach((line) => {
    const track = line.firstElementChild;
    const label = track.firstElementChild;
    const copy = document.createElement("span");
    copy.className = "mini-copy";
    copy.setAttribute("aria-hidden", "true");
    track.append(copy);

    let animation;
    let lastValue;
    let lastWidth;
    let lastMotion;

    function update() {
      const value = label.textContent;
      const width = line.getBoundingClientRect().width;
      const allowMotion = !reducedMotion.matches && !document.hidden && !player.inert;
      if (value === lastValue && width === lastWidth && allowMotion === lastMotion) return;
      lastValue = value;
      lastWidth = width;
      lastMotion = allowMotion;
      animation?.cancel();
      line.classList.remove("is-scrolling");
      if (!value || width === 0 || !allowMotion || !track.animate) return;

      const labelWidth = label.getBoundingClientRect().width;
      if (labelWidth <= width + 0.5) return;
      const gap = 24;
      const distance = labelWidth + gap;
      const pause = 1500;
      const duration = pause + (distance / 25) * 1000;
      copy.textContent = value;
      line.style.setProperty("--mini-scroll-gap", `${gap}px`);
      line.classList.add("is-scrolling");
      animation = track.animate([
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: pause / duration },
        { transform: `translateX(-${distance}px)`, offset: 1 },
      ], { duration, iterations: Infinity });
    }

    new MutationObserver(update).observe(label, { childList: true, characterData: true, subtree: true });
    new MutationObserver(update).observe(player, { attributes: true, attributeFilter: ["inert", "aria-hidden"] });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(update).observe(line);
    else window.addEventListener("resize", update);
    if (reducedMotion.addEventListener) reducedMotion.addEventListener("change", update);
    else reducedMotion.addListener(update);
    document.addEventListener("visibilitychange", update);
    update();
  });
})();
