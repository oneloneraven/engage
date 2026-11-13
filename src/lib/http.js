const NO_STORE = { "Cache-Control": "no-store" };

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { ...NO_STORE, ...Object.fromEntries(new Headers(headers)) } });

export const notFound = () => json({ error: "not-found" }, 404);

export const forbidden = () => json({ error: "forbidden" }, 403);
