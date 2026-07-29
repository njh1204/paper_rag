# Security policy

## Public-source boundary

This repository intentionally contains only application source, migrations, and
empty configuration examples. Paper content, images, passwords, session tokens,
sync keys, Cloudflare credentials, and local paths must never be committed.
Cloudflare D1 database IDs and R2 bucket names are identifiers, not credentials.

Only the repository owner can push to `main`. Forking the public source does not
grant access to the production Worker, D1 database, R2 bucket, or secrets.

## Runtime controls

- R2 is private and can only be accessed through the Worker binding.
- Read APIs require an opaque, server-side session that expires after one hour.
- Login, read, and sync routes use separate Cloudflare edge rate limits.
- Login attempts retain only an HMAC fingerprint, never a raw IP address.
- Sync requires a timestamped HMAC signature and single-use nonce.
- Invalid sync envelopes are rejected before request bodies are read.
- Upload streams, file counts, individual blobs, total snapshot size, MIME types,
  and logical paths all have hard limits.
- The active manifest changes only after every referenced blob is present.
- The Workers Free plan enforces 10 ms CPU per invocation and a 100,000
  dynamic-request daily ceiling; log sampling is 1%.

## Cost monitoring

Cloudflare R2 is usage-billed even when usage normally stays in the free tier.
Configure an account budget alert under **Manage Account → Billing → Billable
Usage**. Use Standard R2 storage only. The Worker should remain on the Workers
Free plan unless a deliberate upgrade is approved; that plan stops dynamic
Worker requests after its daily allowance instead of automatically billing
request overages.

## Incident response

If the site password or sync key may have leaked:

1. Disable the Worker route or deploy a maintenance response.
2. Rotate `SYNC_SECRET` with `wrangler secret put SYNC_SECRET`.
3. Change the guest password and revoke all sessions.
4. Inspect D1 `vault_state`, `vault_files`, `auth_sessions`, `login_attempts`,
   and `sync_nonces`; inspect R2 object and operation metrics.
5. Restore the prior generation if a manifest was unexpectedly changed.
6. Review Cloudflare billable usage and create a support ticket for unexplained
   usage.

Security reports should be sent privately to the repository owner rather than
opened as public issues when they contain exploit details.
