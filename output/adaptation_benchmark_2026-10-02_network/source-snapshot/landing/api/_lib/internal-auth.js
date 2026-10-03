"use strict";

const crypto = require("node:crypto");
const { httpError } = require("./http");

function equal(left, right) {
  const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireWorker(req) {
  const expected = String(process.env.N8N_PROXY_SECRET || "");
  if (!expected) throw httpError(503, "N8N_PROXY_SECRET is not configured");
  if (!equal(req.headers["x-n8n-proxy-secret"], expected)) throw httpError(403, "invalid_worker_secret");
}

module.exports = { requireWorker };
