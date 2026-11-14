// Checked as well as Access itself, so a misconfigured or tampered Access application can't open the admin host to anyone but the owner.

const KEYS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const SKIPPABLE_ENVIRONMENTS = ["e2e", "development"];

/** @typedef {JsonWebKey & { kid?: string }} AccessKey */
/** @typedef {{ email: string }} AccessIdentity */

/** @type {{ teamDomain: string, keys: AccessKey[], at: number } | null} */
let cachedKeys = null;

/** @param {string} value */
function base64UrlToBytes(value) {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

/** @param {string} part */
function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

/**
 * @param {string} teamDomain
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<AccessKey[]>}
 */
async function fetchKeys(teamDomain, fetchImpl) {
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) return [];
  const { keys } = /** @type {{ keys?: unknown }} */ (await res.json());
  cachedKeys = { teamDomain, keys: Array.isArray(keys) ? keys : [], at: Date.now() };
  return cachedKeys.keys;
}

// Keys rotate, so a kid the cache doesn't know fetches them again.
/**
 * @param {string} kid
 * @param {string} teamDomain
 * @param {typeof fetch} fetchImpl
 */
async function findKey(kid, teamDomain, fetchImpl) {
  const fresh = cachedKeys && cachedKeys.teamDomain === teamDomain && Date.now() - cachedKeys.at < KEYS_TTL_MS;
  const cached = fresh ? cachedKeys?.keys.find(key => key.kid === kid) : undefined;
  if (cached) return cached;
  return (await fetchKeys(teamDomain, fetchImpl)).find(key => key.kid === kid);
}

/**
 * @param {string} token
 * @param {{ teamDomain: string, aud: string, fetchImpl?: typeof fetch, nowS?: number }} options
 * @returns {Promise<AccessIdentity | null>}
 */
export async function verifyAccessJwt(token, { teamDomain, aud, fetchImpl = fetch, nowS = Date.now() / 1000 }) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodeJson(headerPart);
    if (header.alg !== "RS256" || !header.kid) return null;

    const jwk = await findKey(header.kid, teamDomain, fetchImpl);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlToBytes(signaturePart), signed))) return null;

    const payload = decodeJson(payloadPart);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(aud)) return null;
    if (payload.iss !== `https://${teamDomain}`) return null;
    if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_S < nowS) return null;
    if (typeof payload.nbf === "number" && payload.nbf - CLOCK_SKEW_S > nowS) return null;
    if (typeof payload.email !== "string" || !payload.email) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

/**
 * The verified Access identity behind a request to the admin host, or null.
 * @param {Request} request
 * @param {{ APP_ENV?: string, ADMIN_ACCESS_CHECK?: string, ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string, OWNER_EMAIL?: string }} env
 * @param {{ fetchImpl?: typeof fetch, nowS?: number }} [options]
 * @returns {Promise<AccessIdentity | null>}
 */
export async function adminIdentity(request, env, options = {}) {
  if (env.ADMIN_ACCESS_CHECK === "off" && SKIPPABLE_ENVIRONMENTS.includes(env.APP_ENV ?? "")) {
    return { email: "dev@localhost" };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const owner = env.OWNER_EMAIL?.trim().toLowerCase();
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !owner) return null;
  const identity = await verifyAccessJwt(token, {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
    ...options,
  });
  return identity?.email.toLowerCase() === owner ? identity : null;
}

export function clearAccessKeyCache() {
  cachedKeys = null;
}
