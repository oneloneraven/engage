# Importing legacy feedback

A one-off import of the feedback each product kept before Engage: Climbing Logbook's
`issue_reports` and `feedback_submissions` tables, and the issues in
`oneloneraven/deaftly-feedback`. Run it once per product's move to Engage, after
that product sends new feedback to Engage, so nothing arrives in the old store
after the export, and before the old store is removed.

## What it keeps

| Source | Becomes | Kept |
|---|---|---|
| CL `issue_reports` | `issue` from the web | Message, contact email, source page, section, app version, read and archived times, when it arrived; the reported user's username, the reported entry and the error reference as context; the user id as the account reference |
| CL `feedback_submissions` | `feedback` from the web | The same, without the report context |
| Deaftly issue labelled `bug` or `feedback` | `issue` or `feedback` from the web | The message inside the fence, the app version, when it arrived; a closed issue arrives read and archived at the time it closed, an open one unread |

No legacy store recorded consent to quote, so nothing imported can become a
testimonial until the person is asked. Deaftly issues that the form didn't
create, or that have neither label, are skipped and listed.

Each item gets an id derived from its source row, so a re-run inserts nothing
already there. The import adds one `items.imported` entry to the audit log.
Items already past their retention period are deleted by the next daily run.

## Run it

The exports hold personal data. Keep them in a private temporary directory,
never in a repository, and delete them at the end.

```bash
dir=$(mktemp -d) && chmod 700 "$dir"
```

From a Climbing Logbook checkout:

```bash
pnpm exec wrangler d1 execute climbing-logbook --remote --json --command "SELECT r.id, r.message, r.contact_email, r.user_id, r.source_page, r.section, r.app_version, u.username AS reported_username, r.reported_entry_id, r.error_ref, r.read_at, r.archived_at, r.created_at FROM issue_reports r LEFT JOIN \"user\" u ON u.id = r.reported_user_id" > "$dir/cl-issues.json"
```

```bash
pnpm exec wrangler d1 execute climbing-logbook --remote --json --command "SELECT id, message, contact_email, user_id, source_page, section, app_version, read_at, archived_at, created_at FROM feedback_submissions" > "$dir/cl-feedback.json"
```

Deaftly's issues, open and closed:

```bash
gh issue list --repo oneloneraven/deaftly-feedback --state all --limit 10000 --json number,title,body,labels,state,createdAt,closedAt > "$dir/deaftly.json"
```

From this repository, build the SQL. It prints how many items it wrote and
anything it skipped:

```bash
node scripts/import-legacy.mjs --cl-issues "$dir/cl-issues.json" --cl-feedback "$dir/cl-feedback.json" --deaftly "$dir/deaftly.json" --out "$dir/import.sql"
```

Check the count against the sources, then apply it:

```bash
pnpm exec wrangler d1 execute engage --remote --env production --file "$dir/import.sql"
```

Confirm what arrived, then delete the exports:

```bash
pnpm exec wrangler d1 execute engage --remote --env production --command "SELECT product, kind, COUNT(*) AS items FROM items GROUP BY product, kind"
```

```bash
rm -rf "$dir"
```

## Running it again

A re-run is safe for finishing an import that stopped part way. It also brings
back any imported item deleted in Engage since, so don't re-run it once you've
started working through the imported items.
