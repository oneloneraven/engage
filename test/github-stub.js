import { vi } from "vitest";

/** @param {unknown} value */
export const contents = value => ({
  content: btoa(
    String.fromCharCode(...new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))),
  ),
  encoding: "base64",
});

/**
 * Stubs GitHub's API: each key is a path (with its query) and each value is a JSON body, or `{ status }` for a failure.
 * An unlisted path is a 404. Returns the paths asked for.
 * @param {Record<string, unknown>} routes
 */
export function stubGithub(routes) {
  /** @type {string[]} */
  const asked = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const path = `${url.pathname}${url.search}`;
    asked.push(path);
    if (url.origin !== "https://api.github.com") return new Response("unexpected", { status: 599 });
    if (!Object.hasOwn(routes, path)) return new Response("{}", { status: 404 });
    const answer = /** @type {any} */ (routes[path]);
    if (answer && typeof answer === "object" && "status" in answer && Object.keys(answer).length === 1)
      return new Response("{}", { status: answer.status });
    return Response.json(answer);
  });
  return asked;
}
