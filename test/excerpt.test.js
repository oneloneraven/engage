import { expect, test } from "vitest";
import { isFaithfulExcerpt } from "../src/testimonials/excerpt.js";

const ORIGINAL = "I love it. Also, it works offline";

test("an exact substring is faithful", () => {
  expect(isFaithfulExcerpt(ORIGINAL, "I love it.")).toBe(true);
  expect(isFaithfulExcerpt(ORIGINAL, ORIGINAL)).toBe(true);
});

test("segments joined by an ellipsis are faithful when in order", () => {
  expect(isFaithfulExcerpt(ORIGINAL, "I love it … works offline")).toBe(true);
  expect(isFaithfulExcerpt(ORIGINAL, "I love it ... works offline")).toBe(true);
});

test("a changed word is not faithful", () => {
  expect(isFaithfulExcerpt(ORIGINAL, "I adore it … works offline")).toBe(false);
});

test("case is not folded", () => {
  expect(isFaithfulExcerpt(ORIGINAL, "i love it")).toBe(false);
});

test("reordered segments are not faithful", () => {
  expect(isFaithfulExcerpt(ORIGINAL, "works offline … I love it")).toBe(false);
});

test("segments may not overlap", () => {
  expect(isFaithfulExcerpt("abcdef", "abcd … cdef")).toBe(false);
  expect(isFaithfulExcerpt("abcdef abcdef", "abcd … cdef")).toBe(true);
});

test("a segment containing emoji is faithful", () => {
  expect(isFaithfulExcerpt("Love it 😍🧗 so much", "😍🧗 so much")).toBe(true);
  expect(isFaithfulExcerpt("Love it 😍🧗 so much", "Love it … 🧗 so")).toBe(true);
  expect(isFaithfulExcerpt("Love it 😍🧗 so much", "😍🧗🧗")).toBe(false);
});

test("a leading or trailing ellipsis is faithful", () => {
  expect(isFaithfulExcerpt(ORIGINAL, "… works offline")).toBe(true);
  expect(isFaithfulExcerpt(ORIGINAL, "I love it …")).toBe(true);
  expect(isFaithfulExcerpt(ORIGINAL, "...works offline...")).toBe(true);
});

test("an excerpt with no text is not faithful", () => {
  expect(isFaithfulExcerpt(ORIGINAL, "")).toBe(false);
  expect(isFaithfulExcerpt(ORIGINAL, "  …  ")).toBe(false);
});
