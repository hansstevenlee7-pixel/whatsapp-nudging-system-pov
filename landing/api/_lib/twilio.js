"use strict";

// Twilio request-signature validation and outbound sends.
//
// The inbound webhook is necessarily public — Twilio cannot present a Supabase
// token — so the signature IS the authentication for /api/whatsapp-inbound.
// Anything that fails validation is rejected before it can reach a Sheet.

const crypto = require("node:crypto");
const twilio = require("twilio");
const { httpError } = require("./http");

const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const WHATSAPP_FROM_RE = /^whatsapp:\+[1-9]\d{7,14}$/;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function stripChannel(value) {
  return text(value).replace(/^whatsapp:/i, "");
}

function credentials() {
  const accountSid = text(process.env.TWILIO_ACCOUNT_SID);
  const authToken = text(process.env.TWILIO_AUTH_TOKEN);
  const from = text(process.env.TWILIO_WHATSAPP_FROM);
  return { accountSid, authToken, from };
}

// Twilio's scheme: HMAC-SHA1 over the full request URL with every POST field
// appended in key-sorted order, base64-encoded.
// https://www.twilio.com/docs/usage/security#validating-requests
function expectedSignature(authToken, url, fields) {
  const payload = Object.keys(fields || {}).sort()
    .reduce((acc, key) => acc + key + String(fields[key]), String(url));
  return crypto.createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

function verifySignature({ signature, url, fields, authToken }) {
  const token = text(authToken) || credentials().authToken;
  if (!token) throw httpError(500, "TWILIO_AUTH_TOKEN is not configured");
  if (!text(signature)) return false;
  return twilio.validateRequest(token, text(signature), String(url), fields || {});
}

// Vercel terminates TLS upstream, so req.url is a path and the protocol arrives
// in x-forwarded-proto. Twilio signed whatever it called, which is the public
// https URL — rebuilding it from the proxy headers is the only way to match.
function requestUrl(req, override) {
  if (text(override)) return text(override);
  const proto = text(req.headers["x-forwarded-proto"]).split(",")[0] || "https";
  const host = text(req.headers["x-forwarded-host"]).split(",")[0] || text(req.headers.host);
  return `${proto}://${host}${req.url || ""}`;
}

// Sends a free-form WhatsApp message inside the patient-opened 24-hour window.
// Business-initiated sends must use an approved Content Template instead.
async function sendMessage({ to, body, contentSid, contentVariables }) {
  const { accountSid, authToken, from } = credentials();
  if (!accountSid || !authToken) throw httpError(500, "Twilio credentials are not configured");
  if (!WHATSAPP_FROM_RE.test(from)) throw httpError(500, "TWILIO_WHATSAPP_FROM is missing or invalid");
  const recipient = stripChannel(to);
  if (!PHONE_RE.test(recipient)) throw httpError(400, `Invalid WhatsApp recipient: ${recipient}`);

  const form = new URLSearchParams({ From: from, To: `whatsapp:${recipient}` });
  if (text(contentSid)) {
    form.set("ContentSid", text(contentSid));
    if (contentVariables) form.set("ContentVariables", JSON.stringify(contentVariables));
  } else {
    if (!text(body)) throw httpError(400, "A message needs either a body or a ContentSid");
    form.set("Body", String(body));
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Twilio's own message is the useful part; the code identifies template and
    // window failures specifically.
    throw httpError(502, `Twilio send failed (${response.status}): ${payload.message || "unknown error"}`, {
      twilio_code: payload.code || null
    });
  }
  return { sid: text(payload.sid), status: text(payload.status) };
}

module.exports = {
  PHONE_RE, stripChannel, credentials,
  expectedSignature, verifySignature, requestUrl, sendMessage
};
