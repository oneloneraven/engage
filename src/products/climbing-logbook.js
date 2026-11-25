import { log } from "../lib/log.js";
import { fetchUsage, ready } from "../signals/sources/cl-usage.js";

const KEY = /^[a-z0-9-]{1,40}$/;

/**
 * @typedef {{ key: string, climbs: number }} Share
 * @typedef {{ setUp: false } | { setUp: true, climbs: number, statuses: Share[], disciplines: Share[] }} Climbs
 */

/** @param {unknown} value */
const count = value => (Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null);

/**
 * Only whole, non-negative counts under plain keys, largest first. Anything else the endpoint sends is dropped.
 * @param {unknown} raw
 * @returns {Share[]}
 */
function shares(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw)
    .filter(([key, value]) => KEY.test(key) && count(value) !== null)
    .map(([key, value]) => ({ key, climbs: Number(value) }))
    .sort((a, b) => b.climbs - a.climbs);
}

/**
 * Climbing Logbook's climbs by status and by discipline, read live from its usage endpoint. Nothing is stored, and of
 * what the endpoint returns only these aggregate counts are kept.
 * @param {import("../signals/sources/cl-usage.js").ClUsageEnv & { DB: import("../lib/db.js").Database, APP_ENV?: string, RELEASE_VERSION?: string }} env
 * @returns {Promise<Climbs>}
 */
export async function readClimbs(env) {
  const row = await env.DB.prepare("SELECT engagement FROM products WHERE slug = 'cl'").first();
  let url = null;
  try {
    const entries = JSON.parse(String(row?.engagement));
    const entry = Array.isArray(entries) ? entries.find(e => e?.source === "cl-usage") : null;
    if (typeof entry?.url === "string" && entry.url.startsWith("https://")) url = entry.url;
  } catch {
    url = null;
  }
  if (!url || !ready(env)) return { setUp: false };
  let body;
  try {
    body = await fetchUsage(env, url);
  } catch (error) {
    log(env, "warn", "product-page.unavailable", {
      page: "climbs",
      errorName: error instanceof Error ? error.name : "Error",
    });
    throw new Error("product-unavailable");
  }
  const statuses = shares(body.statuses);
  const disciplines = shares(body.disciplines);
  return {
    setUp: true,
    climbs: count(body.climbs) ?? statuses.reduce((sum, share) => sum + share.climbs, 0),
    statuses,
    disciplines,
  };
}
