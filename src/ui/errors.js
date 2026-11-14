const SENTENCES = {
  "no-contact": "Couldn't send: this person didn't leave an email address.",
  "reply-secret-missing": "Couldn't send: reply addresses aren't set up on this server yet.",
  "send-failed": "Couldn't send the reply, and nothing was sent: try again in a minute.",
  "github-app-not-configured": "Couldn't create the issue: GitHub isn't connected on this server yet.",
  "issue-exists": "This item already has a GitHub issue.",
  "repo-not-registered": "Couldn't create the issue: that repository isn't registered for this product.",
  "no-consent": "Couldn't save the quote: this person didn't agree to be quoted.",
  "not-faithful": "That text isn't in the message exactly as written: select it again.",
  "not-found": "That item no longer exists.",
  "bad-request": "That didn't look right: check what you entered and try again.",
  "bad-cursor": "That list is out of date: reload the page.",
  forbidden: "You're not signed in to Engage any more: reload the page to sign in again.",
  network: "Couldn't reach Engage: check your connection and try again.",
};

const GITHUB_REFUSED = "GitHub refused the issue (it may be down): try again in a minute.";
const FALLBACK = "Something went wrong on our side: try again in a minute.";

/**
 * Turns an API error code into a sentence in the interface's voice.
 * @param {string} code
 */
export function sentenceFor(code) {
  if (Object.hasOwn(SENTENCES, code)) return SENTENCES[/** @type {keyof typeof SENTENCES} */ (code)];
  if (/^github-\d+$/.test(code)) return GITHUB_REFUSED;
  return FALLBACK;
}
