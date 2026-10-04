"use strict";

const { httpError } = require("./http");

function n8nBase() {
  const value = process.env.N8N_BASE_URL;
  if (!value) throw httpError(503, "N8N_BASE_URL is not configured");
  return value.replace(/\/$/, "");
}

async function n8n(path, options = {}) {
  const secret = process.env.N8N_PROXY_SECRET;
  if (!secret) throw httpError(503, "N8N_PROXY_SECRET is not configured");
  const headers = Object.assign({ "x-n8n-proxy-secret": secret, "ngrok-skip-browser-warning": "true" }, options.headers || {});
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(`${n8nBase()}${path}`, Object.assign({}, options, { headers }));
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { message: text }; }
  if (!response.ok) throw httpError(response.status, body.error || body.message || `n8n HTTP ${response.status}`);
  return body;
}

module.exports = { n8n };
