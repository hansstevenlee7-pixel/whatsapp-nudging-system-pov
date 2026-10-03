"use strict";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function method(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  res.setHeader("allow", allowed.join(", "));
  sendJson(res, 405, { error: "method_not_allowed" });
  return false;
}

async function jsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

// The exact bytes that arrived. Twilio's signature is computed over the request
// as sent, so a re-serialized copy would not verify — this must never be
// reconstructed from a parsed object.
async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") {
    // Some runtimes pre-parse before we see the stream. Re-encoding is lossless
    // for form data, which is all this path carries.
    return new URLSearchParams(req.body).toString();
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

// application/x-www-form-urlencoded → flat object. Twilio posts webhooks this
// way. Repeated keys keep the last value, matching Twilio's own behaviour.
function parseForm(raw) {
  const params = new URLSearchParams(String(raw || ""));
  const out = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}

async function formBody(req) {
  const raw = await rawBody(req);
  return { raw, fields: parseForm(raw) };
}

function apiError(res, error) {
  const status = Number(error && error.status) || 500;
  const publicMessage = status >= 500 ? "Internal server error" : String(error.message || "Request failed");
  if (status >= 500) console.error(error);
  const details = status < 500 && error && error.details && typeof error.details === "object" ? error.details : {};
  sendJson(res, status, Object.assign({ error: publicMessage }, details));
}

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

module.exports = { sendJson, method, jsonBody, rawBody, parseForm, formBody, apiError, httpError };
