import { log } from "./lib/log.js";
import { namedSecret } from "./lib/secrets.js";

const LABELS = { issue: "New issue", feedback: "New feedback", email: "New email", reply: "New reply" };

/**
 * Content-free: the kind, the product and a link behind Access. Never throws.
 * @param {{ ADMIN_HOST?: string, APP_ENV?: string, RELEASE_VERSION?: string }} env
 * @param {import("./registry.js").Product} product
 * @param {{ kind: 'issue' | 'feedback' | 'email' | 'reply', itemId: string }} n
 * @returns {Promise<void>}
 */
export async function notifyNew(env, product, { kind, itemId }) {
  const webhook = namedSecret(env, product.discordSecret);
  if (!webhook) {
    log(env, "warn", "discord.skipped", { product: product.slug });
    return;
  }
  const content = `**${LABELS[kind]}** · ${product.name}\nhttps://${env.ADMIN_HOST}/items/${itemId}`;
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) log(env, "warn", "discord.failed", { product: product.slug, status: response.status });
  } catch (error) {
    log(env, "warn", "discord.failed", {
      product: product.slug,
      errorName: error instanceof Error ? error.name : "unknown",
    });
  }
}
