/*
 * LazyMapLayers developer tool: opens the panel in an After Effects that is already running.
 * tools/ae-spikes.mjs sends this with AfterFX.com -r only when the panel did not come up on its own.
 */
(function () {
    var id = app.findMenuCommandId("LazyMapLayers");
    if (id) app.executeCommand(id);
})();
