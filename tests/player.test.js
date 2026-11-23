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
    this.source = "";
    this.loads = 0;
    this.listeners = new Map();
  }
  get src() { return this.source; }
  set src(value) { this.source = value; this.loads++; this.currentTime = 0; this.paused = true; }
  addEventListener(name, handler) { this.listeners.set(name, [...(this.listeners.get(name) || []), handler]); }
  dispatchEvent(event) { (this.listeners.get(event.type) || []).forEach((handler) => handler(event)); }
  play() { this.paused = false; this.dispatchEvent({ type: "play" }); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent({ type: "pause" }); }
}

function createPlayer(saved = {}, random = () => .75, Audio = MockAudio) {
  const values = new Map([["luna_player", JSON.stringify(saved)]]);
  const math = Object.create(Math);
  math.random = random;
  const context = vm.createContext({
    Audio,
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

test("queue edits keep the current decoder and its position when the active song survives", () => {
  const { player, values } = createPlayer();
  player.playQueue(songs, songs[1].id);
  player.audio.currentTime = 73;
  player.audio.dispatchEvent({ type: "timeupdate" });
  assert.equal(player.moveQueueItem(1, 2), true);
  assert.equal(player.moveQueueItem(0, 2), true);
  assert.equal(player.removeQueueItem(0), true);
  assert.equal(player.moveQueueItem(0, 0), false);
  assert.equal(player.moveQueueItem(-1, 1), false);
  assert.equal(player.removeQueueItem(2), false);
  assert.equal(player.current(), songs[1]);
  assert.equal(player.index, 0);
  assert.equal(player.audio.src, "/api/proxy?id=bravo02");
  assert.equal(player.audio.loads, 1);
  assert.equal(player.currentTime, 73);
  assert.equal(player.paused, false);
  assert.equal(JSON.parse(values.get("luna_player")).index, 0);
  assert.equal(JSON.parse(values.get("luna_progress")).seconds, 73);
});

test("removing the active song selects the neighbor and keeps the playback intent", () => {
  const { player, values } = createPlayer();
  player.playQueue(songs, songs[1].id);
  player.audio.currentTime = 44;
  assert.equal(player.removeQueueItem(1), true);
  assert.equal(player.current(), songs[2]);
  assert.equal(player.paused, false);
  assert.equal(player.currentTime, 0);
  player.audio.pause();
  assert.equal(player.removeQueueItem(1), true);
  assert.equal(player.current(), songs[0]);
  assert.equal(player.paused, true);
  assert.deepEqual(JSON.parse(values.get("luna_progress")), { id: "alpha01", seconds: 0 });
});

test("reordering and removing queue rows preserve valid shuffle history", () => {
  const { player } = createPlayer({}, () => .9);
  player.playQueue(songs, songs[0].id);
  player.cycleMode();
  player.cycleMode();
  assert.equal(player.next(), true);
  assert.equal(player.current(), songs[2]);
  assert.equal(player.moveQueueItem(0, 1), true);
  assert.equal(player.removeQueueItem(0), true);
  assert.equal(player.prev(), true);
  assert.equal(player.current(), songs[0]);
});

test("an explicitly empty queue survives a relaunched home refresh", () => {
  const { player, values } = createPlayer();
  player.playQueue([songs[0]], songs[0].id);
  player.audio.currentTime = 58;
  player.audio.dispatchEvent({ type: "error" });
  assert.equal(player.removeQueueItem(0), true);
  player.audio.dispatchEvent({ type: "error" });
  assert.equal(player.current(), null);
  assert.equal(player.index, -1);
  assert.equal(player.currentTime, 0);
  assert.equal(player.duration, 0);
  assert.equal(player.error, "");
  assert.equal(player.paused, true);
  assert.equal(player.audio.src, "");
  assert.equal(player.clearQueue(), false);
  assert.equal(JSON.parse(values.get("luna_progress")), null);
  const reopened = createPlayer(JSON.parse(values.get("luna_player"))).player;
  reopened.seedQueue(songs);
  assert.equal(reopened.queue.length, 0);
  assert.equal(reopened.playQueue(songs, songs[0].id), true);
  assert.equal(reopened.current(), songs[0]);
});

test("replacing a pending native track keeps playing intent and clear unloads the decoder", () => {
  class PendingAudio extends MockAudio {
    playingIntent = false;
    playCalls = 0;
    clearCalls = 0;
    async play() { this.playingIntent = true; this.playCalls++; }
    clear() { this.clearCalls++; this.playingIntent = false; this.src = ""; }
  }
  const { player } = createPlayer({}, () => .75, PendingAudio);
  player.playQueue(songs, songs[0].id);
  assert.equal(player.audio.paused, true);
  assert.equal(player.removeQueueItem(0), true);
  assert.equal(player.current(), songs[1]);
  assert.equal(player.audio.playCalls, 2);
  assert.equal(player.clearQueue(), true);
  assert.equal(player.audio.clearCalls, 1);
  assert.equal(player.audio.playingIntent, false);
  player.seedQueue(songs);
  assert.equal(player.queue.length, 0);
});
