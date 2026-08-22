#!/usr/bin/env bash
# Start n8n locally in Docker with a public tunnel for inbound webhooks.
#
#   ./local/run-n8n.sh
#
# - Docker image bundles its own Node, so the host Node version is irrelevant.
# - `start --tunnel` gives a temporary public HTTPS URL that forwards to the
#   local instance, so Meta/WhatsApp and the landing page can reach your
#   webhooks during testing. The tunnel URL CHANGES on every restart.
# - Data (DB, credentials) persists in the named volume `n8n_data`.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="local/n8n.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  echo "  cp local/n8n.env.example local/n8n.env   # then fill in your values"
  exit 1
fi

echo "Starting n8n → http://localhost:5678  (Ctrl-C to stop)"
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v n8n_data:/home/node/.n8n \
  --env-file "$ENV_FILE" \
  docker.n8n.io/n8nio/n8n:latest \
  start --tunnel
