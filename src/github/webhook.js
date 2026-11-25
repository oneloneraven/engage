import { hmacHex, timingSafeEqual } from "../lib/hmac.js";
import { json } from "../lib/http.js";
import { log } from "../lib/log.js";
import { handleProtectionRule } from "../releases/gate.js";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * GitHub's webhook, signed with the App's webhook secret. Issue events flag or clear "reply owed" on linked items, and
 * deployment protection rule events become pending releases.
 * @param {Request} request
 * @param {{ DB: import("../lib/db.js").Database, GITHUB_WEBHOOK_SECRET?: string, ADMIN_HOST?: string, APP_ENV?: string, RELEASE_VERSION?: string }} env
 * @returns {Promise<Response>}
 */
export async function handleGithubWebhook(request, env) {
  if (request.method !== "POST") return json({ error: "not-found" }, 404);
  if (!env.GITHUB_WEBHOOK_SECRET) {
    log(env, "error", "github.webhook-secret-missing");
    return json({ error: "unauthorised" }, 401);
  }
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return json({ error: "too-large" }, 413);
  const body = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256") ?? "";
  const expected = `sha256=${await hmacHex(env.GITHUB_WEBHOOK_SECRET, body)}`;
  if (!timingSafeEqual(signature, expected)) return json({ error: "unauthorised" }, 401);

  const event = request.headers.get("X-GitHub-Event");
  if (event !== "issues" && event !== "deployment_protection_rule") return new Response(null, { status: 204 });
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "invalid-body" }, 400);
  }
  if (event === "deployment_protection_rule") return handleProtectionRule(env, payload);
  return handleIssue(env, payload);
}

/**
 * The issue's current state decides, not the event name, so repeats and late arrivals settle on the right answer.
 * @param {{ DB: import("../lib/db.js").Database }} env
 * @param {{ issue?: { html_url?: string, state?: string } }} payload
 * @returns {Promise<Response>}
 */
async function handleIssue(env, payload) {
  const url = payload.issue?.html_url;
  const state = payload.issue?.state;
  if (!url || (state !== "open" && state !== "closed")) return new Response(null, { status: 204 });

  if (state === "closed") {
    await env.DB.prepare(
      "UPDATE items SET reply_owed_at = ? WHERE issue_url = ? AND reply_owed_at IS NULL AND contact_email IS NOT NULL",
    )
      .bind(new Date().toISOString(), url)
      .run();
  } else {
    await env.DB.prepare("UPDATE items SET reply_owed_at = NULL WHERE issue_url = ?").bind(url).run();
  }
  return new Response(null, { status: 204 });
}
