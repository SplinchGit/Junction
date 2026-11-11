"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AppearanceStore, APPEARANCE_DEFAULTS } = require("../src/appearance-store");
const scenesFile = path.join(__dirname, "../renderer/appearance-scenes.js");
function sceneHelpers() {
  assert.ok(fs.existsSync(scenesFile), "the scene catalog and crop transform must be implemented");
  return require(scenesFile);
}

test("every new wallpaper and pastel palette survives reopening without changing independent preferences", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-scene-prefs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "appearance.json");
  const store = new AppearanceStore(file);
  assert.deepEqual(store.get(), {
    mode: "system", palette: "junction", artwork: "none", backgroundIntensity: 55,
    petals: true, petalIntensity: 35, motion: "system"
  });
  for (const artwork of ["sakura-waterfall", "sakura-airport", "sakura-city"]) {
    store.set({ artwork, motion: "reduced", petals: false, petalIntensity: 20 });
    for (const palette of ["lavender", "peach", "mint", "sky", "butter"]) {
      store.set({ palette });
      assert.deepEqual(new AppearanceStore(file).get(), {
        ...APPEARANCE_DEFAULTS, artwork, palette, motion: "reduced", petals: false, petalIntensity: 20
      });
    }
  }
  assert.throws(() => store.set({ artwork: "arbitrary-image" }), /artwork/);
  assert.throws(() => store.set({ palette: "unreadable-neon" }), /palette/);
});

test("legacy appearance files retain their original scene and animation settings", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-legacy-prefs-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "appearance.json");
  const legacy = { mode: "dark", palette: "moss", artwork: "sakura-mountain", backgroundIntensity: 70, petals: true, petalIntensity: 45, motion: "full" };
  fs.writeFileSync(file, JSON.stringify(legacy));
  assert.deepEqual(new AppearanceStore(file).get(), legacy);
});

test("every selectable scene resolves to a packaged image with the declared source size", () => {
  const { SCENES, getScene } = sceneHelpers();
  const { ARTWORK } = require("../src/appearance-store");
  assert.deepEqual(Object.keys(SCENES).sort(), [...ARTWORK].sort());
  assert.equal(getScene("none").asset, null);
  assert.equal(getScene("unknown").asset, null);
  for (const artwork of ARTWORK.filter(id => id !== "none")) {
    const scene = getScene(artwork);
    const bytes = fs.readFileSync(path.join(__dirname, "../renderer", scene.asset));
    if (artwork === "sakura-mountain") {
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(scene.width, 941); assert.equal(scene.height, 1672);
    } else {
      assert.equal(bytes.readUInt16BE(0), 0xffd8, "new art keeps its original JPEG bytes");
      let offset = 2, size;
      while (offset < bytes.length) {
        const marker = bytes.readUInt16BE(offset), length = bytes.readUInt16BE(offset + 2);
        if ([0xffc0, 0xffc1, 0xffc2].includes(marker)) { size = [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)]; break; }
        offset += 2 + length;
      }
      assert.deepEqual(size, [576, 1280]);
      assert.deepEqual([scene.width, scene.height], size);
    }
  }
});

test("cover maps the source into the actual art box with right and bottom anchoring", () => {
  const { getScene, sceneTransform } = sceneHelpers();
  const scene = getScene("sakura-waterfall");
  // Wide desktop: art box has the source aspect ratio, leaving no crop.
  const desktop = sceneTransform(scene, 360, 800);
  assert.deepEqual(desktop, { scale: 0.625, left: 0, top: 0 });
  // Narrow box: the left edge is cropped, and a source lantern remains aligned.
  const narrow = sceneTransform(scene, 200, 800);
  assert.deepEqual(narrow, { scale: 0.625, left: -160, top: 0 });
  assert.equal(narrow.left + 552 * narrow.scale, 185);
  // A short box crops the top, rather than moving the image's bottom landmarks.
  assert.deepEqual(sceneTransform(scene, 360, 400), { scale: 0.625, left: 0, top: -400 });
  assert.equal(sceneTransform(scene, 0, 800), null);
  assert.equal(sceneTransform(getScene("none"), 360, 800), null);
});

test("scene profiles attach water, airport rain and coloured city lights to the supplied art", () => {
  const { getScene } = sceneHelpers();
  const falls = getScene("sakura-waterfall"), airport = getScene("sakura-airport"), city = getScene("sakura-city");
  assert.ok(falls.waterfalls.length >= 2); assert.equal(falls.rain.length, 0);
  assert.equal(airport.waterfalls.length, 0); assert.ok(airport.rain.length > 0); assert.ok(airport.reflections.length > 0);
  assert.ok(city.waterfalls.length > 0); assert.equal(city.rain.length, 0);
  assert.ok(city.lights.some(light => light.color[2] > light.color[0]));
  assert.ok(falls.lights.some(light => light.color[0] > light.color[2]));
  assert.deepEqual(getScene("sakura-mountain").waterfalls, []);
  for (const scene of [falls, airport, city]) {
    for (const stream of scene.waterfalls) for (const [x, y] of stream.points) {
      assert.ok(x >= 0 && x <= 1 && y >= 0.45 && y <= 1, "water stays on the lower waterfall channels");
    }
    for (const light of scene.lights) assert.ok(light.x >= 0 && light.x <= 1 && light.y >= 0 && light.y <= 1);
    for (const rain of scene.rain) assert.ok(rain.y >= 0.35 && rain.y + rain.height <= 1, "airport rain is bounded to the airfield and terminal");
  }
});
