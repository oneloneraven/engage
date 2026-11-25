import { h } from "./dom.js";
import { homePage } from "./pages/home.js";
import {
  hubPage,
  inboxRedirectPage,
  itemRedirectPage,
  releaseRedirectPage,
  releasesRedirectPage,
} from "./pages/hub.js";
import { searchPage } from "./pages/search.js";
import { createRouter } from "./router.js";
import { mountShell } from "./shell.js";

const shell = mountShell();

const router = createRouter({
  container: shell.main,
  routes: [
    { key: "home", pattern: /^\/$/, mount: homePage },
    { key: "search", pattern: /^\/search$/, mount: searchPage },
    { key: "item-redirect", pattern: /^\/items\/([^/]+)$/, mount: itemRedirectPage },
    { key: "inbox-redirect", pattern: /^\/inbox$/, mount: inboxRedirectPage },
    { key: "releases-redirect", pattern: /^\/releases$/, mount: releasesRedirectPage },
    { key: "release-redirect", pattern: /^\/releases\/([^/]+)$/, mount: releaseRedirectPage },
    { key: "hub", pattern: /^\/([a-z0-9-]+)(?:\/([a-z0-9-]+)(?:\/([^/]+))?)?$/, mount: hubPage },
  ],
  notFound: container => {
    document.title = "Not found – Engage";
    container.append(
      h("h1", { class: "page-title" }, "Not found"),
      h(
        "p",
        { class: "empty" },
        "That page doesn't exist. ",
        h("a", { href: "/", "data-link": "" }, "Go to Home"),
        ".",
      ),
    );
    return { update() {}, destroy() {} };
  },
  onChange: ({ path }) => shell.highlight(path),
});

router.start();
