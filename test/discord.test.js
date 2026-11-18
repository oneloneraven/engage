import { afterEach, expect, test, vi } from "vitest";
import { notifyNew } from "../src/discord.js";
import { getProduct } from "../src/registry.js";
import { DISCORD_URL, makeEnv, stubFetch } from "./helpers.js";
import { env as baseEnv } from "cloudflare:test";

afterEach(() => vi.restoreAllMocks());

const cl = async () => /** @type {import("../src/registry.js").Product} */ (await getProduct(baseEnv, "cl"));

test("each kind has its own label and the message links to the admin item", async () => {
  const fetches = stubFetch();
  const product = await cl();
  for (const [kind, label] of [
    ["issue", "New issue"],
    ["feedback", "New feedback"],
    ["email", "New email"],
    ["reply", "New reply"],
  ]) {
    await notifyNew(makeEnv(), product, { kind, itemId: "ITEM1" });
    const call = fetches.discord().at(-1);
    expect(call?.body.content).toContain(label);
    expect(call?.body.content).toContain("Climbing Logbook");
    expect(call?.body.content).toContain("https://engage.oneloneraven.com/items/ITEM1");
    expect(call?.body.allowed_mentions).toEqual({ parse: [] });
  }
});

test("the webhook comes from the secret the product names", async () => {
  const fetches = stubFetch();
  const product = { ...(await cl()), discordSecret: "DISCORD_WEBHOOK_OTHER" };
  await notifyNew(makeEnv({ DISCORD_WEBHOOK_OTHER: "https://discord.example/api/webhooks/2/other" }), product, {
    kind: "issue",
    itemId: "X",
  });
  expect(fetches.spy.mock.calls[0][0]).toBe("https://discord.example/api/webhooks/2/other");
  expect(fetches.discord()).toHaveLength(0);
  expect(DISCORD_URL).not.toBe("https://discord.example/api/webhooks/2/other");
});

test("a missing secret skips the ping and is logged without content", async () => {
  const fetches = stubFetch();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await notifyNew(makeEnv({ DISCORD_WEBHOOK_CL: undefined }), await cl(), { kind: "issue", itemId: "X" });
  expect(fetches.spy).not.toHaveBeenCalled();
  expect(warn.mock.calls.flat().join(" ")).toContain("discord.skipped");
});

test("a rejected or failing request never throws, and the webhook URL is never logged", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error(`boom ${DISCORD_URL}`));
  await expect(notifyNew(makeEnv(), await cl(), { kind: "issue", itemId: "X" })).resolves.toBeUndefined();
  stubFetch({ discordStatus: 429 });
  await expect(notifyNew(makeEnv(), await cl(), { kind: "issue", itemId: "X" })).resolves.toBeUndefined();
  const logged = warn.mock.calls.flat().join(" ");
  expect(logged).toContain("discord.failed");
  expect(logged).not.toContain("discord.example");
});
