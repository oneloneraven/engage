import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function matches(path, entry) {
  if (entry.endsWith("/")) return path.startsWith(entry);
  if (entry.startsWith("*.")) return !path.includes("/") && path.endsWith(entry.slice(1));
  return path === entry;
}

export function checkReleasePaths(changed, { noneAllowed, noneForbidden }) {
  const offending = changed.filter(
    path => !noneAllowed.some(entry => matches(path, entry)) || noneForbidden.some(entry => matches(path, entry)),
  );
  return { ok: offending.length === 0, offending };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = JSON.parse(readFileSync(".github/release-paths.json", "utf8"));
  const changed = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const { ok, offending } = checkReleasePaths(changed, cfg);
  if (!ok) {
    console.log(
      "::error::release: none is only for changes that never reach users (docs/versioning.md). These files can reach users, so this PR needs release: patch, minor or major:",
    );
    console.log(offending.join("\n"));
    process.exit(1);
  }
  console.log("Every changed file is on the never-reaches-users allowlist.");
}
