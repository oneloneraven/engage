export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (request: Request) => Promise<Response> }, APP_ENV: string, RELEASE_VERSION?: string }} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/health") {
      return Response.json(
        { ok: true, environment: env.APP_ENV, version: env.RELEASE_VERSION ?? "unreleased" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
