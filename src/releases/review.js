import { githubCall, installationToken } from "../github/app.js";
import { log } from "../lib/log.js";
import { decideRelease, getRelease } from "./store.js";

const GONE = /^github-(404|422)$/;
const SQUASH_TITLE = /\(#(\d+)\)$/;

/** @typedef {import("./store.js").Release} Release */
/** @typedef {{ DB: import("../lib/db.js").Database, GITHUB_APP_ID?: string, GITHUB_APP_PRIVATE_KEY?: string, APP_ENV?: string, RELEASE_VERSION?: string }} ReviewEnv */
/** @typedef {{ number: number, title: string, url: string }} Pull */
/** @typedef {{ conclusion: "success" | "failure" | "pending" | "unknown", url: string | null }} Checks */

/** @param {string} repo */
const ownerOf = repo => repo.split("/")[0];

/**
 * Tells GitHub the owner's decision, then records it. A run GitHub no longer waits on is marked expired.
 * @param {ReviewEnv} env
 * @param {string} id
 * @param {"approved" | "rejected"} decision
 * @param {string} actor
 * @param {string} [note]
 * @returns {Promise<Release>}
 */
export async function reviewRelease(env, id, decision, actor, note) {
  const release = await getRelease(env, id);
  if (!release) throw new Error("not-found");
  if (release.state !== "pending") throw new Error("release-not-pending");
  const verb = decision === "approved" ? "Approved" : "Rejected";
  try {
    await githubCall(
      "POST",
      `/repos/${release.repo}/actions/runs/${release.runId}/deployment_protection_rule`,
      await installationToken(env, ownerOf(release.repo)),
      {
        environment_name: release.environment,
        state: decision,
        comment: note ? `${verb} in Engage: ${note}` : `${verb} in Engage`,
      },
    );
  } catch (error) {
    if (error instanceof Error && GONE.test(error.message)) {
      await decideRelease(env, id, "expired", "github");
      throw new Error("release-expired");
    }
    throw error;
  }
  return decideRelease(env, id, decision, actor, note);
}

/**
 * The PRs since the last release that went out to this environment, and the commit's checks. GitHub being down
 * degrades this to "unknown" rather than hiding the release.
 * @param {ReviewEnv} env
 * @param {Release} release
 * @returns {Promise<{ pulls: Pull[], checks: Checks }>}
 */
export async function releaseContext(env, release) {
  try {
    const token = await installationToken(env, ownerOf(release.repo));
    const [pulls, checks] = await Promise.all([pullsSince(env, release, token), checksFor(release, token)]);
    return { pulls, checks };
  } catch (error) {
    log(env, "warn", "release.context-failed", { errorName: error instanceof Error ? error.name : "unknown" });
    return { pulls: [], checks: { conclusion: "unknown", url: null } };
  }
}

/**
 * @param {ReviewEnv} env
 * @param {Release} release
 * @param {string} token
 * @returns {Promise<Pull[]>}
 */
async function pullsSince(env, release, token) {
  const previous = await env.DB.prepare(
    `SELECT sha FROM releases WHERE repo = ? AND environment = ? AND state IN ('approved', 'spent') AND id != ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  )
    .bind(release.repo, release.environment, release.id)
    .first();
  if (!previous || previous.sha === release.sha) return [];
  const compare = /** @type {{ commits: { commit: { message: string } }[] }} */ (
    await githubCall("GET", `/repos/${release.repo}/compare/${previous.sha}...${release.sha}`, token)
  );
  return compare.commits.flatMap(({ commit }) => {
    const title = commit.message.split("\n")[0].trim();
    const number = SQUASH_TITLE.exec(title)?.[1];
    if (!number) return [];
    return [
      {
        number: Number(number),
        title: title.replace(SQUASH_TITLE, "").trim(),
        url: `https://github.com/${release.repo}/pull/${number}`,
      },
    ];
  });
}

/**
 * @param {Release} release
 * @param {string} token
 * @returns {Promise<Checks>}
 */
async function checksFor(release, token) {
  const [runs, run] = await Promise.all([
    /** @type {Promise<{ check_runs: { status: string, conclusion: string | null, details_url?: string | null }[] }>} */ (
      githubCall("GET", `/repos/${release.repo}/commits/${release.sha}/check-runs?per_page=100`, token)
    ),
    /** @type {Promise<{ html_url: string }>} */ (
      githubCall("GET", `/repos/${release.repo}/actions/runs/${release.runId}`, token)
    ),
  ]);
  const waitingRun = `/actions/runs/${release.runId}/`;
  const checks = runs.check_runs.filter(check => !check.details_url?.includes(waitingRun));
  if (checks.length === 0) return { conclusion: "unknown", url: run.html_url };
  const failed = checks.some(check =>
    ["failure", "timed_out", "cancelled", "action_required"].includes(check.conclusion ?? ""),
  );
  const finished = checks.every(check => check.status === "completed");
  return { conclusion: failed ? "failure" : finished ? "success" : "pending", url: run.html_url };
}
