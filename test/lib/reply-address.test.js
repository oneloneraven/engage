import { describe, expect, it } from "vitest";
import { makeReplyAddress, parseReplyAddress } from "../../src/email/reply-address.js";
import { hmacHex, timingSafeEqual } from "../../src/lib/hmac.js";

const SECRET = "test-reply-secret";
const ID = "01JD0Q8Y5Z3K7M2N4P6R8T0V2W";

describe("hmacHex", () => {
  it("matches the RFC 4231 test case 2 vector", async () => {
    expect(await hmacHex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });
});

describe("timingSafeEqual", () => {
  it("compares whole strings", () => {
    expect(timingSafeEqual("abcd", "abcd")).toBe(true);
    expect(timingSafeEqual("abcd", "abce")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("reply addresses", () => {
  it("round-trips an item id through a lowercase address on the product's domain", async () => {
    const address = await makeReplyAddress(ID, "climbinglogbook.com", SECRET);
    expect(address).toMatch(/^reply\+[0-9a-z]{26}\.[0-9a-f]{16}@climbinglogbook\.com$/);
    expect(await parseReplyAddress(address, SECRET)).toBe(ID);
  });

  it("still parses when a mail system changes the address's case", async () => {
    const address = await makeReplyAddress(ID, "deaftly.com", SECRET);
    expect(await parseReplyAddress(address.toUpperCase(), SECRET)).toBe(ID);
  });

  it("refuses a signature with one character changed", async () => {
    const address = await makeReplyAddress(ID, "deaftly.com", SECRET);
    const at = address.indexOf("@");
    const last = address[at - 1];
    const forged = `${address.slice(0, at - 1)}${last === "0" ? "1" : "0"}${address.slice(at)}`;
    expect(await parseReplyAddress(forged, SECRET)).toBeNull();
  });

  it("refuses an address signed with another secret", async () => {
    const address = await makeReplyAddress(ID, "deaftly.com", "another-secret");
    expect(await parseReplyAddress(address, SECRET)).toBeNull();
  });

  it("refuses an id moved under another item's signature", async () => {
    const mine = await makeReplyAddress(ID, "deaftly.com", SECRET);
    const signature = mine.slice(mine.indexOf(".") + 1, mine.indexOf("@"));
    const other = `reply+01jd0q8y5z3k7m2n4p6r8t0v2x.${signature}@deaftly.com`;
    expect(await parseReplyAddress(other, SECRET)).toBeNull();
  });

  it("refuses malformed and ordinary addresses", async () => {
    for (const address of [
      "reply+abc@x.test",
      "reply+.0123456789abcdef@x.test",
      "hello@x.test",
      "reply@x.test",
      "not-an-address",
      "",
    ]) {
      expect(await parseReplyAddress(address, SECRET)).toBeNull();
    }
  });
});
