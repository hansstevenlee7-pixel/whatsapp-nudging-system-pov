"use strict";

const handlers = require("./_lib/adaptive-handlers");
const mediaUpload = require("./_lib/media-upload-handler");

module.exports = function handler(req, res) {
  const url = new URL(req.url, "https://portal.invalid");
  const op = url.searchParams.get("op") || "plan";
  const selected = { plan: handlers.plan, media: handlers.mediaWorker, adaptation: handlers.adaptationWorker,
    frequency: handlers.frequencyWorker, delivery: handlers.prepareDelivery, link: handlers.link, upload: mediaUpload }[op];
  if (!selected) { res.statusCode = 404; return res.end("Not found"); }
  return selected(req, res);
};
