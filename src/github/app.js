import { recordAudit } from "../audit.js";

const API = "https://api.github.com";
const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "oneloneraven-engage",
};
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

/** @typedef {{ GITHUB_APP_ID?: string, GITHUB_APP_PRIVATE_KEY?: string }} GithubEnv */
/** @typedef {{ repo: string, title: string, body: string, labels: string[] }} IssueDraft */

/** @type {Map<string, { token: string, expiresAt: number }>} */
const tokens = new Map();

/** @param {Uint8Array | string} value */
function base64url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** @param {string} pem a PKCS#8 private key */
async function importKey(pem) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), char => char.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/**
 * A short-lived JWT that authenticates as the App itself.
 * @param {string} appId
 * @param {string} pem a PKCS#8 private key
 * @param {number} [nowS]
 */
export async function appJwt(appId, pem, nowS = Math.floor(Date.now() / 1000)) {
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ iat: nowS - 60, exp: nowS + 540, iss: appId }),
  )}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importKey(pem),
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

/**
 * @param {string} method
 * @param {string} path
 * @param {string} token
 * @param {unknown} [body]
 */
async function call(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...HEADERS, Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`github-${response.status}`);
  return response.status === 204 ? null : response.json();
}

/**
 * An installation token for the organisation that owns `owner`, cached until five minutes before it expires.
 * @param {GithubEnv} env
 * @param {string} owner
 * @returns {Promise<string>}
 */
export async function installationToken(env, owner) {
  const cached = tokens.get(owner);
  if (cached && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cached.token;
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new Error("github-app-not-configured");
  const jwt = await appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const installation = /** @type {{ id: number }} */ (
    await call("GET", `/orgs/${encodeURIComponent(owner)}/installation`, jwt)
  );
  const granted = /** @type {{ token: string, expires_at: string }} */ (
    await call("POST", `/app/installations/${installation.id}/access_tokens`, jwt)
  );
  tokens.set(owner, { token: granted.token, expiresAt: Date.parse(granted.expires_at) });
  return granted.token;
}

export function clearInstallationTokens() {
  tokens.clear();
}

/** @param {string} repo */
function splitRepo(repo) {
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repo);
  if (!match) throw new Error("bad-repo");
  return { owner: match[1], name: match[2] };
}

/**
 * Creates the issue and links it to the item. Only repositories a product registers can be written to.
 * @param {GithubEnv & { DB: import("../lib/db.js").Database }} env
 * @param {string} itemId
 * @param {IssueDraft} draft
 * @param {string} actor
 * @returns {Promise<{ number: number, url: string }>}
 */
export async function createIssue(env, itemId, draft, actor) {
  const item = await env.DB.prepare("SELECT issue_url FROM items WHERE id = ?").bind(itemId).first();
  if (!item) throw new Error("not-found");
  if (item.issue_url) throw new Error("issue-exists");
  const registered = await env.DB.prepare("SELECT 1 AS ok FROM products WHERE issue_repo = ?").bind(draft.repo).first();
  if (!registered) throw new Error("repo-not-registered");
  const { owner, name } = splitRepo(draft.repo);
  const token = await installationToken(env, owner);
  const issue = /** @type {{ number: number, html_url: string }} */ (
    await call("POST", `/repos/${owner}/${name}/issues`, token, {
      title: draft.title,
      body: draft.body,
      labels: draft.labels,
    })
  );
  await env.DB.prepare("UPDATE items SET issue_number = ?, issue_url = ? WHERE id = ?")
    .bind(issue.number, issue.html_url, itemId)
    .run();
  await recordAudit(env, {
    actor,
    action: "issue.created",
    targetType: "item",
    targetId: itemId,
    detail: { repo: draft.repo, number: issue.number },
  });
  return { number: issue.number, url: issue.html_url };
}

/**
 * Fires a repository_dispatch event, used to rebuild a product's site.
 * @param {GithubEnv} env
 * @param {string} repo
 * @param {string} eventType
 */
export async function dispatch(env, repo, eventType) {
  const { owner, name } = splitRepo(repo);
  await call("POST", `/repos/${owner}/${name}/dispatches`, await installationToken(env, owner), {
    event_type: eventType,
  });
}
