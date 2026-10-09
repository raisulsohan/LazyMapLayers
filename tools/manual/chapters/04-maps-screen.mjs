// Chapter 4: the Maps screen, the two samples and About.

export async function run(s) {
  await s.js(`(window.lmlDebug.store.screen.value = "maps", true)`);
  await s.shot("04-maps-empty", { mark: ["new-map", "sample-numbers", "about-report"] });
  await s.store("store.buildNumbersSample()");
  await s.idle();
  await s.preview();
  await s.still("04-numbers-sample-still", { time: 8 });
  await s.store("store.buildSample()");
  await s.idle();
  await s.preview();
  await s.gif("04-world-flight-sample", { start: 0, duration: 5 });
  await s.js(`(window.lmlDebug.store.screen.value = "maps", true)`);
  await s.shot("04-maps-two", { mark: [".map-card", ".map-card:nth-of-type(2)"] });
  await s.js(`(document.querySelector(".screen-body").scrollTop = 9999, true)`);
  await s.shot("04-about", { mark: ["about-releases", "about-website", "about-report", "about-updates", "about-scripting"] });
  await s.js(`(window.lmlDebug.store.screen.value = "newMap", true)`);
  await s.shot("04-new-map");
  await s.js(`(window.lmlDebug.store.screen.value = "main", true)`);
}
