const NO_STORE = { "Cache-Control": "no-store" };

/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {HeadersInit} [headers]
 */
export function json(body, status = 200, headers = {}) {
  const merged = new Headers(NO_STORE);
  for (const [name, value] of new Headers(headers)) merged.set(name, value);
  return Response.json(body, { status, headers: merged });
}

export const notFound = () => json({ error: "not-found" }, 404);

export const forbidden = () => json({ error: "forbidden" }, 403);
