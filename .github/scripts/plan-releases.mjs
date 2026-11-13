import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BUMPS = ["major", "minor", "patch"];

export function bumpOf(labels) {
  return BUMPS.find(bump => labels.includes(`release: ${bump}`)) ?? null;
}

export function nextVersion(version, bump) {
  const [major, minor, patch] = (version ?? "v0.0.0").replace(/^v/, "").split(".").map(Number);
  if (bump === "major") return `v${major + 1}.0.0`;
  if (bump === "minor") return `v${major}.${minor + 1}.0`;
  return `v${major}.${minor}.${patch + 1}`;
}

export function planReleases({ commits, latestVersion, isTagged, prFor }) {
  const plan = [];
  let version = latestVersion;
  for (const sha of commits) {
    if (isTagged(sha)) continue;
    const pr = prFor(sha);
    const bump = pr && bumpOf(pr.labels);
    if (!bump) continue;
    version = nextVersion(version, bump);
    plan.push({ sha, version, pr: pr.number });
  }
  return plan;
}

function isAncestor(git, ancestor, descendant) {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch {
    return false;
  }
}

export function planFromRepo({ git, prFor, mergeSha, bumpInput }) {
  const latestTag = git(["tag", "-l", "v*", "--sort=-v:refname"]).split("\n")[0] || null;
  if (bumpInput) {
    const existing = git(["tag", "--points-at", "HEAD"])
      .split("\n")
      .find(tag => /^v\d+\.\d+\.\d+$/.test(tag));
    if (existing) throw new Error(`HEAD is already released as ${existing}`);
    return [{ sha: git(["rev-parse", "HEAD"]), version: nextVersion(latestTag, bumpInput), pr: null }];
  }
  if (latestTag && !isAncestor(git, latestTag, mergeSha)) {
    throw new Error(`${latestTag} isn't in ${mergeSha}'s history, so there's no safe range to release from`);
  }
  const commits = latestTag
    ? git(["rev-list", "--reverse", "--first-parent", `${latestTag}..${mergeSha}`])
        .split("\n")
        .filter(Boolean)
    : [mergeSha];
  return planReleases({
    commits,
    latestVersion: latestTag,
    isTagged: sha => git(["tag", "--points-at", sha]) !== "",
    prFor,
  });
}

export function parsePulls(output, sha) {
  try {
    const pulls = JSON.parse(output);
    if (Array.isArray(pulls)) return pulls;
  } catch {}
  const shown = output.length > 500 ? `${output.slice(0, 500)}...` : output;
  throw new Error(`gh api returned no usable pull request list for ${sha}: ${JSON.stringify(shown)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
  const { MERGE_SHA, GITHUB_REPOSITORY, BUMP_INPUT } = process.env;
  const plan = planFromRepo({
    git: args => run("git", args),
    mergeSha: MERGE_SHA,
    bumpInput: BUMP_INPUT,
    prFor: sha => {
      const prs = parsePulls(run("gh", ["api", `repos/${GITHUB_REPOSITORY}/commits/${sha}/pulls`]), sha);
      const pr = prs.find(p => p.merge_commit_sha === sha);
      return pr ? { number: pr.number, labels: pr.labels.map(l => l.name) } : null;
    },
  });
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}
