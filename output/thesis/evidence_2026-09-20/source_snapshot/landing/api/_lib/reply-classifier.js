"use strict";

const { explicitInterpretation } = require("./adaptive-core");

function text(value) { return String(value == null ? "" : value).trim(); }

async function classifyReply(body, envelope, fetchImpl = fetch) {
  const deterministic = explicitInterpretation(body);
  if (deterministic.explicit || !text(process.env.GEMINI_API_KEY)) return deterministic;
  const model = text(process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_SUMMARY_MODEL) || "gemini-2.5-flash";
  const schema = { type: "object", required: ["explicit", "format", "summary_length", "tone", "time", "frequency_delta", "action"], properties: {
    explicit: { type: "boolean" }, format: { type: ["string", "null"] }, summary_length: { type: ["string", "null"] },
    tone: { type: ["string", "null"] }, time: { type: ["string", "null"] }, frequency_delta: { type: "integer" }, action: { type: ["string", "null"] }
  } };
  const prompt = [
    "Extract only an explicit patient request about future WhatsApp nudges. Do not infer health adherence or intent from silence.",
    "Allowed format values: video, paper, reading. Allowed summary_length: short, detailed. Allowed tone: encouraging, neutral_informational.",
    "frequency_delta must be -1, 0, or 1. time must be HH:MM or null. action must copy the requested action, never invent one.",
    `Approved action alternatives for reference: ${JSON.stringify(envelope.action_alternatives || [])}`,
    `Message: ${text(body)}`
  ].join("\n");
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0 } })
  });
  if (!response.ok) return deterministic;
  try {
    const payload = await response.json(); const parsed = JSON.parse(payload.candidates[0].content.parts[0].text);
    const allowed = {
      explicit: Boolean(parsed.explicit), format: ["video","paper","reading"].includes(parsed.format) ? parsed.format : null,
      summary_length: ["short","detailed"].includes(parsed.summary_length) ? parsed.summary_length : null,
      tone: ["encouraging","neutral_informational"].includes(parsed.tone) ? parsed.tone : null,
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(text(parsed.time)) ? parsed.time : null,
      frequency_delta: [-1,0,1].includes(Number(parsed.frequency_delta)) ? Number(parsed.frequency_delta) : 0,
      action: text(parsed.action) || null
    };
    if (!allowed.format && !allowed.summary_length && !allowed.tone && !allowed.time && !allowed.frequency_delta && !allowed.action) allowed.explicit = false;
    return allowed;
  } catch (_) { return deterministic; }
}

module.exports = { classifyReply };
