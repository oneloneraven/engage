const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const DAY_MS = 86_400_000;
const QUERY = `query Visits($accountTag: string!, $siteTag: string!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      rumPageloadEventsAdaptiveGroups(limit: 1, filter: { siteTag: $siteTag, datetime_geq: $from, datetime_lt: $to }) {
        sum { visits }
      }
    }
  }
}`;

/** @typedef {{ CLOUDFLARE_ACCOUNT_ID?: string, CLOUDFLARE_ANALYTICS_TOKEN?: string }} WebVisitsEnv */

/** @param {WebVisitsEnv} env */
export const ready = env => Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ANALYTICS_TOKEN);

/** Web Analytics keeps history, so missing days can be filled in. */
export const canLookBack = true;

/**
 * Web Analytics visits for one UTC day. EU visitors are excluded at the edge (CL ADR-0015), so the label must say so.
 * @param {WebVisitsEnv} env
 * @param {{ siteTag?: unknown }} config
 * @param {string} day YYYY-MM-DD
 * @returns {Promise<number>}
 */
export async function read(env, config, day) {
  if (typeof config.siteTag !== "string" || !config.siteTag) throw new Error("bad-config");
  const from = new Date(`${day}T00:00:00.000Z`);
  const response = await fetch(GRAPHQL, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        accountTag: env.CLOUDFLARE_ACCOUNT_ID,
        siteTag: config.siteTag,
        from: from.toISOString(),
        to: new Date(from.getTime() + DAY_MS).toISOString(),
      },
    }),
  });
  if (!response.ok) throw new Error(`cloudflare-${response.status}`);
  const body = /** @type {{ data?: any, errors?: unknown[] | null }} */ (await response.json());
  if (body.errors?.length) throw new Error("cloudflare-graphql");
  const groups = body.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups;
  if (!Array.isArray(groups)) throw new Error("cloudflare-shape");
  return groups[0]?.sum?.visits ?? 0;
}
