export const SUPPORTED_VERSION = 1;

/**
 * @typedef {string | { context: string, when?: string | string[] }} RequiredCheck
 * @typedef {{ id: string, title: string, kind: string, modules: string[], step?: string, paths?: string[], names?: string[], workflow?: string }} Check
 * @typedef {{ version: number, checks: Check[], requiredChecks: Record<string, RequiredCheck[]> }} Rules
 */

export class RulesError extends Error {}

const ID = /^[a-z0-9-]{1,40}$/;

/** @param {unknown} value */
const strings = value => (Array.isArray(value) && value.every(item => typeof item === "string") ? value : null);

/**
 * Bootstrap's conformance rules. A kind Engage doesn't know is kept: the run shows it as Unknown.
 * @param {string} text
 * @returns {Rules}
 */
export function parseRules(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RulesError("Bootstrap's rules file isn't JSON");
  }
  if (!Number.isSafeInteger(raw?.version)) throw new RulesError("Bootstrap's rules file has no version");
  if (!Array.isArray(raw.checks)) throw new RulesError("Bootstrap's rules file has no checks");
  const checks = raw.checks.map((/** @type {any} */ check) => {
    const modules = strings(check?.modules);
    if (!ID.test(check?.id ?? "") || typeof check.kind !== "string" || typeof check.title !== "string" || !modules)
      throw new RulesError("A check in bootstrap's rules file is malformed");
    return {
      id: check.id,
      title: check.title,
      kind: check.kind,
      modules,
      ...(typeof check.step === "string" && { step: check.step }),
      ...(strings(check.paths) && { paths: check.paths }),
      ...(strings(check.names) && { names: check.names }),
      ...(typeof check.workflow === "string" && { workflow: check.workflow }),
    };
  });
  if (new Set(checks.map((/** @type {Check} */ c) => c.id)).size !== checks.length)
    throw new RulesError("Bootstrap's rules file repeats a check");
  const requiredChecks =
    raw.requiredChecks && typeof raw.requiredChecks === "object" && !Array.isArray(raw.requiredChecks)
      ? raw.requiredChecks
      : {};
  return { version: raw.version, checks, requiredChecks };
}

/**
 * A bootstrap `when`: an answer key (truthy), `!key` (falsy), or an array of those, any of which holds.
 * @param {string | string[] | undefined} when
 * @param {Record<string, unknown>} answers
 */
export function whenHolds(when, answers) {
  if (when === undefined) return true;
  const one = (/** @type {string} */ key) =>
    key.startsWith("!") ? !answers[key.slice(1)] : Boolean(Object.hasOwn(answers, key) && answers[key]);
  return Array.isArray(when) ? when.some(one) : one(when);
}
