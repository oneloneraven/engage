# Engage's GitHub App

Engage uses its own App, `oneloneraven-engage`, separate from the board-sync and release Apps, so a leaked key reaches only what Engage needs.

| Permission | Access | For |
|---|---|---|
| Issues | Read and write | Creating issues from items; closed and reopened events |
| Deployments | Read and write | Approving releases (Plan 2) |
| Actions | Read | Run details on the approval page (Plan 2) |
| Administration, Contents | Read | Conformance checks (Plan 4) |
| Metadata | Read | Required by GitHub |

Events: Issues, Deployment protection rule. Webhook: `https://engage-api.oneloneraven.com/v1/github/webhook`.

## Create it

```bash
node scripts/create-github-app.mjs
```

1. Your browser opens on GitHub with the App filled in: click **Create GitHub App**.
2. The script stores the App id, client id, private key (converted to PKCS#8 for the Worker) and webhook secret in Proton Pass, as `Dev / engage / Engage GitHub App`.
3. On the install page that opens, choose **All repositories**.
4. It sets the production Worker secrets `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` from Pass. Nothing secret is printed.

To set the Worker secrets again from Pass: `node scripts/create-github-app.mjs --set-worker-secrets`.

## Rotate the key

GitHub has no API for a new App key.
1. In the App's settings, **Generate a private key**.
2. Convert it: `openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pk8.pem`.
3. Replace the Pass item's `private key` with the converted key, then run `--set-worker-secrets`.
4. Delete the old key in the App's settings, and both `.pem` files.
