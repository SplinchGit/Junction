"use strict";
// Source coordinates are fractions of the unchanged image. Canvas and CSS both use
// cover, anchored at the right/bottom of the measured artwork box.
((scope) => {
  const empty = { waterfalls: [], lights: [], rain: [], reflections: [] };
  const SCENES = Object.freeze({
    none: { ...empty, label: "None", asset: null, width: 0, height: 0 },
    "sakura-mountain": { ...empty, label: "Sakura Mountain", asset: "assets/sakura-mountain.webp", width: 941, height: 1672 },
    "sakura-waterfall": {
      label: "Moonlit Falls", asset: "assets/sakura-waterfall.jpg", width: 576, height: 1280,
      waterfalls: [
        { points: [[.916, .658], [.895, .679], [.882, .715], [.871, .754], [.849, .774]], width: 6, phase: .2 },
        { points: [[.797, .815], [.779, .829], [.766, .845]], width: 5, phase: .6 },
        { points: [[.665, .867], [.635, .896], [.617, .936], [.592, .970]], width: 7, phase: .9 }
      ],
      lights: [
        { x: .772, y: .563, radius: .035, color: [255, 190, 110], phase: .2 },
        { x: .960, y: .548, radius: .034, color: [255, 177, 100], phase: 2.4 }
      ], rain: [], reflections: []
    },
    "sakura-airport": {
      label: "Sakura Airport", asset: "assets/sakura-airport.jpg", width: 576, height: 1280,
      waterfalls: [],
      lights: [
        { x: .876, y: .276, radius: .030, color: [166, 195, 255], phase: .4 },
        { x: .737, y: .359, radius: .026, color: [167, 202, 255], phase: 1.8 },
        { x: .607, y: .603, radius: .035, color: [104, 209, 255], phase: 3.2 },
        { x: .285, y: .646, radius: .024, color: [109, 215, 255], phase: 2.1 },
        { x: .526, y: .634, radius: .022, color: [105, 202, 255], phase: 4.5 },
        { x: .967, y: .587, radius: .040, color: [255, 200, 138], phase: 1.2 },
        { x: .908, y: .711, radius: .032, color: [255, 194, 121], phase: 3.7 }
      ],
      rain: [
        { x: .08, y: .625, width: .66, height: .31, count: 9 },
        { x: .56, y: .42, width: .20, height: .23, count: 4 }
      ],
      reflections: [
        { x: .284, y: .698, length: .055, color: [109, 213, 255], phase: .4 },
        { x: .526, y: .706, length: .072, color: [105, 202, 255], phase: 1.8 },
        { x: .608, y: .714, length: .090, color: [111, 213, 255], phase: 3.4 },
        { x: .754, y: .872, length: .056, color: [255, 193, 133], phase: 2.1 }
      ]
    },
    "sakura-city": {
      label: "Violet City", asset: "assets/sakura-city.jpg", width: 576, height: 1280,
      waterfalls: [
        { points: [[.834, .468], [.825, .493], [.803, .526], [.780, .566], [.764, .579]], width: 6, phase: .3 },
        { points: [[.766, .608], [.742, .644], [.718, .679], [.686, .708]], width: 5, phase: .8 },
        { points: [[.894, .687], [.867, .703], [.840, .730], [.805, .755]], width: 6, phase: .5 }
      ],
      lights: [
        { x: .866, y: .394, radius: .040, color: [100, 221, 255], phase: .7 },
        { x: .950, y: .281, radius: .039, color: [209, 130, 255], phase: 2.8 },
        { x: .876, y: .309, radius: .026, color: [109, 212, 255], phase: 4.2 },
        { x: .777, y: .502, radius: .035, color: [208, 136, 255], phase: 1.7 },
        { x: .962, y: .624, radius: .038, color: [255, 181, 137], phase: 3.5 },
        { x: .660, y: .823, radius: .029, color: [255, 195, 127], phase: .5 }
      ], rain: [], reflections: []
    }
  });
  function getScene(id) { return SCENES[id] || SCENES.none; }
  function sceneTransform(scene, width, height) {
    if (!scene.asset || width <= 0 || height <= 0) return null;
    const scale = Math.max(width / scene.width, height / scene.height);
    return { scale, left: width - scene.width * scale, top: height - scene.height * scale };
  }
  const api = { SCENES, getScene, sceneTransform };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else scope.JunctionScenes = api;
})(typeof window === "undefined" ? globalThis : window);
