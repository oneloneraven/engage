import { expect, test } from "vitest";
import { codePointLength, longestBacktickRun, normaliseMessage } from "../../src/lib/text.js";

test("normaliseMessage converts CRLF to LF and trims", () => {
  expect(normaliseMessage("  one\r\ntwo\r\n\r\n")).toBe("one\ntwo");
});

test("normaliseMessage leaves interior spacing alone", () => {
  expect(normaliseMessage("a  b\n\n c")).toBe("a  b\n\n c");
});

test("codePointLength counts an emoji as one", () => {
  expect(codePointLength("a😀b")).toBe(3);
  expect("a😀b".length).toBe(4);
  expect(codePointLength("")).toBe(0);
});

test("longestBacktickRun finds the longest run", () => {
  expect(longestBacktickRun("no ticks")).toBe(0);
  expect(longestBacktickRun("a ` b ``` c `` d")).toBe(3);
  expect(longestBacktickRun("`````")).toBe(5);
});
