import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const wrangler = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));

test("PR previews repeat the preview environment's vars, since they inherit nothing", () => {
  const { previews, vars } = wrangler.env.preview;
  expect(previews.vars).toEqual(vars);
});

test("every environment, and PR previews, repeat the D1 binding", () => {
  const expected = wrangler.d1_databases;
  expect(expected).toHaveLength(1);
  expect(expected[0]).toMatchObject({ binding: "DB", database_name: "engage", migrations_dir: "migrations" });
  for (const [name, environment] of Object.entries(wrangler.env)) {
    expect(environment.d1_databases, name).toEqual(expected);
  }
  expect(wrangler.env.preview.previews.d1_databases).toEqual(expected);
});
