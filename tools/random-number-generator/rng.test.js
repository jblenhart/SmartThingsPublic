import assert from "node:assert/strict";
import test from "node:test";
import {
  cryptoFill,
  drawValues,
  formatScaledBig,
  prepareDraw,
  randomIntInclusive,
  summarize,
  toScaledInt,
} from "./rng.js";

function fillFrom(chunks) {
  let index = 0;
  return (bytes) => {
    const next = chunks[index];
    index += 1;
    assert.ok(next, "scripted random source ran out of bytes");
    assert.equal(next.length, bytes.length);
    bytes.set(next);
  };
}

test("rounds bounds half away from zero and rejects unsafe magnitudes", () => {
  assert.deepEqual(toScaledInt("1.5", 0), { ok: true, value: 2 });
  assert.deepEqual(toScaledInt("-1.5", 0), { ok: true, value: -2 });
  assert.deepEqual(toScaledInt("1.25", 1), { ok: true, value: 13 });
  assert.deepEqual(toScaledInt(".5", 1), { ok: true, value: 5 });
  assert.deepEqual(toScaledInt("-0.50", 2), { ok: true, value: -50 });
  assert.equal(toScaledInt("1e2", 0).ok, false);
  assert.equal(toScaledInt("", 0).reason, "empty");
  assert.equal(toScaledInt("99999999999999999", 0).reason, "range");
});

test("formats scaled integers without binary floating point", () => {
  assert.equal(formatScaledBig(-15n, 1), "-1.5");
  assert.equal(formatScaledBig(-5n, 1), "-0.5");
  assert.equal(formatScaledBig(100n, 2), "1.00");
  assert.equal(formatScaledBig(0n, 0), "0");
});

test("rejection sampling maps leftover bytes onto the next draw", () => {
  const fill = fillFrom([
    Uint8Array.of(252),
    Uint8Array.of(0),
  ]);
  assert.equal(randomIntInclusive(1, 6, fill), 1);

  const face = fillFrom([Uint8Array.of(251)]);
  assert.equal(randomIntInclusive(1, 6, face), 6);

  const wide = fillFrom([
    Uint8Array.of(0xff, 0x78),
    Uint8Array.of(0x00, 0x01),
  ]);
  assert.equal(randomIntInclusive(0, 299, wide), 1);
});

test("prepareDraw reports range, count, and uniqueness problems", () => {
  const ok = prepareDraw({ min: "1", max: "6", count: 2, decimals: 1, unique: false });
  assert.equal(ok.ok, true);
  assert.equal(ok.minScaled, 10);
  assert.equal(ok.maxScaled, 60);

  assert.equal(
    prepareDraw({ min: "4", max: "1", count: 1, decimals: 0, unique: false }).field,
    "min",
  );
  assert.match(
    prepareDraw({ min: "1", max: "2", count: 3, decimals: 0, unique: true }).error,
    /unique/,
  );
  assert.equal(
    prepareDraw({ min: "nope", max: "3", count: 1, decimals: 0, unique: false }).field,
    "min",
  );
});

test("unique draws never repeat and stay inside the range", () => {
  const prepared = prepareDraw({ min: "1", max: "3", count: 3, decimals: 0, unique: true });
  const drawn = drawValues(prepared, cryptoFill);
  assert.deepEqual(drawn.values.slice().sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(new Set(drawn.labels).size, 3);
});

test("decimal draws use the scaled inclusive range", () => {
  const prepared = prepareDraw({ min: "0.1", max: "0.3", count: 12, decimals: 1, unique: false });
  const drawn = drawValues(prepared, cryptoFill);
  for (const value of drawn.values) {
    assert.ok(value >= 1 && value <= 3);
  }
  assert.ok(drawn.labels.every((label) => /^\d\.\d$/.test(label)));
});

test("summarize sums and rounds the average half up", () => {
  assert.deepEqual(summarize([1, 2], 0), { sum: "3", average: "1.50" });
  assert.deepEqual(summarize([1, 2, 2], 0), { sum: "5", average: "1.67" });
  assert.deepEqual(summarize([-15, -25], 1), { sum: "-4.0", average: "-2.000" });
});

test("a fair six-sided die hits every face often enough", () => {
  const prepared = prepareDraw({ min: "1", max: "6", count: 1, decimals: 0, unique: false });
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 12000; i += 1) {
    const drawn = drawValues(prepared, cryptoFill);
    counts[drawn.values[0] - 1] += 1;
  }
  for (const count of counts) {
    assert.ok(count > 1700, `face count ${count} is far from 2000`);
  }
});
