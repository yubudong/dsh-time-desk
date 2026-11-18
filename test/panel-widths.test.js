import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePanelWidths,
  panelBounds,
  boundedWidth,
} from "../src/panel-widths.js";
test("saved widths validate numbers, isolate keys and clamp extreme values", () => {
  assert.deepEqual(parsePanelWidths("{bad"), {});
  assert.deepEqual(parsePanelWidths(null), {});
  assert.deepEqual(
    parsePanelWidths('{"spirit":500,"support":320,"other":"ignored"}'),
    { support: 320, spirit: 500 },
  );
  assert.deepEqual(parsePanelWidths('{"spirit":99999,"support":-1}'), {
    support: 220,
    spirit: 800,
  });
  assert.deepEqual(parsePanelWidths('{"spirit":"500","support":null}'), {});
});
test("desktop assistant width leaves a usable main workspace and clamps dragging", () => {
  const limits = panelBounds("spirit", 1200, 188);
  assert.deepEqual(limits, { min: 280, max: 692 });
  assert.equal(boundedWidth(1000, limits), 692);
  assert.equal(boundedWidth(100, limits), 280);
  assert.equal(boundedWidth(470, limits), 470);
});
test("support divider leaves enough room for main column and gap", () => {
  assert.deepEqual(panelBounds("support", 900), { min: 220, max: 540 });
  assert.equal(boundedWidth(900, panelBounds("support", 610)), 250);
});
test("overlay width stays in narrow host, with finite bounds even for collapsed containers", () => {
  assert.deepEqual(panelBounds("spirit", 500, 60), { min: 280, max: 440 });
  assert.deepEqual(panelBounds("spirit", 260, 60), { min: 200, max: 200 });
  assert.deepEqual(panelBounds("support", 0), { min: 0, max: 0 });
});
