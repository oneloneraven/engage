import { log } from "../lib/log.js";

const API_ORIGIN = "https://incidents.betterstack.com";
const MONITORS_URL = `${API_ORIGIN}/api/v2/monitors?per_page=250`;
const OPEN_INCIDENTS_URL = `${API_ORIGIN}/api/v5/incidents?resolved=false&per_page=250`;
const MAX_PAGES = 20;
const TIMEOUT_MS = 10_000;
const LEFT_OUT = new Set(["paused", "pending", "maintenance"]);

/**
 * @typedef {{ DB: import("../lib/db.js").Database, BETTER_STACK_TOKEN?: string, APP_ENV?: string, RELEASE_VERSION?: string }} HealthEnv
 * @typedef {{ id: string, name: string, url: string }} MonitorConfig
 * @typedef {"healthy" | "degraded" | "failing" | "unmonitored" | "unknown"} HealthStatus
 * @typedef {{ status: HealthStatus, reason: string | null, link: string | null }} Health
 * @typedef {"up" | "down" | "recovering" | "incident" | "paused" | "pending" | "maintenance" | "missing" | "unknown"} MonitorStatus
 * @typedef {{ name: string, url: string, status: MonitorStatus }} MonitorState
 * @typedef {{ statuses: Map<string, string>, incidents: Set<string> }} BetterStackView
 */

class BetterStackUnavailable extends Error {}

/**
 * Every page of a Better Stack list. A next page on any other origin is refused, so the token only goes to Better Stack.
 * @param {string} first
 * @param {string} token
 * @returns {Promise<any[]>}
 */
async function readAll(first, token) {
  const items = [];
  /** @type {string | null} */
  let url = first;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (new URL(url).origin !== API_ORIGIN) throw new BetterStackUnavailable("foreign-page");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new BetterStackUnavailable(`status-${response.status}`);
    const body = /** @type {{ data?: any[], pagination?: { next?: string | null } }} */ (await response.json());
    items.push(...(body.data ?? []));
    url = body.pagination?.next ?? null;
  }
  if (url) throw new BetterStackUnavailable("too-many-pages");
  return items;
}

/**
 * @param {string} token
 * @returns {Promise<BetterStackView>}
 */
async function readBetterStack(token) {
  const [monitors, incidents] = await Promise.all([readAll(MONITORS_URL, token), readAll(OPEN_INCIDENTS_URL, token)]);
  return {
    statuses: new Map(monitors.map(monitor => [String(monitor.id), String(monitor.attributes?.status)])),
    incidents: new Set(
      incidents
        .filter(incident => incident.attributes?.resolved_at == null)
        .map(incident => incident.relationships?.monitor?.data?.id)
        .filter(id => id != null)
        .map(String),
    ),
  };
}

/**
 * @param {MonitorConfig[]} culprits
 * @param {string} verb
 */
function describe(culprits, verb) {
  const [first] = culprits;
  const subject = culprits.length === 1 ? first.name : `${first.name} and ${culprits.length - 1} more`;
  return `${subject} ${culprits.length === 1 ? "is" : "are"} ${verb}`;
}

/**
 * Failing outranks degraded, which outranks unknown, which outranks healthy.
 * @param {MonitorConfig[]} monitors
 * @param {BetterStackView} view
 * @returns {Health}
 */
function judge(monitors, view) {
  const watched = monitors.filter(monitor => !LEFT_OUT.has(view.statuses.get(monitor.id) ?? ""));
  const down = watched.filter(monitor => view.statuses.get(monitor.id) === "down");
  if (down.length) return { status: "failing", reason: describe(down, "down"), link: down[0].url };
  const recovering = watched.filter(monitor => view.statuses.get(monitor.id) === "validating");
  if (recovering.length)
    return { status: "degraded", reason: describe(recovering, "recovering"), link: recovering[0].url };
  const incident = watched.find(monitor => view.incidents.has(monitor.id));
  if (incident) return { status: "degraded", reason: `Open incident on ${incident.name}`, link: incident.url };
  const missing = watched.find(monitor => !view.statuses.has(monitor.id));
  if (missing) return { status: "unknown", reason: `${missing.name} isn't in Better Stack`, link: null };
  if (!watched.length) return { status: "unmonitored", reason: null, link: null };
  return { status: "healthy", reason: null, link: null };
}

