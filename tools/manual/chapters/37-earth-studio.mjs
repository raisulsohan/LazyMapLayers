// Chapter 37: the Earth Studio section of the New map screen (a real tracking file is the user's own).

export async function run(s) {
  await s.js(`(window.lmlDebug.store.screen.value = "newMap", true)`);
  await new Promise((r) => setTimeout(r, 800));
  await s.js(`(document.querySelector(".screen-body").scrollTop = 9999, true)`);
  await s.shot("37-earth-studio", { mark: ["earth-studio-pins", "earth-studio-import"] });
  await s.js(`(window.lmlDebug.store.screen.value = "main", true)`);
}
