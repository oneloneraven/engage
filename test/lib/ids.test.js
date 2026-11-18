import { afterEach, expect, test, vi } from "vitest";
import { newId } from "../../src/lib/ids.js";

afterEach(() => vi.useRealTimers());

test("an id is 26 Crockford base32 characters", () => {
  expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("two ids in the same millisecond are distinct", () => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  expect(newId()).not.toBe(newId());
});

test("ids sort lexically by creation time", () => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  const ids = [];
  for (let i = 0; i < 20; i++) {
    ids.push(newId());
    vi.advanceTimersByTime(1);
  }
  expect([...ids].sort()).toEqual(ids);
});
