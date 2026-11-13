export const APP_NAME = "oneloneraven-engage";
export const OWNER = "oneloneraven";
export const WEBHOOK_URL = "https://engage-api.oneloneraven.com/v1/github/webhook";

/**
 * The manifest GitHub turns into Engage's App: least privilege, per the design's §4.3.
 * @param {string} redirectUrl
 */
export function buildManifest(redirectUrl) {
  return {
    name: APP_NAME,
    url: `https://github.com/${OWNER}/engage`,
    hook_attributes: { url: WEBHOOK_URL, active: true },
    redirect_url: redirectUrl,
    public: false,
    default_permissions: {
      issues: "write",
      deployments: "write",
      actions: "read",
      administration: "read",
      contents: "read",
      metadata: "read",
    },
    default_events: ["issues", "deployment_protection_rule"],
  };
}

/** @param {string} state */
export const newAppUrl = state =>
  `https://github.com/organizations/${OWNER}/settings/apps/new?state=${encodeURIComponent(state)}`;
