import { sentenceFor } from "./errors.js";

/** @typedef {import("../admin/items.js").ItemSummary} ItemSummary */
/** @typedef {import("../admin/items.js").ItemDetail} ItemDetail */
/** @typedef {import("../github/app.js").IssueDraft} IssueDraft */
/** @typedef {{ new: number, open: number, replyOwed: number, byProduct: Record<string, { name: string, new: number, open: number }> }} Counts */

class ApiError extends Error {
  /**
   * @param {string} code
   * @param {number} status
   */
  constructor(code, status) {
    super(sentenceFor(code));
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<any>}
 */
async function request(method, path, body) {
  /** @type {Response} */
  let response;
  try {
    response = await fetch(path, {
      method,
      ...(body !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError("network", 0);
  }
  /** @type {any} */
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok)
    throw new ApiError(typeof payload?.error === "string" ? payload.error : "internal", response.status);
  return payload;
}

const item = (/** @type {string} */ id) => `/api/items/${encodeURIComponent(id)}`;

/** @returns {Promise<Counts>} */
export const getCounts = () => request("GET", "/api/counts");

/**
 * @param {Record<string, string | undefined>} filters
 * @returns {Promise<{ items: ItemSummary[], next: string | null }>}
 */
export function listItems(filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) query.set(name, value);
  const suffix = query.size > 0 ? `?${query}` : "";
  return request("GET", `/api/items${suffix}`);
}

/**
 * Reading an item marks it read.
 * @param {string} id
 * @returns {Promise<ItemDetail>}
 */
export const getItem = id => request("GET", item(id));

/**
 * @param {string} id
 * @param {{ read?: boolean, starred?: boolean, archived?: boolean, junk?: boolean, replyOwed?: false }} change
 * @returns {Promise<ItemDetail>}
 */
export const patchItem = (id, change) => request("PATCH", item(id), change);

/** @param {string} id */
export const deleteItem = id => request("DELETE", item(id));

/**
 * @param {string} id
 * @param {string} text
 */
export const sendReply = (id, text) => request("POST", `${item(id)}/replies`, { text });

/**
 * @param {string} id
 * @returns {Promise<IssueDraft>}
 */
export const getIssueDraft = id => request("GET", `${item(id)}/issue-draft`);

/**
 * @param {string} id
 * @param {IssueDraft} draft
 * @returns {Promise<{ number: number, url: string }>}
 */
export const createIssue = (id, draft) => request("POST", `${item(id)}/issue`, draft);

/**
 * @param {string} id
 * @param {string} excerpt
 * @returns {Promise<{ id: string }>}
 */
export const createExcerpt = (id, excerpt) => request("POST", `${item(id)}/testimonials`, { excerpt });

/** @param {string} testimonialId */
export const approveTestimonial = testimonialId =>
  request("POST", `/api/testimonials/${encodeURIComponent(testimonialId)}/approve`);

/** @param {string} testimonialId */
export const withdrawTestimonial = testimonialId =>
  request("POST", `/api/testimonials/${encodeURIComponent(testimonialId)}/withdraw`);
