// Chapter 38: the switch that lets scripts drive the panel (shown, not turned on).

export async function run(s) {
  await s.js(`(window.lmlDebug.store.screen.value = "maps", true)`);
  await new Promise((r) => setTimeout(r, 600));
  await s.js(`(document.querySelector(".screen-body").scrollTop = 9999, true)`);
  await s.shot("38-scripting-switch", { mark: ["about-scripting"] });
  await s.js(`(window.lmlDebug.store.screen.value = "main", true)`);
}
