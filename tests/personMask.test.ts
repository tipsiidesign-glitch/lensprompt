import { expect, test } from "bun:test";
import { writePersonAlpha } from "../src/lib/personMask";

test("person confidence keeps foreground opaque and background transparent", () => {
  const values = new Float32Array([0, 0.3, 0.525, 0.75, 1, NaN]);
  const pixels = new Uint8ClampedArray(values.length * 4);
  writePersonAlpha(values, new Float32Array(values), pixels);
  expect([...pixels].filter((_, i) => i % 4 === 3)).toEqual([0, 0, 127, 255, 255, 0]);
});

test("a changing mask is smoothed without reversing person and background", () => {
  const previous = new Float32Array([0, 1]);
  const pixels = new Uint8ClampedArray(8);
  writePersonAlpha(new Float32Array([1, 0]), previous, pixels);
  expect(pixels[3]).toBe(198);
  expect(pixels[7]).toBe(28);
});

test("mismatched dimensions are rejected rather than retaining a partial mask", () => {
  expect(() => writePersonAlpha(new Float32Array(2), new Float32Array(1), new Uint8ClampedArray(8))).toThrow();
});