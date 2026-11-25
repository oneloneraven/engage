// Turns on Engage's release gate for every gated environment: docs/runbooks/release-gate.md.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { APP_NAME } from "./github-app-manifest.mjs";

/**
 * What to change: one rule per gated environment that doesn't already use Engage's App.
 * @param {{ repo: string, environments: string[] }[]} gated
 * @param {Record<string, { exists: boolean, appIds: number[] }>} current keyed by `repo:environment`
 * @param {number} appId
 * @returns {{ repo: string, environment: string, action: "add-rule" | "already-gated" | "missing-environment" }[]}
 */
export function plan(gated, current, appId) {
  return gated.flatMap(({ repo, environments }) =>
    environments.map(environment => {
      const state = current[`${repo}:${environment}`];
      if (!state?.exists) return { repo, environment, action: "missing-environment" };
      if (state.appIds.includes(appId)) return { repo, environment, action: "already-gated" };
      return { repo, environment, action: "add-rule" };
    }),
  );
}

/** @param {string[]} args */
const gh = args => JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8" }) || "null");

/** @param {string} repo @param {string} environment */
function currentRules(repo, environment) {
  try {
    const rules = gh([`repos/${repo}/environments/${encodeURIComponent(environment)}/deployment_protection_rules`]);
    return { exists: true, appIds: rules.custom_deployment_protection_rules.map(r => r.app.id) };
  } catch {
    return { exists: false, appIds: [] };
  }
}

function gatedRepos() {
  const output = execFileSync(
    "pnpm",
    [
      "--silent",
      "exec",
      "wrangler",
      "d1",
      "execute",
      "engage",
      "--env",
      "production",
      "--remote",
      "--json",
      "--command",
      "SELECT repo, environments FROM release_repos",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output)[0].results.map(row => ({ repo: row.repo, environments: JSON.parse(row.environments) }));
}

function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
  const appId = gh([`apps/${APP_NAME}`]).id;
  const gated = gatedRepos();
  const current = Object.fromEntries(
    gated.flatMap(({ repo, environments }) => environments.map(env => [`${repo}:${env}`, currentRules(repo, env)])),
  );
  for (const step of plan(gated, current, appId)) {
    console.log(`${step.action.padEnd(19)} ${step.repo} ${step.environment}`);
    if (values.apply && step.action === "add-rule") {
      gh([
        "--method",
        "POST",
        `repos/${step.repo}/environments/${encodeURIComponent(step.environment)}/deployment_protection_rules`,
        "-F",
        `integration_id=${appId}`,
      ]);
      console.log(`  added Engage's rule to ${step.repo} ${step.environment}`);
    }
  }
  if (!values.apply) console.log("\nDry run: nothing changed. Run again with --apply to add the rules.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
