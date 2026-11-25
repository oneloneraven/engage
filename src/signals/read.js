const DAY_MS = 86_400_000;
const STALE_MS = 15 * 60_000;
const WINDOW_DAYS = 30;
const MIN_DAYS = 25;
const USAGE_DAYS = 90;
/** How each source's numbers add up: a flow sums over the window, a level is read as it stands, a total grows forever. */
const SHAPES = /** @type {Record<string, "flow" | "level" | "total">} */ ({
  "web-visits": "flow",
  "cl-usage": "level",
  "github-downloads": "total",
});

/**
 * @typedef {{ status: string, reason: string | null, link: string | null, checkedAt: string | null }} HealthSignal
 * @typedef {{ day: string, value: number }} Point
 * @typedef {{ label: string, value: number | null, series: Point[], change: number | null }} EngagementSignal
 * @typedef {{ version: string, production: string, since: string, amber: boolean }} BetaSignal
 * @typedef {{ health: HealthSignal, engagement: EngagementSignal | null, beta: BetaSignal | null }} Signals
 * @typedef {{ name: string, url: string, status: string }} MonitorState
 * @typedef {EngagementSignal & { primary: boolean }} UsageMetric
 * @typedef {{ health: HealthSignal & { monitors: MonitorState[] }, usage: UsageMetric[], gated: { repo: string, environments: string[] }[] }} ProductDetail
 */

/** @param {number} ms */
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);

/** @param {number} current @param {number} previous */
const percent = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

/**
 * @param {Record<string, unknown> | undefined} row
 * @param {Date} now
 * @returns {HealthSignal}
 */
function healthOf(row, now) {
  if (!row) return { status: "unknown", reason: "Not checked yet", link: null, checkedAt: null };
  const checkedAt = String(row.checked_at);
  const age = now.getTime() - Date.parse(checkedAt);
  if (age > STALE_MS) {
    const minutes = Math.floor(age / 60_000);
    const reason =
      minutes < 120 ? `Last checked ${minutes} minutes ago` : `Last checked ${Math.floor(minutes / 60)} hours ago`;
    return { status: "unknown", reason, link: null, checkedAt };
  }
  return {
    status: String(row.status),
    reason: row.reason == null ? null : String(row.reason),
    link: row.link == null ? null : String(row.link),
    checkedAt,
  };
}

/**
 * Every engagement entry that names a known source, with the primary one marked: the one so marked, or the first.
 * @param {unknown} raw
 * @returns {{ source: string, metric: string, label: string, primary: boolean }[]}
 */
function entriesOf(raw) {
  const valid = arrayIn(raw).filter(e => typeof e?.metric === "string" && SHAPES[e.source]);
  const primary = Math.max(
    0,
    valid.findIndex(e => e.primary === true),
  );
  return valid.map((e, n) => ({
    source: String(e.source),
    metric: String(e.metric),
    label: String(e.label ?? e.metric),
    primary: n === primary,
  }));
}

/**
 * Sums a window of daily values, or null when fewer than MIN_DAYS of it are known.
 * @param {Map<string, number>} byDay
 * @param {number} end ms of the window's last day
 */
function windowSum(byDay, end) {
  let sum = 0;
  let known = 0;
  for (let n = 0; n < WINDOW_DAYS; n++) {
    const value = byDay.get(dayOf(end - n * DAY_MS));
    if (value === undefined) continue;
    sum += value;
    known++;
  }
  return known >= MIN_DAYS ? sum : null;
}

/**
 * @param {"flow" | "level" | "total"} shape
 * @param {{ day: string, value: number }[]} rows oldest first, covering at least the last 61 days
 * @param {number} yesterday ms
 * @param {number} [days] how many days the series covers; the value and change are always over the 30-day window
 * @returns {Omit<EngagementSignal, "label">}
 */
function engagementOf(shape, rows, yesterday, days = WINDOW_DAYS) {
  const windowStart = dayOf(yesterday - (WINDOW_DAYS - 1) * DAY_MS);
  const seriesStart = dayOf(yesterday - (days - 1) * DAY_MS);
  if (shape === "level") {
    const series = rows.filter(row => row.day >= seriesStart);
    const latest = series.at(-1);
    if (!latest) return { value: null, series: [], change: null };
    const before = rows.find(row => row.day === dayOf(Date.parse(latest.day) - WINDOW_DAYS * DAY_MS));
    return { value: latest.value, series, change: before ? percent(latest.value, before.value) : null };
  }
  /** @type {Map<string, number>} */
  const daily = new Map();
  if (shape === "flow") for (const row of rows) daily.set(row.day, row.value);
  else {
    const totals = new Map(rows.map(row => [row.day, row.value]));
    for (const row of rows) {
      const previous = totals.get(dayOf(Date.parse(row.day) - DAY_MS));
      if (previous !== undefined) daily.set(row.day, Math.max(0, row.value - previous));
    }
  }
  const series = [...daily].filter(([d]) => d >= seriesStart).map(([d, value]) => ({ day: d, value }));
  if (!series.length) return { value: null, series: [], change: null };
  const current = windowSum(daily, yesterday);
  const previous = windowSum(daily, yesterday - WINDOW_DAYS * DAY_MS);
  return {
    value: series.filter(point => point.day >= windowStart).reduce((sum, point) => sum + point.value, 0),
    series,
    change: current !== null && previous !== null ? percent(current, previous) : null,
  };
}

