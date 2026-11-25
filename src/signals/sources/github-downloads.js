import { githubCall, installationToken } from "../../github/app.js";

const PER_PAGE = 100;
const MAX_PAGES = 10;
const REPO = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

/** @typedef {import("../../github/app.js").GithubEnv} DownloadsEnv */

/** @param {DownloadsEnv} env */
export const ready = env => Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);

/** Download counts are running totals with no history. */
export const canLookBack = false;

/**
 * The running total of downloads of matching release assets. The read side turns totals into downloads per day.
 * @param {DownloadsEnv} env
 * @param {{ repo?: unknown, assetPattern?: unknown }} config
 * @returns {Promise<number>}
 */
export async function read(env, config) {
  const match = typeof config.repo === "string" ? REPO.exec(config.repo) : null;
  if (!match || typeof config.assetPattern !== "string") throw new Error("bad-config");
  const pattern = new RegExp(config.assetPattern);
  const token = await installationToken(env, match[1]);
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const releases = /** @type {{ assets?: { name: string, download_count: number }[] }[]} */ (
      await githubCall("GET", `/repos/${match[1]}/${match[2]}/releases?per_page=${PER_PAGE}&page=${page}`, token)
    );
    for (const release of releases)
      for (const asset of release.assets ?? []) if (pattern.test(asset.name)) total += asset.download_count;
    if (releases.length < PER_PAGE) return total;
  }
  throw new Error("too-many-releases");
}
