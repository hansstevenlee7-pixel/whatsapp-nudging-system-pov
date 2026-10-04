"use strict";

const { sendJson, method } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  sendJson(res, 200, {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ""
  });
};
