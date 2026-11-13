#!/usr/bin/env node
// Creates Engage's GitHub App in one click (GitHub's manifest flow), stores its credentials in Proton Pass,
// and sets them as the production Worker's secrets. Nothing secret is printed.
//
//   node scripts/create-github-app.mjs                      create the App, store it, set the secrets
//   node scripts/create-github-app.mjs --set-worker-secrets  set the secrets again from Pass

import { spawnSync } from "node:child_process";
import { createPrivateKey, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { buildManifest, newAppUrl } from "./github-app-manifest.mjs";

const VAULT = "Dev";
const FOLDER = "engage";
const TITLE = "Engage GitHub App";
const API_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

/** @param {string[]} args @param {string} [input] */
function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

const pass = (/** @type {string[]} */ args, /** @type {string} */ input) => run("pass-cli", args, input);

function folderId() {
  const folders = JSON.parse(pass(["folder", "list", "--vault-name", VAULT, "--output", "json"]) || "[]");
  const matches = folders.filter(entry => entry.content?.name === FOLDER && !entry.parent_folder_id);
  if (matches.length !== 1)
    throw new Error(`Expected one folder named ${FOLDER} in vault ${VAULT}, found ${matches.length}`);
  return matches[0].id;
}

function findItem() {
  const id = folderId();
  const out = pass(["item", "list", "--vault-name", VAULT, "--filter-state", "active", "--output", "json"]);
  const items = (JSON.parse(out || "{}").items ?? []).filter(item => item.folder_id === id && item.title === TITLE);
  if (items.length > 1) throw new Error(`Found ${items.length} items titled ${TITLE}: remove the extras`);
  return items[0]?.id ?? null;
}

/** @param {string} itemId @param {string} field */
const readField = (itemId, field) =>
  pass(["item", "view", "--vault-name", VAULT, `--item-id=${itemId}`, "--field", field]).trim();

/** @param {Record<string, { value: string, hidden: boolean }>} fields @param {string} note */
function storeItem(fields, note) {
  const template = {
    title: TITLE,
    note,
    sections: [
      {
        section_name: "Credentials",
        fields: Object.entries(fields).map(([name, { value, hidden }]) => ({
          field_name: name,
          field_type: hidden ? "hidden" : "text",
          value,
        })),
      },
    ],
    extra_fields: [],
  };
  pass(
    ["item", "create", "custom", "--from-template", "-", "--vault-name", VAULT, `--folder-id=${folderId()}`],
    JSON.stringify(template),
  );
}

/** @param {string} url */
function open(url) {
  spawnSync("xdg-open", [url], { stdio: "ignore" });
  console.log(`If no browser opened, go to ${url}`);
}

/** Serves a page that posts the manifest to GitHub, and waits for GitHub's redirect back with a code. */
function createApp() {
  const state = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    let redirectUrl = "";
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/") {
        const manifest = JSON.stringify(buildManifest(redirectUrl)).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Create Engage's GitHub App</title><form id="f" method="post" action="${newAppUrl(state)}"><input type="hidden" name="manifest" value="${manifest}"><noscript><button>Continue to GitHub</button></noscript></form><script>document.getElementById("f").submit()</script>`,
        );
        return;
      }
      const code = url.searchParams.get("code");
      if (url.pathname !== "/callback" || url.searchParams.get("state") !== state || !code) {
        res.writeHead(400).end("Unexpected request");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Done: you can close this tab.");
      server.close();
      resolve(code);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      redirectUrl = `${origin}/callback`;
      console.log('Opening your browser: click "Create GitHub App" when GitHub asks.');
      open(`${origin}/`);
    });
  });
}

/** @param {string} itemId */
function setWorkerSecrets(itemId) {
  const secrets = {
    GITHUB_APP_ID: readField(itemId, "App id"),
    GITHUB_APP_PRIVATE_KEY: readField(itemId, "private key"),
    GITHUB_WEBHOOK_SECRET: readField(itemId, "webhook secret"),
  };
  for (const [name, value] of Object.entries(secrets)) {
    run("pnpm", ["exec", "wrangler", "secret", "put", name, "--env", "production"], value);
    console.log(`Set the production Worker secret ${name}.`);
  }
}

async function main() {
  const existing = findItem();
  if (process.argv.includes("--set-worker-secrets")) {
    if (!existing) throw new Error(`No ${TITLE} in Pass: run without --set-worker-secrets first`);
    setWorkerSecrets(existing);
    return;
  }
  if (existing) throw new Error(`${TITLE} already exists in Pass: use --set-worker-secrets, or bin it to start again`);

  const code = await createApp();
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(String(code))}/conversions`, {
    method: "POST",
    headers: API_HEADERS,
  });
  if (!response.ok) throw new Error(`GitHub refused the manifest code (HTTP ${response.status}): run it again`);
  const app = await response.json();
  if (!app.id || !app.pem || !app.webhook_secret)
    throw new Error("GitHub's response lacked the App id, key or webhook secret");
  // GitHub issues PKCS#1; the Worker's WebCrypto needs PKCS#8.
  const pkcs8 = createPrivateKey(app.pem).export({ type: "pkcs8", format: "pem" }).toString();
  storeItem(
    {
      "App id": { value: String(app.id), hidden: false },
      "client id": { value: app.client_id, hidden: false },
      "private key": { value: pkcs8, hidden: true },
      "webhook secret": { value: app.webhook_secret, hidden: true },
      "App URL": { value: app.html_url, hidden: false },
    },
    `Engage's GitHub App ${app.html_url}. Its id, key and webhook secret are the production Worker secrets GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_WEBHOOK_SECRET.`,
  );
  console.log(`Created ${app.html_url} and stored it in Pass (${VAULT} / ${FOLDER} / ${TITLE}).`);
  console.log("Install it on All repositories in the page that opens.");
  open(`${app.html_url}/installations/new`);
  const itemId = findItem();
  if (!itemId) throw new Error("The App was created but couldn't be found in Pass afterwards");
  setWorkerSecrets(itemId);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
