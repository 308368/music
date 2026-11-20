import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../web/js/player.js", import.meta.url), "utf8");
class AudioStub extends EventTarget {
  currentTime = 0;
  duration = 150;
  readyState = 1;
  paused = true;
  src = "";
  async play() { this.paused = false; }
}
function open(storage) {
  const window = new EventTarget();
  const player = vm.runInNewContext(source + "\nPlayer", {
    Audio: AudioStub, API: { proxyUrl: id => "/audio/" + id }, navigator: {}, window,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
  });
  return { player, window };
}

test("refresh retains a long queue and resumes only after a user gesture", async () => {
  const storage = new Map();
  const first = open(storage);
  const songs = Array.from({ length: 120 }, (_, i) => ({ id: "track" + i }));
  first.player.playQueue(songs, songs[119].id);
  first.player.audio.currentTime = 43;
  first.window.dispatchEvent(new Event("pagehide"));
  const { player } = open(storage);
  assert.equal(player.current().id, songs[119].id);
  assert.equal(player.audio.src, "");
  assert.equal(player.paused, true);
  assert.equal(player.currentTime, 43);
  await player.toggle();
  player.audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(player.audio.currentTime, 43);
});

test("switching songs cancels pending resume and a completed track restarts at zero", async () => {
  const songs = [{ id: "a" }, { id: "b" }];
  const storage = new Map([
    ["luna_player", JSON.stringify({ queue: songs, index: 0 })],
    ["luna_progress", JSON.stringify({ id: "a", seconds: 93 })]
  ]);
  const { player } = open(storage);
  await player.toggle();
  player.next();
  player.audio.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(player.audio.currentTime, 0);
  player.audio.currentTime = 150;
  player.audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(JSON.parse(storage.get("luna_progress")).seconds, 150);
  player.audio.dispatchEvent(new Event("ended"));
  assert.equal(open(storage).player.currentTime, 0);
});
