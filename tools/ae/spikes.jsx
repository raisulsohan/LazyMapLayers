/*
 * LazyMapLayers \u2014 Phase 0 host spikes inside the real After Effects (developer tool).
 * Started by tools/ae-spikes.mjs, which prepares the input frames and reads the results.
 *
 *   S3  text layers in complex scripts with the Universal Type Engine; measuring 500 labels
 *   S5  PNG sequence import, proxy, re-render in place
 *
 * Run by the panel with $.evalFile when a spike request includes S3 or S5.
 * Results: %TEMP%\LazyMapLayers\spikes\host-results.txt and host-frame-*.png
 */
(function () {
    var dir = new Folder(Folder.temp.fsName + "/LazyMapLayers/spikes");
    if (!dir.exists) dir.create();
    var lines = [];
    var failures = 0;
    var out = new File(dir.fsName + "/host-results.txt");
    function flush(done) {
        out.encoding = "UTF-8";
        out.open("w");
        out.write(lines.join("\n") + "\n" + (done ? "DONE " + (failures ? "FAILED " + failures : "ALL PASSED") : "RUNNING") + "\n");
        out.close();
    }
    function check(name, ok, detail) {
        if (!ok) failures++;
        lines.push((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  [" + detail + "]" : ""));
        flush(false);
    }
    function info(text) {
        lines.push("INFO " + text);
        flush(false);
    }

    lines.push("After Effects " + app.version + " (" + app.buildName + ")");
    flush(false);
    var skipHost = false;

    // ---------------- S3: complex scripts ----------------
    if (!skipHost) try {
        var comp = app.project.items.addComp("S3 scripts", 1920, 1080, 1, 5, 25);
        comp.bgColor = [0.07, 0.09, 0.12];
        var samples = [
            ["Latin", "Paris \u00B7 S\u00E3o Paulo \u00B7 Z\u00FCrich", "SegoeUI"],
            ["Arabic", "\u0627\u0644\u0642\u0627\u0647\u0631\u0629", "SegoeUI"],
            ["Hebrew", "\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD", "SegoeUI"],
            ["Devanagari", "\u0928\u0908 \u0926\u093F\u0932\u094D\u0932\u0940", "NirmalaUI"],
            ["Bengali", "\u09A2\u09BE\u0995\u09BE \u099A\u099F\u09CD\u099F\u0997\u09CD\u09B0\u09BE\u09AE \u0995\u09CD\u09B7\u09CD\u09AE", "NirmalaUI"],
            ["Tamil", "\u0B9A\u0BC6\u0BA9\u0BCD\u0BA9\u0BC8", "NirmalaUI"],
            ["Thai", "\u0E01\u0E23\u0E38\u0E07\u0E40\u0E17\u0E1E\u0E21\u0E2B\u0E32\u0E19\u0E04\u0E23", "LeelawadeeUI"],
            ["Myanmar", "\u101B\u1014\u103A\u1000\u102F\u1014\u103A", "MyanmarText"],
            ["Chinese", "\u5317\u4EAC", "MicrosoftYaHei"],
            ["Japanese", "\u6771\u4EAC", "YuGothic-Regular"],
            ["Korean", "\uC11C\uC6B8", "MalgunGothic"]
        ];
        var hasUte = typeof ComposerEngine !== "undefined";
        info("ComposerEngine available: " + hasUte);
        for (var i = 0; i < samples.length; i++) {
            var layer = comp.layers.addText(samples[i][1]);
            layer.name = samples[i][0];
            var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
            var doc = prop.value;
            try {
                doc.font = samples[i][2];
            } catch (fontError) {
                info("font " + samples[i][2] + " not set: " + fontError.message);
            }
            doc.fontSize = 56;
            doc.fillColor = [1, 1, 1];
            doc.applyFill = true;
            doc.justification = ParagraphJustification.LEFT_JUSTIFY;
            if (hasUte) {
                try {
                    doc.composerEngine = ComposerEngine.UNIVERSAL_TYPE_ENGINE;
                } catch (engineError) {
                    info("composerEngine not set for " + samples[i][0] + ": " + engineError.message);
                }
            }
            prop.setValue(doc);
            var back = prop.value;
            layer.property("ADBE Transform Group").property("ADBE Position").setValue([80 + (i % 2) * 920, 110 + Math.floor(i / 2) * 170]);
            // The first layout of a newly used script can measure 0 x 0 for a moment; retry briefly.
            var rect = layer.sourceRectAtTime(0, false);
            var retries = 0;
            while (rect.width === 0 && retries < 20) {
                $.sleep(50);
                rect = layer.sourceRectAtTime(0, false);
                retries++;
            }
            if (retries > 0) info(samples[i][0] + " measured after " + retries + " retries");
            check("S3 text " + samples[i][0], rect.width > 10 && back.text === samples[i][1],
                "font=" + back.font + " engine=" + (hasUte ? back.composerEngine : "n/a") + " w=" + Math.round(rect.width) + " h=" + Math.round(rect.height));
        }

        var shot = new File(dir.fsName + "/host-frame-S3.png");
        if (shot.exists) shot.remove();
        var saved = false;
        try {
            comp.saveFrameToPng(0, shot);
            for (var wait = 0; wait < 60 && !shot.exists; wait++) $.sleep(250);
            saved = shot.exists;
        } catch (pngError) {
            info("saveFrameToPng failed: " + pngError.message);
        }
        check("S3 frame saved for visual inspection", saved, shot.fsName);

        // Measuring many labels: how fast is sourceRectAtTime for a batch?
        var measureComp = app.project.items.addComp("S3 measure", 1920, 1080, 1, 5, 25);
        var created = new Date().getTime();
        var batch = [];
        for (var n = 0; n < 500; n++) {
            var sample = samples[n % samples.length];
            batch.push(measureComp.layers.addText(sample[1] + " " + n));
        }
        var afterCreate = new Date().getTime();
        var total = 0;
        for (var m = 0; m < batch.length; m++) {
            total += batch[m].sourceRectAtTime(0, false).width;
        }
        var afterMeasure = new Date().getTime();
        check("S3 create 500 text layers", true, (afterCreate - created) + " ms");
        check("S3 measure 500 text layers", total > 0, (afterMeasure - afterCreate) + " ms");
        measureComp.remove();
    } catch (s3Error) {
        check("S3 ran", false, s3Error.message + " line " + s3Error.line);
    }

    // ---------------- S5: sequences and proxies ----------------
    if (!skipHost) try {
        var seqDir = new Folder(dir.fsName + "/seq");
        var proxyDir = new Folder(dir.fsName + "/seq-proxy");
        var first = new File(seqDir.fsName + "/frame_0000.png");
        var proxyFirst = new File(proxyDir.fsName + "/frame_0000.png");
        check("S5 input frames exist", first.exists && proxyFirst.exists, first.fsName);

        var options = new ImportOptions(first);
        options.sequence = true;
        options.forceAlphabetical = true;
        var footage = app.project.importFile(options);
        footage.mainSource.conformFrameRate = 25;
        check("S5 imported as sequence", footage.duration > 0.35 && footage.duration < 0.45, "duration " + footage.duration);

        var seqComp = app.project.items.addComp("S5 sequence", footage.width, footage.height, 1, footage.duration, 25);
        var seqLayer = seqComp.layers.add(footage);
        seqLayer.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = "Survives re-render";

        footage.setProxyWithSequence(proxyFirst, true);
        check("S5 proxy set", footage.useProxy === true && footage.proxySource !== null, "proxy " + (footage.proxySource ? footage.proxySource.width + "x" + footage.proxySource.height : "none"));
        footage.useProxy = false;

        var before = new File(dir.fsName + "/host-frame-S5-before.png");
        if (before.exists) before.remove();
        seqComp.saveFrameToPng(0.2, before);
        for (var w1 = 0; w1 < 60 && !before.exists; w1++) $.sleep(250);

        // The orchestrator replaced nothing yet; simulate a re-render by swapping in the second set.
        var rerender = new File(dir.fsName + "/seq-v2/frame_0000.png");
        footage.replaceWithSequence(rerender, true);
        footage.mainSource.conformFrameRate = 25;
        var after = new File(dir.fsName + "/host-frame-S5-after.png");
        if (after.exists) after.remove();
        seqComp.saveFrameToPng(0.2, after);
        for (var w2 = 0; w2 < 60 && !after.exists; w2++) $.sleep(250);
        check("S5 layer and effects survive replacing the sequence",
            seqComp.numLayers === 1 && seqComp.layer(1).source === footage && seqComp.layer(1).property("ADBE Effect Parade").numProperties === 1,
            "layers " + seqComp.numLayers);
        check("S5 frames saved for pixel comparison", before.exists && after.exists);
    } catch (s5Error) {
        check("S5 ran", false, s5Error.message + " line " + s5Error.line);
    }

    flush(true);

})();
