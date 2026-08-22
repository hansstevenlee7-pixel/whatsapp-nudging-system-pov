# Railway n8n deployment

## Active service

- Railway project: `whatsapp-nudging-n8n`
- Service: `n8n`
- Image: `n8nio/n8n:latest`
- Public origin: `https://n8n-production-beb2c.up.railway.app`
- Persistent volume: `n8n-volume` mounted at `/home/node/.n8n`
- Vercel project: `whatsapp-nudging-system`

The Railway service is the only scheduler that should be active. Stop the local
Docker container before enabling Railway, otherwise Workflow B can process the
same five-minute Twilio window twice.

## Required Railway variables

Configure secrets in Railway, never in git. Copy the non-empty values from the
gitignored `local/n8n.env`, preserving `N8N_ENCRYPTION_KEY` exactly.

```text
GENERIC_TIMEZONE=Australia/Melbourne
TZ=Australia/Melbourne
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_HOST=n8n-production-beb2c.up.railway.app
N8N_USER_FOLDER=/home/node
N8N_WEBHOOK_URL=https://n8n-production-beb2c.up.railway.app/
WEBHOOK_URL=https://n8n-production-beb2c.up.railway.app/
N8N_EDITOR_BASE_URL=https://n8n-production-beb2c.up.railway.app/
N8N_PROXY_HOPS=1
N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
RAILWAY_RUN_UID=0
NODE_ENV=production
```

`N8N_USER_FOLDER=/home/node` is essential. `RAILWAY_RUN_UID=0` changes the
runtime user; without the explicit folder, n8n creates an empty database under
`/root/.n8n` instead of reading the mounted volume.

Vercel must have the matching server-side values:

```text
N8N_BASE_URL=https://n8n-production-beb2c.up.railway.app
N8N_PROXY_SECRET=<same value as Railway>
```

## Existing-instance migration

1. Stop local n8n to checkpoint SQLite and prevent scheduled sends.
2. Copy `/home/node/.n8n` from the Docker volume.
3. Create a checkpointed SQLite backup with `sqlite3 database.sqlite ".backup
   'database-restored.sqlite'"` so WAL data is included.
4. Upload the verified database and configuration to the Railway volume.
5. Preserve the original `N8N_ENCRYPTION_KEY`.
6. Redeploy with `N8N_USER_FOLDER=/home/node`, then leave local n8n stopped.

Treat the copied database as sensitive: it contains workflow history and encrypted
credentials. Delete migration copies and temporary access keys after verification.

## Verification gates

```bash
curl -i https://n8n-production-beb2c.up.railway.app/healthz
curl -i https://whatsapp-nudging-system.vercel.app/api/patients
```

Expected results:

- `/healthz` returns 200.
- `/api/patients` returns 401 without a Supabase access token.
- Signed in, the Monitoring page loads patients directly from Google Sheets via the
  service account. No n8n request is involved in review, approval, or assignment.
- n8n logs show Workflow A and Workflow B Twilio activated. Workflow E is archived
  and must not be reactivated.

Workflow E's `/webhook/review` was the pre-migration gate here. It is retired: the
endpoint is unregistered and a request to it now returns a "not registered" error,
which is the correct result rather than a fault to fix.

## Rollback

Stop Railway first, then start the local `n8n` Docker container. Update Vercel
`N8N_BASE_URL` only if intentionally returning to a reachable alternate backend.
Never use an expired ngrok URL and never run both schedulers simultaneously.
