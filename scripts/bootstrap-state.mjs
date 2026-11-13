// Creates the OpenTofu state bucket if missing. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.

const BUCKET_NAME = "engage-tfstate";
const CF_BASE = "https://api.cloudflare.com/client/v4";

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!apiToken || !accountId) {
  console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are both required.");
  process.exit(1);
}

async function cf(method, path, body) {
  const res = await fetch(`${CF_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { ok: res.ok, status: res.status, data: await res.json() };
}

async function main() {
  const existing = await cf("GET", `/accounts/${accountId}/r2/buckets/${BUCKET_NAME}`);
  if (existing.ok) {
    console.log(`✓ Bucket "${BUCKET_NAME}" already exists — nothing to do.`);
    return;
  }
  if (existing.status !== 404) {
    console.error(`Unexpected response checking for bucket:\n${JSON.stringify(existing.data, null, 2)}`);
    process.exit(1);
  }

  console.log(`Bucket "${BUCKET_NAME}" not found — creating it...`);
  const created = await cf("POST", `/accounts/${accountId}/r2/buckets`, { name: BUCKET_NAME });
  if (!created.ok) {
    console.error(`Failed to create bucket:\n${JSON.stringify(created.data, null, 2)}`);
    process.exit(1);
  }
  console.log(`✓ Created bucket "${BUCKET_NAME}".`);
}

main();
