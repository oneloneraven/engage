import { afterEach, expect, test, vi } from "vitest";
import { ReadError, reader } from "../src/conformance/github.js";
import { readRecord, skippedReason } from "../src/conformance/record.js";
import { parseRules, RulesError, whenHolds } from "../src/conformance/rules.js";
import { contents, stubGithub } from "./github-stub.js";

const REPO = "oneloneraven/engage";
const at = (/** @type {string} */ path) => `/repos/${REPO}/contents/${path}?ref=main`;

afterEach(() => vi.restoreAllMocks());

const RULES = {
  version: 1,
  checks: [
    { id: "core-docs", title: "Core docs", kind: "files-present", modules: ["core"], paths: ["SECURITY.md"] },
    { id: "future", title: "Future", kind: "not-yet-a-kind", modules: [] },
  ],
  requiredChecks: { core: ["check-label"] },
};

test("parseRules keeps each check's parameters, and a kind Engage doesn't know", () => {
  const rules = parseRules(JSON.stringify(RULES));
  expect(rules.version).toBe(1);
  expect(rules.checks.map(c => c.kind)).toEqual(["files-present", "not-yet-a-kind"]);
  expect(rules.checks[0].paths).toEqual(["SECURITY.md"]);
  expect(rules.requiredChecks).toEqual({ core: ["check-label"] });
});

test("parseRules refuses text that isn't JSON, a malformed check, and a repeated id", () => {
  expect(() => parseRules("nope")).toThrow(RulesError);
  expect(() => parseRules(JSON.stringify({ version: 1, checks: [{ title: "x", kind: "y", modules: [] }] }))).toThrow(
    RulesError,
  );
  expect(() => parseRules(JSON.stringify({ version: 1, checks: [RULES.checks[0], RULES.checks[0]] }))).toThrow(
    "repeats",
  );
});

test("whenHolds reads a key, a negated key, and any of an array", () => {
  expect(whenHolds("!private", { private: false })).toBe(true);
  expect(whenHolds("!private", { private: true })).toBe(false);
  expect(whenHolds(["a", "b"], { b: true })).toBe(true);
  expect(whenHolds("constructor", {})).toBe(false);
  expect(whenHolds(undefined, {})).toBe(true);
});

test("readRecord reads modules, skipped steps and the GitHub records", async () => {
  stubGithub({
    [at(".bootstrap/state.json")]: contents({
      modules: ["core", "js-toolchain"],
      skipped: { "github:core:5-link": "user project can't link an org repo" },
      answers: { private: false },
    }),
    [at(".bootstrap/github/ruleset.json")]: contents({ rules: [] }),
    [at(".bootstrap/github/labels.json")]: contents([{ name: "release: none" }]),
  });
  const record = await readRecord(reader("t"), REPO, "main");
  expect(record).toMatchObject({
    modules: ["core", "js-toolchain"],
    answers: { private: false },
    ruleset: { rules: [] },
    settings: null,
    labels: [{ name: "release: none" }],
  });
  expect(skippedReason(/** @type {any} */ (record), "github:core:5")).toBe("user project can't link an org repo");
  expect(skippedReason(/** @type {any} */ (record), "github:core:50")).toBeNull();
  expect(skippedReason(/** @type {any} */ (record), "github:core:4")).toBeNull();
});

test("no state file is no record, but an unreadable one throws rather than looking unset", async () => {
  stubGithub({});
  expect(await readRecord(reader("t"), REPO, "main")).toBeNull();
  stubGithub({ [at(".bootstrap/state.json")]: { status: 500 } });
  await expect(readRecord(reader("t"), REPO, "main")).rejects.toThrow(ReadError);
  stubGithub({ [at(".bootstrap/state.json")]: { status: 403 } });
  await expect(readRecord(reader("t"), REPO, "main")).rejects.toThrow(ReadError);
});
