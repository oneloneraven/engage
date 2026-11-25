const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const JWKS_TTL_MS = 10 * 60 * 1000;
const LEEWAY_S = 60;

/**
 * @typedef {{
 *   repository: string, workflow_ref: string, ref: string, sha: string, environment: string,
 *   run_id: string, run_attempt: string,
 * }} ActionsClaims
 * @typedef {{ kid: string, kty: string, n: string, e: string }} Jwk
 */

/** @type {{ keys: Jwk[], fetchedAt: number } | null} */
let cache = null;

export function clearJwksCache() {
  cache = null;
}

/** @param {string} reason */
const invalid = reason => Object.assign(new Error("oidc-invalid"), { reason });

/** @param {string} part */
function decode(part) {
  const base64 = part
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(part.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  } catch {
    throw invalid("malformed");
  }
}

/** @param {string} part */
function decodeJson(part) {
  try {
    return JSON.parse(new TextDecoder().decode(decode(part)));
  } catch {
    throw invalid("malformed");
  }
}

/**
 * @param {string} kid
 * @param {number} now
 * @param {() => Promise<{ keys: Jwk[] }>} fetchJwks
 */
async function keyFor(kid, now, fetchJwks) {
  const fresh = cache && now - cache.fetchedAt < JWKS_TTL_MS;
  let key = fresh ? cache?.keys.find(k => k.kid === kid) : undefined;
  if (!key) {
    cache = { keys: (await fetchJwks()).keys, fetchedAt: now };
    key = cache.keys.find(k => k.kid === kid);
  }
  if (key?.kty !== "RSA") throw invalid("unknown-key");
  return crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: key.n, e: key.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function fetchGithubJwks() {
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw invalid("jwks-unavailable");
  return /** @type {Promise<{ keys: Jwk[] }>} */ (response.json());
}

/**
 * Verifies a GitHub Actions OIDC token and returns its claims. Every failure throws `oidc-invalid`, with the reason on
 * the error for logs only.
 * @param {string} token
 * @param {{ audience: string, now?: number, fetchJwks?: () => Promise<{ keys: Jwk[] }> }} options
 * @returns {Promise<ActionsClaims>}
 */
export async function verifyActionsToken(token, { audience, now = Date.now(), fetchJwks = fetchGithubJwks }) {
  const parts = token.split(".");
  if (parts.length !== 3) throw invalid("malformed");
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJson(headerPart);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw invalid("algorithm");
  const key = await keyFor(header.kid, now, fetchJwks);
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(signaturePart), signed)))
    throw invalid("signature");

  const claims = decodeJson(payloadPart);
  const nowS = Math.floor(now / 1000);
  if (claims.iss !== ISSUER) throw invalid("issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) throw invalid("audience");
  if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S < nowS) throw invalid("expired");
  if (typeof claims.nbf === "number" && claims.nbf - LEEWAY_S > nowS) throw invalid("not-yet-valid");
  for (const name of ["repository", "workflow_ref", "ref", "sha", "environment", "run_id", "run_attempt"])
    if (typeof claims[name] !== "string" || !claims[name]) throw invalid(`missing-${name}`);
  return {
    repository: claims.repository,
    workflow_ref: claims.workflow_ref,
    ref: claims.ref,
    sha: claims.sha,
    environment: claims.environment,
    run_id: claims.run_id,
    run_attempt: claims.run_attempt,
  };
}
