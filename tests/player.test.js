import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(join(import.meta.dirname, "..", "web", "js", "player.js"), "utf8");

class MockAudio {
  constructor() {
    this.currentTime = 0;
    this.duration = 180;
    this.paused = true;
    this.readyState = 4;
    this.src = "";
    this.listeners = new Map();
  }
  addEventListener(name, handler) { this.listeners.set(name, [...(this.listeners.get(name) || []), handler]); }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach((handler) => handler(event)); }
  play() { this.paused = false; this.dispatchEvent({ type: "play" }); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent({ type: "pause" }); }
}

function createPlayer(saved = {}, random = () => .75) {
  const values = new Map([["luna_player", JSON.stringify(saved)]]);
  const math = Object.create(Math);
  math.random = random;
  const context = vm.createContext({
    Audio: MockAudio,
    API: { proxyUrl: (id) => `/api/proxy?id=${id}` },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    navigator: {},
    window: {},
    Math: math,
  });
  vm.runInContext(`${source}\n;globalThis.__player = Player;`, context);
  return { player: context.__player, values };
}

const songs = ["alpha01", "bravo02", "charlie03"].map((id) => ({ id, title: id, channel: "tester" }));

test("moving an earlier song to play next preserves the playing track", () => {
  const { player } = createPlayer();
  player.playQueue(songs, songs[1].id);
  assert.equal(player.appendNext(songs[0]), true);
  assert.equal(player.current().id, songs[1].id);
  assert.equal(player.appendNext(songs[1]), false);
  player.cycleMode();
  player.next({ type: "click" });
  assert.equal(player.current().id, songs[0].id);
});

test("a queued first song survives a late home recommendation", () => {
  const { player } = createPlayer();
  player.appendNext(songs[1]);
  player.seedQueue(songs);
  assert.equal(player.current().id, songs[1].id);
  assert.equal(player.paused, true);
});

test("play mode cycles and persists", () => {
  const { player, values } = createPlayer();
  assert.equal(player.mode, "sequence");
  assert.equal(player.cycleMode(), "repeat-one");
  assert.equal(player.cycleMode(), "shuffle");
  assert.equal(player.cycleMode(), "sequence");
  assert.equal(JSON.parse(values.get("luna_player")).mode, "sequence");
});

test("invalid persisted mode falls back to sequence", () => {
  const { player } = createPlayer({ mode: "invalid", queue: songs, index: 0 });
  assert.equal(player.mode, "sequence");
});

test("repeat one applies to natural ending but not manual next", async () => {
  const { player } = createPlayer();
  player.playQueue(songs, songs[0].id, false);
  player.cycleMode();
  player.audio.currentTime = 42;
  player.audio.dispatchEvent({ type: "ended" });
  await Promise.resolve();
  assert.equal(player.index, 0);
  assert.equal(player.audio.currentTime, 0);
  assert.equal(player.next(), true);
  assert.equal(player.index, 1);
});

test("sequence stops at the end of the queue", () => {
  const { player } = createPlayer();
  player.playQueue(songs, songs.at(-1).id, false);
  assert.equal(player.next(), false);
  assert.equal(player.index, songs.length - 1);
});

test("shuffle avoids the current song and previous returns through history", () => {
  const { player } = createPlayer({}, () => .9);
  player.playQueue(songs, songs[0].id, false);
  player.cycleMode();
  player.cycleMode();
  assert.equal(player.mode, "shuffle");
  assert.equal(player.next(), true);
  assert.equal(player.index, 2);
  assert.equal(player.prev(), true);
  assert.equal(player.index, 0);
});
