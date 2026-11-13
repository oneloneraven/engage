import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const wrangler = JSON.parse(source.replace(/^\s*\/\/.*$/gm, ""));

test("PR previews repeat the preview environment's vars, since they inherit nothing", () => {
  const { previews, vars } = wrangler.env.preview;
  expect(previews.vars).toEqual(vars);
});
