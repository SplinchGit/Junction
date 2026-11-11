"use strict";
// Real Electron appearance checks in a disposable profile. Never reads or writes
// the owner's saved appearance, conversations, relay state or model settings.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "junction-scene-ui-"));
app.setPath("userData", directory);
global.fetch = async () => { throw new Error("OFFLINE_UI_TEST_NETWORK_DISABLED"); };
require("../src/world-host-relay").WorldHostRelay.prototype.start = function () {};
require("../src/lan-relay-lifecycle").LanRelayLifecycle.prototype.start = async function () { throw new Error("OFFLINE_UI_TEST_LAN_DISABLED"); };
require("../src/local-brain-relay").LocalBrainRelay.prototype.start = function () {};
require("../src/nethra-scheduler").NethraScheduler.prototype.start = function () {};
require("../src/codex-client").getCodexStatus = async () => ({ available: false });
const results = process.env.JUNCTION_UI_RESULTS || path.join(__dirname, "../test-results/pastel-scenes");
fs.mkdirSync(results, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], screenshots = [], effects = [], contrast = [];
const deadline = setTimeout(() => { console.error("Scene UI test timed out"); app.exit(1); }, 60000);
let testedWindow = false;
app.on("browser-window-created", (_event, window) => {
  if (testedWindow) return; testedWindow = true;
  window.webContents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
  window.webContents.once("did-finish-load", async () => {
    try {
      const run = code => window.webContents.executeJavaScript(code);
      const apply = async patch => {
        await run(`(async()=>window.JunctionAppearance.apply(await window.junction.setAppearance(${JSON.stringify(patch)})))()`);
        await wait(160);
      };
      const shot = async name => {
        const file = path.join(results, name);
        fs.writeFileSync(file, (await window.webContents.capturePage()).toPNG());
        screenshots.push(file); return file;
      };
      const sample = () => run(`(()=>{
        const canvas=document.querySelector('#ambient .scene-effects');
        const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let hash=0,pixels=0;for(let i=0;i<bytes.length;i+=4){if(bytes[i+3])pixels++;hash=(Math.imul(hash,31)+bytes[i]+bytes[i+1]+bytes[i+2]+bytes[i+3])>>>0;}
        return {hash,pixels,running:window.JunctionAppearance.running(),opacity:getComputedStyle(canvas).opacity};
      })()`);
      await wait(300);
      const controls = await run(`(()=>{
        const labels=[...document.querySelectorAll('#appearance-settings label')];
        return {wallpapers:[...(labels.find(n=>n.textContent.startsWith('Wallpaper'))?.querySelector('select').options||[])].map(n=>[n.value,n.textContent]),palettes:[...labels.find(n=>n.textContent.startsWith('Colour palette')).querySelector('select').options].map(n=>n.value),labels:labels.map(n=>n.firstChild.textContent.trim())};
      })()`);
      assert.deepEqual(controls.wallpapers, [["none", "None"], ["sakura-mountain", "Sakura Mountain"], ["sakura-waterfall", "Moonlit Falls"], ["sakura-airport", "Sakura Airport"], ["sakura-city", "Violet City"]]);
      assert.deepEqual(controls.palettes, ["junction", "sakura", "moss", "lavender", "peach", "mint", "sky", "butter"]);
      assert.ok(controls.labels.includes("Animation intensity"));
      assert.ok(await run(`document.getElementById('appearance-settings').textContent.includes('Scene animation')`));
      await run(`(async()=>{const c=await window.junction.newConversation();await openConversation(c.id);renderMessages([{id:'u',role:'user',content:'Can you keep an eye on the evening ferry?',provenance:'OWNER',createdAt:Date.now()},{id:'a',role:'assistant',content:'I will check the timetable and let you know when it changes. [View the route](https://example.com/route)',provenance:'JUNCTION',createdAt:Date.now()}]);})()`);
      window.focus(); await wait(150);
      for (const artwork of ["sakura-waterfall", "sakura-airport", "sakura-city"]) {
        await apply({ mode: "dark", palette: "lavender", artwork, backgroundIntensity: 75, petals: true, petalIntensity: 65, motion: "full" });
        const asset = await run(`(async()=>{const image=new Image();image.src=getComputedStyle(document.querySelector('#ambient .art')).backgroundImage.slice(5,-2);await image.decode();return [image.naturalWidth,image.naturalHeight];})()`);
        assert.deepEqual(asset, [576, 1280]);
        await wait(180); const first = await sample(); await shot(`${artwork}-frame-1.png`);
        await wait(350); const second = await sample(); await shot(`${artwork}-frame-2.png`);
        assert.equal(first.running, true); assert.ok(first.pixels > 100, `${artwork} draws its effects`);
        assert.notEqual(first.hash, second.hash, `${artwork} effects move between frames`);
        effects.push({ artwork, first, second });
      }
      for (const mode of ["dark", "light"]) for (const palette of ["lavender", "peach", "mint", "sky", "butter"]) {
        await apply({ mode, palette });
        const pairs = await run(`(()=>{
          const color=n=>getComputedStyle(n).color,bg=n=>getComputedStyle(n).backgroundColor;
          const primary=document.querySelector('.primary'),bubble=document.querySelector('.message.user .bubble'),input=document.querySelector('#appearance-settings select'),link=document.querySelector('.message .bubble a');
          return {primary:[color(primary),bg(primary)],userBubble:[color(bubble),bg(bubble)],input:[color(input),bg(input)],link:[color(link),getComputedStyle(document.documentElement).getPropertyValue('--scene-bg').trim()]};
        })()`);
        for (const [surface, pair] of Object.entries(pairs)) {
          const ratio = contrastRatio(...pair);
          assert.ok(ratio >= 4.5, `${mode}/${palette} ${surface} contrast ${ratio.toFixed(2)}`);
          contrast.push({ mode, palette, surface, ratio: Number(ratio.toFixed(2)) });
        }
        await shot(`${palette}-${mode}.png`);
      }
      await apply({ mode: "dark", palette: "mint", artwork: "sakura-waterfall", backgroundIntensity: 0 });
      const invisible = await sample(); assert.equal(invisible.pixels, 0); assert.equal(Number(invisible.opacity), 0);
      await apply({ backgroundIntensity: 75, petals: false });
      assert.equal((await sample()).running, false); assert.equal((await sample()).pixels, 0);
      await apply({ petals: true, petalIntensity: 0 }); assert.equal((await sample()).running, false);
      await apply({ petalIntensity: 45, motion: "reduced" }); assert.equal((await sample()).running, false);
      await apply({ motion: "full", artwork: "none" }); assert.equal((await sample()).running, false);
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
      await apply({ artwork: "sakura-city", motion: "system" }); assert.equal((await sample()).running, false);
      assert.equal(await run(`document.documentElement.dataset.motion`), "reduced");
      await apply({ motion: "full" }); assert.equal((await sample()).running, true);
      // Windows can immediately return focus to its only window after blur().
      // A second, disposable app window gives the native blur event a real target.
      const focusTarget = new BrowserWindow({ width: 260, height: 100, show: false, skipTaskbar: true, webPreferences: { sandbox: true } });
      await focusTarget.loadURL("about:blank"); focusTarget.show(); focusTarget.focus(); await wait(150);
      assert.equal(window.isFocused(), false);
      assert.equal((await sample()).running, false);
      focusTarget.destroy();
      window.focus(); await wait(150); assert.equal((await sample()).running, true);
      window.hide(); await wait(150); assert.equal((await sample()).running, false);
      window.show(); window.focus(); await wait(150); assert.equal((await sample()).running, true);
      await apply({ mode: "light", palette: "peach", artwork: "sakura-airport", motion: "reduced" });
      await run(`location.reload()`); await wait(1000);
      assert.deepEqual(await run(`(async()=>{const p=await window.junction.appearance();return [p.palette,p.artwork,p.motion,document.documentElement.dataset.palette,document.documentElement.dataset.artwork,window.JunctionAppearance.running()];})()`), ["peach", "sakura-airport", "reduced", "peach", "sakura-airport", false]);
      window.webContents.debugger.detach();
      await apply({ mode: "dark", palette: "sky", artwork: "sakura-city", motion: "full" });
      window.setMinimumSize(900, 620); window.setContentSize(900, 1100); await wait(220);
      const crop = await run(`(()=>{const box=document.querySelector('#ambient .scene-frame').getBoundingClientRect(),canvas=document.querySelector('#ambient .scene-effects'),canvasBox=canvas.getBoundingClientRect(),scene=window.JunctionScenes.getScene('sakura-city');return {width:box.width,height:box.height,canvasWidth:canvasBox.width,canvasHeight:canvasBox.height,transform:window.JunctionScenes.sceneTransform(scene,box.width,box.height),mask:getComputedStyle(document.querySelector('#ambient .scene-frame')).maskImage};})()`);
      assert.ok(crop.width < crop.height * .45, "a narrow window really crops the source");
      assert.equal(crop.width, crop.canvasWidth); assert.equal(crop.height, crop.canvasHeight);
      assert.ok(crop.transform.left < 0); assert.equal(crop.transform.top, 0); assert.match(crop.mask, /linear-gradient/);
      await shot("violet-city-narrow.png");
      const framesPerSecond = await run(`new Promise(resolve=>{const context=document.querySelector('#ambient .scene-effects').getContext('2d'),clear=context.clearRect;let frames=0;context.clearRect=function(...args){frames++;return clear.apply(this,args);};setTimeout(()=>{context.clearRect=clear;resolve(frames);},1000);})`);
      assert.ok(framesPerSecond >= 6 && framesPerSecond <= 25, `scene draw frame cap: ${framesPerSecond}`);
      // Direct apply() is an animation test hook; a normal settings save also
      // refreshes its controls. Reload the saved fixture before previewing them.
      await run(`location.reload()`); await wait(800);
      assert.equal(await run(`(()=>{showView('settings');return document.getElementById('view-settings').classList.contains('active');})()`), true);
      assert.deepEqual(await run(`[...document.querySelectorAll('#appearance-settings select')].map(node=>node.value)`), ["dark", "sky", "sakura-city", "full"]);
      await wait(150); await shot("pastel-wallpaper-settings.png");
      assert.deepEqual(errors, [], "Renderer errors");
      const report = { passed: true, profile: directory, controls, effects, contrast, crop, framesPerSecond, screenshots };
      fs.writeFileSync(path.join(results, "result.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report)); clearTimeout(deadline); app.exit(0);
    } catch (error) { console.error(error.stack); console.error(JSON.stringify(errors)); clearTimeout(deadline); app.exit(1); }
  });
});
function contrastRatio(a, b) {
  const luminance = value => {
    const channels = value.startsWith("#") ? value.slice(1).match(/../g).map(v => parseInt(v, 16)) : value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const rgb = channels.map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
require("../src/main");