const PASSED_THROUGH = new Set(["up", "down", "paused", "pending", "maintenance"]);

/**
 * Each monitor as Better Stack last saw it, or unknown when it couldn't be asked.
 * @param {MonitorConfig[]} monitors
 * @param {BetterStackView | null} view
 * @returns {MonitorState[]}
 */
function monitorStates(monitors, view) {
  return monitors.map(({ name, url, id }) => {
    const raw = view?.statuses.get(id);
    /** @type {MonitorStatus} */
    let status = "unknown";
    if (view && raw === undefined) status = "missing";
    else if (raw === "validating") status = "recovering";
    else if (raw && PASSED_THROUGH.has(raw)) status = /** @type {MonitorStatus} */ (raw);
    if (status === "up" && view?.incidents.has(id)) status = "incident";
    return { name, url, status };
  });
}

/**
 * @param {unknown} raw
 * @returns {MonitorConfig[] | null} null when the config can't be read
 */
function monitorsOf(raw) {
  try {
    const parsed = JSON.parse(String(raw));
    const monitors = parsed?.betterStack?.monitors ?? [];
    if (!Array.isArray(monitors)) return null;
    return monitors.map(monitor => ({ id: String(monitor.id), name: String(monitor.name), url: String(monitor.url) }));
  } catch {
    return null;
  }
}

/**
 * Reads every product's Better Stack monitors and open incidents, and writes one `health_state` row per product.
 * Better Stack being unreachable makes monitored products unknown: an outage at the monitor isn't an outage of the product.
 * @param {HealthEnv} env
 * @param {Date} now
 */
export async function refreshHealth(env, now) {
  const products = await env.DB.prepare("SELECT slug, health_sources FROM products ORDER BY slug").all();
  const configs = products.results.map(row => ({ slug: String(row.slug), monitors: monitorsOf(row.health_sources) }));

  /** @type {BetterStackView | null} */
  let view = null;
  /** @type {string | null} */
  let unavailable = null;
  if (configs.some(config => config.monitors?.length)) {
    if (!env.BETTER_STACK_TOKEN) {
      unavailable = "Better Stack isn't set up";
      log(env, "warn", "health.not-configured");
    } else {
      try {
        view = await readBetterStack(env.BETTER_STACK_TOKEN);
      } catch (error) {
        unavailable = "Couldn't reach Better Stack";
        log(env, "warn", "health.unavailable", { errorName: error instanceof Error ? error.name : "Error" });
      }
    }
  }

  const checkedAt = now.toISOString();
  const upsert = env.DB.prepare(
    `INSERT INTO health_state (product, status, reason, link, monitors, checked_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (product) DO UPDATE SET status = excluded.status, reason = excluded.reason, link = excluded.link,
       monitors = excluded.monitors, checked_at = excluded.checked_at`,
  );
  const statements = configs.map(({ slug, monitors }) => {
    /** @type {Health} */
    let health;
    if (monitors === null) {
      health = { status: "unknown", reason: "Health settings can't be read", link: null };
      log(env, "warn", "health.bad-config", { product: slug });
    } else if (!monitors.length) health = { status: "unmonitored", reason: null, link: null };
    else if (view) health = judge(monitors, view);
    else health = { status: "unknown", reason: unavailable, link: null };
    log(env, "info", "health.checked", { product: slug, status: health.status });
    const states = monitors ? monitorStates(monitors, view) : [];
    return upsert.bind(slug, health.status, health.reason, health.link, JSON.stringify(states), checkedAt);
  });
  if (statements.length) await env.DB.batch(statements);
}
