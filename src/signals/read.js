const DAY_MS = 86_400_000;
const STALE_MS = 15 * 60_000;
const WINDOW_DAYS = 30;
const MIN_DAYS = 25;
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
 * The panel's entry: the one marked primary, or the first.
 * @param {unknown} raw
 * @returns {{ source: string, metric: string, label: string } | null}
 */
function primaryOf(raw) {
  try {
    const entries = JSON.parse(String(raw));
    if (!Array.isArray(entries)) return null;
    const entry = entries.find(e => e?.primary === true) ?? entries[0];
    return entry && typeof entry.metric === "string" && SHAPES[entry.source]
      ? { source: entry.source, metric: entry.metric, label: String(entry.label ?? entry.metric) }
      : null;
  } catch {
    return null;
  }
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
 * @param {{ day: string, value: number }[]} rows oldest first, covering the last 61 days
 * @param {number} yesterday ms
 * @returns {Omit<EngagementSignal, "label">}
 */
function engagementOf(shape, rows, yesterday) {
  const windowStart = dayOf(yesterday - (WINDOW_DAYS - 1) * DAY_MS);
  if (shape === "level") {
    const series = rows.filter(row => row.day >= windowStart);
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
  const series = [...daily].filter(([d]) => d >= windowStart).map(([d, value]) => ({ day: d, value }));
  if (!series.length) return { value: null, series: [], change: null };
  const current = windowSum(daily, yesterday);
  const previous = windowSum(daily, yesterday - WINDOW_DAYS * DAY_MS);
  return {
    value: series.reduce((sum, point) => sum + point.value, 0),
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
    const primary = primaryOf(row.engagement);
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
