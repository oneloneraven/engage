import { h } from "./dom.js";
import { homePage } from "./pages/home.js";
import { inboxPage } from "./pages/inbox.js";
import { junkPage } from "./pages/junk.js";
import { createRouter } from "./router.js";
import { mountShell } from "./shell.js";

const shell = mountShell();

const router = createRouter({
  container: shell.main,
  routes: [
    { key: "home", pattern: /^\/$/, mount: homePage },
    { key: "inbox", pattern: /^\/inbox$/, mount: inboxPage },
    { key: "inbox", pattern: /^\/items\/([^/]+)$/, mount: inboxPage },
    { key: "junk", pattern: /^\/junk$/, mount: junkPage },
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
  onChange: ({ path, query }) => shell.highlight(path, query),
});

router.start();