/**
 * Everything Home shows about each product's health, engagement and beta, read from what the cron jobs stored.
 * @param {{ DB: import("../lib/db.js").Database }} env
 * @param {Date} now
 * @returns {Promise<Record<string, Signals>>}
 */
export async function readSignals(env, now) {
  const yesterday = Date.parse(dayOf(now.getTime())) - DAY_MS;
  const since = dayOf(yesterday - 2 * WINDOW_DAYS * DAY_MS);
  const [products, health, snapshots, versions] = await Promise.all([
    env.DB.prepare("SELECT slug, engagement, beta_amber_days FROM products ORDER BY slug").all(),
    env.DB.prepare("SELECT product, status, reason, link, checked_at FROM health_state").all(),
    env.DB.prepare("SELECT product, metric, day, value FROM metric_snapshots WHERE day >= ? AND day <= ? ORDER BY day")
      .bind(since, dayOf(yesterday))
      .all(),
    env.DB.prepare("SELECT product, environment, version, first_seen FROM deployed_versions").all(),
  ]);

  /** @type {Record<string, Signals>} */
  const signals = {};
  for (const row of products.results) {
    const slug = String(row.slug);
    const primary = entriesOf(row.engagement).find(entry => entry.primary);
    /** @type {EngagementSignal | null} */
    let engagement = null;
    if (primary) {
      const rows = snapshots.results
        .filter(s => s.product === slug && s.metric === primary.metric)
        .map(s => ({ day: String(s.day), value: Number(s.value) }));
      engagement = { label: primary.label, ...engagementOf(SHAPES[primary.source], rows, yesterday) };
    }
    const production = versions.results.find(v => v.product === slug && v.environment === "production");
    const beta = versions.results.find(v => v.product === slug && v.environment === "beta");
    const ahead =
      production && beta && production.version !== beta.version
        ? {
            version: String(beta.version),
            production: String(production.version),
            since: String(beta.first_seen),
            amber: now.getTime() - Date.parse(String(beta.first_seen)) > Number(row.beta_amber_days) * DAY_MS,
          }
        : null;
    signals[slug] = {
      health: healthOf(
        health.results.find(h => h.product === slug),
        now,
      ),
      engagement,
      beta: ahead,
    };
  }
  return signals;
}

/**
 * @param {unknown} raw JSON text
 * @param {(parsed: any) => unknown} pick
 * @returns {any[]} the picked array, or empty when the text or the pick isn't one
 */
function arrayIn(raw, pick = parsed => parsed) {
  try {
    const value = pick(JSON.parse(String(raw)));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * One product's Health and Usage pages and which of its repositories are gated, read from what the cron jobs stored.
 * Monitors are the configured ones, each unknown until checked or while the last check is stale.
 * @param {{ DB: import("../lib/db.js").Database }} env
 * @param {string} slug
 * @param {Date} now
 * @returns {Promise<ProductDetail | null>}
 */
export async function readProduct(env, slug, now) {
  const yesterday = Date.parse(dayOf(now.getTime())) - DAY_MS;
  const since = dayOf(yesterday - USAGE_DAYS * DAY_MS);
  const [product, health, snapshots, repos] = await Promise.all([
    env.DB.prepare("SELECT health_sources, engagement FROM products WHERE slug = ?").bind(slug).first(),
    env.DB.prepare("SELECT status, reason, link, monitors, checked_at FROM health_state WHERE product = ?")
      .bind(slug)
      .first(),
    env.DB.prepare(
      "SELECT metric, day, value FROM metric_snapshots WHERE product = ? AND day >= ? AND day <= ? ORDER BY day",
    )
      .bind(slug, since, dayOf(yesterday))
      .all(),
    env.DB.prepare("SELECT repo, environments FROM release_repos WHERE product = ? ORDER BY repo").bind(slug).all(),
  ]);
  if (!product) return null;
  const fresh = health && now.getTime() - Date.parse(String(health.checked_at)) <= STALE_MS;
  /** @type {MonitorState[]} */
  const stored = fresh ? arrayIn(health.monitors) : [];
  const monitors = arrayIn(product.health_sources, parsed => parsed?.betterStack?.monitors).map(m => {
    const name = String(m.name);
    const url = String(m.url);
    return { name, url, status: stored.find(s => s.name === name && s.url === url)?.status ?? "unknown" };
  });
  const usage = entriesOf(product.engagement).map(entry => {
    const rows = snapshots.results
      .filter(s => s.metric === entry.metric)
      .map(s => ({ day: String(s.day), value: Number(s.value) }));
    return {
      label: entry.label,
      primary: entry.primary,
      ...engagementOf(SHAPES[entry.source], rows, yesterday, USAGE_DAYS),
    };
  });
  const gated = repos.results.map(row => ({
    repo: String(row.repo),
    environments: arrayIn(row.environments).map(String),
  }));
  return { health: { ...healthOf(health ?? undefined, now), monitors }, usage, gated };
}
