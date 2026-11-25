import { expect, test } from "vitest";
import { adminLinks } from "../src/admin/admin-links.js";

const DOMAINS = JSON.stringify(["climbinglogbook.com", "my.climbinglogbook.com"]);
const USERS = "https://admin.climbinglogbook.com/users?q={value}";
const links = (/** @type {unknown[]} */ templates) => JSON.stringify(templates);

test("a template whose field the context holds becomes a link, with the value URL-encoded", () => {
  expect(
    adminLinks(links([{ field: "reportedUsername", url: USERS }]), DOMAINS, { reportedUsername: "al ex&q=1" }),
  ).toEqual([{ field: "reportedUsername", url: "https://admin.climbinglogbook.com/users?q=al%20ex%26q%3D1" }]);
});

test("no context, a missing or empty field, or no templates give no link", () => {
  const template = links([{ field: "reportedUsername", url: USERS }]);
  expect(adminLinks(template, DOMAINS, null)).toEqual([]);
  expect(adminLinks(template, DOMAINS, { reportedEntryId: "e1" })).toEqual([]);
  expect(adminLinks(template, DOMAINS, { reportedUsername: "  " })).toEqual([]);
  expect(adminLinks(template, DOMAINS, { reportedUsername: 42 })).toEqual([]);
  expect(adminLinks("[]", DOMAINS, { reportedUsername: "alex" })).toEqual([]);
  expect(adminLinks("not json", DOMAINS, { reportedUsername: "alex" })).toEqual([]);
});

test.each([
  ["another host", "https://evil.example/users?q={value}"],
  ["a host that only ends in the domain", "https://notclimbinglogbook.com/users?q={value}"],
  ["plain http", "http://admin.climbinglogbook.com/users?q={value}"],
  ["credentials in the URL", "https://x:y@admin.climbinglogbook.com/users?q={value}"],
  ["no placeholder", "https://admin.climbinglogbook.com/users"],
  ["two placeholders", "https://admin.climbinglogbook.com/{value}?q={value}"],
  ["a value placed in the host", "https://{value}.climbinglogbook.com/users"],
])("a template with %s gives no link", (_, url) => {
  expect(
    adminLinks(links([{ field: "reportedUsername", url }]), DOMAINS, { reportedUsername: "evil.example/#" }),
  ).toEqual([]);
});

test("a context field named like an Object property isn't read from the prototype", () => {
  expect(adminLinks(links([{ field: "constructor", url: USERS }]), DOMAINS, {})).toEqual([]);
});
