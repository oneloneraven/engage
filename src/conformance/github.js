import { API, HEADERS } from "../github/app.js";

const TIMEOUT_MS = 10_000;

export class ReadError extends Error {
  /** @param {string} what @param {number} status */
  constructor(what, status) {
    super(`read-${status}`);
    this.what = what;
    this.status = status;
  }
}

/**
 * @typedef {{ status: number, body: any }} Answer
 * @typedef {{ get: (path: string) => Promise<Answer>, file: (repo: string, path: string, ref?: string) => Promise<string | null> }} Reader
 */

/**
 * Read-only GitHub access for the conformance run. `get` never throws: a failure comes back as its status, and a network
 * error or timeout as status 0.
 * @param {string} token
 * @returns {Reader}
 */
export function reader(token) {
  /** @param {string} path */
  async function get(path) {
    try {
      const response = await fetch(`${API}${path}`, {
        headers: { ...HEADERS, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return { status: response.status, body: response.ok ? await response.json() : null };
    } catch {
      return { status: 0, body: null };
    }
  }

  /**
   * A file's text, or null when it doesn't exist.
   * @param {string} repo
   * @param {string} path
   * @param {string} [ref]
   */
  async function file(repo, path, ref) {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const { status, body } = await get(
      `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${query}`,
    );
    if (status === 404) return null;
    if (status !== 200 || typeof body?.content !== "string") throw new ReadError(path, status);
    const bytes = Uint8Array.from(atob(body.content.replace(/\s+/g, "")), char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  return { get, file };
}
