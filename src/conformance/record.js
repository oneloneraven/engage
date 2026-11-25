import { ReadError } from "./github.js";

/**
 * @typedef {{ modules: string[], skipped: Record<string, string>, answers: Record<string, unknown>, ruleset: any | null, settings: any | null, labels: { name: string }[] | null }} BootstrapRecord
 */

/** @param {string} text @param {string} path */
function json(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    throw new ReadError(path, -1);
  }
}

/**
 * What bootstrap recorded for a repository, or null when it has no record. Anything unreadable throws, so it's never
 * mistaken for a missing record.
 * @param {import("./github.js").Reader} read
 * @param {string} repo
 * @param {string} ref
 * @returns {Promise<BootstrapRecord | null>}
 */
export async function readRecord(read, repo, ref) {
  const stateText = await read.file(repo, ".bootstrap/state.json", ref);
  if (stateText === null) return null;
  const state = json(stateText, ".bootstrap/state.json");
  const [ruleset, settings, labels] = await Promise.all(
    ["ruleset.json", "repo-settings.json", "labels.json"].map(async name => {
      const text = await read.file(repo, `.bootstrap/github/${name}`, ref);
      return text === null ? null : json(text, `.bootstrap/github/${name}`);
    }),
  );
  return {
    modules: Array.isArray(state?.modules) ? state.modules.map(String) : [],
    skipped: state?.skipped && typeof state.skipped === "object" ? state.skipped : {},
    answers: state?.answers && typeof state.answers === "object" ? state.answers : {},
    ruleset,
    settings,
    labels: Array.isArray(labels) ? labels : null,
  };
}

/**
 * The reason bootstrap recorded for skipping a step or one of its sub-steps, if it did.
 * @param {BootstrapRecord} record
 * @param {string | undefined} step
 * @returns {string | null}
 */
export function skippedReason(record, step) {
  if (!step) return null;
  const hit = Object.entries(record.skipped).find(([id]) => id === step || id.startsWith(`${step}-`));
  return hit ? String(hit[1]) : null;
}
