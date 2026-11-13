import { spawn } from "node:child_process";
import { SevereServiceError } from "webdriverio";

const BASE_URL = "http://localhost:4173";
let server;

async function answers(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`The e2e server exited with code ${server.exitCode}`);
    if (await answers(url)) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${url} didn't answer within ${timeoutMs / 1000}s`);
}

function stopServer() {
  try {
    if (server) process.kill(-server.pid);
  } catch {}
}

const BROWSERS = {
  chrome: {
    browserName: "chrome",
    browserVersion: "stable",
    "goog:chromeOptions": { args: ["--headless=new", "--no-sandbox"] },
  },
  firefox: { browserName: "firefox", browserVersion: "stable", "moz:firefoxOptions": { args: ["-headless"] } },
  safari: { browserName: "safari" },
};

const selected = (process.env.E2E_BROWSERS ?? "chrome,firefox").split(",").map(name => name.trim());

const SAFARI_TAG = "@safari";
const safariOnly = selected.length === 1 && selected[0] === "safari";
if (selected.includes("safari") && !safariOnly)
  throw new Error("Safari runs on its own in E2E_BROWSERS: it runs only the specs tagged " + SAFARI_TAG);

export const config = {
  runner: "local",
  specs: ["./e2e/**/*.spec.js"],
  maxInstances: selected.includes("safari") ? 1 : 2,
  capabilities: selected.map(name => {
    if (!BROWSERS[name]) throw new Error(`Unknown browser in E2E_BROWSERS: ${name}`);
    return BROWSERS[name];
  }),
  baseUrl: BASE_URL,
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { timeout: 60000, ...(safariOnly && { grep: SAFARI_TAG }) },
  async onPrepare() {
    if (await answers(BASE_URL))
      throw new SevereServiceError(`Something is already serving ${BASE_URL}; stop it first`);
    server = spawn("pnpm", ["--silent", "e2e:server"], { stdio: "inherit", detached: true });
    try {
      await waitFor(BASE_URL, 120000);
    } catch (error) {
      stopServer();
      throw new SevereServiceError(error.message);
    }
  },
  onComplete() {
    stopServer();
  },
};
