import { expect, test } from "vitest";
import { buildManifest, newAppUrl } from "../../scripts/github-app-manifest.mjs";

test("the App gets exactly the design's permissions and events, and a live webhook on the public host", () => {
  const manifest = buildManifest("http://127.0.0.1:1234/callback");
  expect(manifest.name).toBe("oneloneraven-engage");
  expect(manifest.public).toBe(false);
  expect(manifest.redirect_url).toBe("http://127.0.0.1:1234/callback");
  expect(manifest.hook_attributes).toEqual({
    url: "https://engage-api.oneloneraven.com/v1/github/webhook",
    active: true,
  });
  expect(manifest.default_permissions).toEqual({
    issues: "write",
    deployments: "write",
    actions: "read",
    administration: "read",
    contents: "read",
    metadata: "read",
  });
  expect(manifest.default_events).toEqual(["issues", "deployment_protection_rule"]);
});

test("the App is created under the organisation, with the state echoed back", () => {
  expect(newAppUrl("a b")).toBe("https://github.com/organizations/oneloneraven/settings/apps/new?state=a%20b");
});
