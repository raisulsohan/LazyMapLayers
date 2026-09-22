import { test } from "node:test";
import assert from "node:assert/strict";
import { cmykToHex, labToHex, readAct, readAse, readSwatchFile } from "../../src/core/style/swatchFile.ts";

/** Writes an .ase the way Illustrator does, so the reader is tested against the real layout. */
function ase(entries: { name: string; model: string; values: number[] }[], options: { groups?: boolean } = {}): Uint8Array {
  const blocks: { type: number; body: Uint8Array }[] = [];
  if (options.groups) blocks.push({ type: 0xc001, body: nameBody("A group") });
  for (const entry of entries) {
    const name = nameBody(entry.name);
    const body = new Uint8Array(name.length + 4 + entry.values.length * 4 + 2);
    body.set(name, 0);
    const view = new DataView(body.buffer);
    let at = name.length;
    for (const character of entry.model) view.setUint8(at++, character.charCodeAt(0));
    for (const value of entry.values) {
      view.setFloat32(at, value);
      at += 4;
    }
    view.setUint16(at, 2);
    blocks.push({ type: 0x0001, body });
  }
  if (options.groups) blocks.push({ type: 0xc002, body: new Uint8Array(0) });
  const size = 12 + blocks.reduce((total, block) => total + 6 + block.body.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x41, 0x53, 0x45, 0x46], 0);
  view.setUint16(4, 1);
  view.setUint16(6, 0);
  view.setUint32(8, blocks.length);
  let at = 12;
  for (const block of blocks) {
    view.setUint16(at, block.type);
    view.setUint32(at + 2, block.body.length);
    out.set(block.body, at + 6);
    at += 6 + block.body.length;
  }
  return out;
}

function nameBody(name: string): Uint8Array {
  const body = new Uint8Array(2 + (name.length + 1) * 2);
  const view = new DataView(body.buffer);
  view.setUint16(0, name.length + 1);
  for (let i = 0; i < name.length; i++) view.setUint16(2 + i * 2, name.charCodeAt(i));
  return body;
}

test("an Adobe swatch file gives its colours, whatever they are written in", () => {
  const file = ase([
    { name: "Ink", model: "RGB ", values: [1, 0.5, 0] },
    { name: "Paper", model: "Gray", values: [0.8] },
    { name: "Press", model: "CMYK", values: [0, 1, 1, 0] }
  ]);
  assert.deepEqual(readAse(file), [
    { name: "Ink", hex: "#ff8000" },
    { name: "Paper", hex: "#cccccc" },
    { name: "Press", hex: "#ff0000" }
  ]);
});

test("colours inside a group are read too, and a broken file gives nothing", () => {
  const file = ase([{ name: "In a group", model: "RGB ", values: [0, 0, 1] }], { groups: true });
  assert.deepEqual(readAse(file), [{ name: "In a group", hex: "#0000ff" }]);
  assert.deepEqual(readAse(new Uint8Array([1, 2, 3])), []);
  assert.deepEqual(readAse(new Uint8Array(40)), [], "a file that does not say ASEF is not one");
});

test("a name in another script survives", () => {
  assert.deepEqual(readAse(ase([{ name: "নীল", model: "RGB ", values: [0, 0, 0.6] }])), [{ name: "নীল", hex: "#000099" }]);
});

test("Lab and CMYK come out where they should", () => {
  // Lab 100/0/0 is white, 0/0/0 is black, and a middle grey is a middle grey.
  assert.equal(labToHex(100, 0, 0), "#ffffff");
  assert.equal(labToHex(0, 0, 0), "#000000");
  const grey = labToHex(50, 0, 0);
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(grey.slice(at, at + 2), 16));
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1, grey);
  assert.ok(r > 110 && r < 130, grey);
  assert.equal(cmykToHex(0, 0, 0, 0), "#ffffff");
  assert.equal(cmykToHex(0, 0, 0, 1), "#000000");
  assert.equal(cmykToHex(1, 0, 1, 0), "#00ff00");
});

test("a colour table is read, and its black padding left out", () => {
  const bytes = new Uint8Array(772);
  bytes.set([255, 0, 0, 0, 255, 0, 0, 0, 255], 0);
  bytes[768] = 0;
  bytes[769] = 3;
  assert.deepEqual(readAct(bytes).map((swatch) => swatch.hex), ["#ff0000", "#00ff00", "#0000ff"]);
  // Without a count, the padding of a half-used table is dropped.
  const padded = new Uint8Array(768);
  padded.set([18, 52, 86, 120, 154, 188], 0);
  assert.deepEqual(readAct(padded).map((swatch) => swatch.hex), ["#123456", "#789abc"]);
  assert.deepEqual(readAct(new Uint8Array(10)), []);
});

test("the kind of file is taken from its name", () => {
  const table = new Uint8Array(768);
  table.set([1, 2, 3], 0);
  assert.equal(readSwatchFile("studio.ACT", table)[0].hex, "#010203");
  assert.deepEqual(readSwatchFile("studio.ase", ase([{ name: "x", model: "RGB ", values: [1, 1, 1] }])), [{ name: "x", hex: "#ffffff" }]);
});
