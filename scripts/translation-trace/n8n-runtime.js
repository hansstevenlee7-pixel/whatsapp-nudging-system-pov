"use strict";

// Minimal n8n execution for the RQ1 translation-trace harness (PROTOCOL.md).
//
// Code nodes run the JavaScript stored in workflows/*.json unchanged. IF, HTTP,
// Google Sheets, webhook and respond nodes are emulated from the parameters
// declared in the same file; HTTP calls go to handlers the harness supplies, and
// Sheets nodes read and write the in-memory test fixture. Only the node types the
// two workflows use are supported, and anything else throws, so a workflow change
// cannot be skipped silently.

const crypto = require("node:crypto");

// --- Luxon-compatible subset for $now ------------------------------------------
// Workflow code uses: plus({days|minutes}), setZone, toISODate, toISO,
// startOf("day") and diff(other, "minutes").minutes.
function zoneParts(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second,
    millisecond: ((ms % 1000) + 1000) % 1000 };
}
function offsetMinutes(ms, zone) {
  const p = zoneParts(ms, zone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.millisecond) - ms) / 60000);
}
class DateTime {
  constructor(ms, zone) { this.ms = ms; this.zone = zone; }
  static fromLocal(p, zone) {
    const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0, p.second || 0, p.millisecond || 0);
    let ms = guess - offsetMinutes(guess, zone) * 60000;
    ms = guess - offsetMinutes(ms, zone) * 60000;
    return new DateTime(ms, zone);
  }
  setZone(zone) { return new DateTime(this.ms, zone); }
  plus(duration) {
    let next = this;
    if (duration.days) {
      const p = zoneParts(this.ms, this.zone); const date = new Date(Date.UTC(p.year, p.month - 1, p.day + duration.days));
      next = DateTime.fromLocal(Object.assign({}, p, { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }), this.zone);
    }
    const extra = ((duration.hours || 0) * 60 + (duration.minutes || 0)) * 60000 + (duration.seconds || 0) * 1000;
    return extra ? new DateTime(next.ms + extra, next.zone) : next;
  }
  startOf(unit) {
    if (unit !== "day") throw new Error(`n8n runtime: startOf(${unit}) is not supported`);
    const p = zoneParts(this.ms, this.zone);
    return DateTime.fromLocal({ year: p.year, month: p.month, day: p.day }, this.zone);
  }
  diff(other, unit) {
    if (unit !== "minutes") throw new Error(`n8n runtime: diff(${unit}) is not supported`);
    return { minutes: (this.ms - other.ms) / 60000 };
  }
  toISODate() {
    const p = zoneParts(this.ms, this.zone);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }
  toISO() {
    const p = zoneParts(this.ms, this.zone); const offset = offsetMinutes(this.ms, this.zone); const pad = n => String(n).padStart(2, "0");
    const sign = offset >= 0 ? "+" : "-"; const abs = Math.abs(offset);
    return `${this.toISODate()}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${String(p.millisecond).padStart(3, "0")}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }
}

// --- Expressions ---------------------------------------------------------------
function evaluate(value, scope) {
  if (typeof value !== "string" || !value.startsWith("=")) return value;
  const template = value.slice(1);
  const run = expression => Function(...Object.keys(scope), `return (${expression});`)(...Object.values(scope));
  const whole = template.match(/^\{\{([\s\S]*)\}\}$/);
  if (whole && !whole[1].includes("{{")) return run(whole[1]);
  return template.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => String(run(expression)));
}

// --- Workflow runner -----------------------------------------------------------
// Deterministic UUIDs for Code nodes that call crypto.randomUUID (declared stand-in).
function deterministicRequire(seed) {
  let counter = 0;
  const harnessCrypto = Object.assign({}, crypto, { randomUUID() {
    const hex = crypto.createHash("sha256").update(`${seed}|${++counter}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  } });
  return name => (name === "crypto" || name === "node:crypto") ? harnessCrypto : require(name);
}

async function runWorkflow(workflow, { trigger, env, now, http = {}, sheets, uuidSeed = "harness" }) {
  const byName = new Map(workflow.nodes.map(node => [node.name, node]));
  const outputs = new Map(); const visited = []; let response = null;
  const zone = (workflow.settings && workflow.settings.timezone) || "Australia/Melbourne";
  const $now = new DateTime(now(), zone);
  const requireFn = deterministicRequire(uuidSeed);
  const $ = name => {
    if (!outputs.has(name)) throw new Error(`n8n runtime: node "${name}" has not run`);
    const items = outputs.get(name);
    return { first: () => items[0], last: () => items[items.length - 1], all: () => items };
  };
  const next = (name, index = 0) => (((workflow.connections[name] || {}).main || [])[index] || []).map(link => link.node);

  async function execute(node, input) {
    const type = node.type.replace(/^n8n-nodes-base\./, ""); const p = node.parameters || {};
    const scopeFor = item => ({ $json: item ? item.json : {}, $, $env: env, $now });
    if (type === "code") {
      const code = p.jsCode;
      const result = Function("items", "$input", "$json", "$", "$env", "$now", "require", "Buffer", code)(
        input, { all: () => input, first: () => input[0], last: () => input[input.length - 1] }, input[0] ? input[0].json : {}, $, env, $now, requireFn, Buffer);
      return [await result];
    }
    if (type === "if") {
      const routes = [[], []];
      for (const item of input) {
        const ok = p.conditions.conditions.every(condition => {
          if (!(condition.operator && condition.operator.type === "boolean" && condition.operator.operation === "true")) {
            throw new Error(`n8n runtime: unsupported IF operator in "${node.name}"`);
          }
          return evaluate(condition.leftValue, scopeFor(item)) === true;
        });
        routes[ok ? 0 : 1].push(item);
      }
      return routes;
    }
    if (type === "httpRequest") {
      const handler = http[node.name];
      if (!handler) throw new Error(`n8n runtime: no handler for HTTP node "${node.name}"`);
      const out = [];
      for (const item of input) {
        const scope = scopeFor(item);
        const headers = Object.fromEntries(((p.headerParameters && p.headerParameters.parameters) || []).map(h => [h.name.toLowerCase(), evaluate(h.value, scope)]));
        out.push({ json: await handler({ method: p.method, url: evaluate(p.url, scope), headers, body: evaluate(p.body, scope) }, item) });
      }
      return [out];
    }
    if (type === "googleSheets") {
      const tab = p.sheetName.value; const table = sheets.tables[tab];
      if (!table) throw new Error(`n8n runtime: sheet "${tab}" is not in the fixture`);
      const nextRow = () => table.rows.reduce((max, row) => Math.max(max, row.row_number), 1) + 1;
      const keep = row => Object.fromEntries(Object.entries(row).filter(([key]) => table.headers.includes(key)).map(([k, v]) => [k, v == null ? "" : v]));
      if (p.operation === "read") return [table.rows.map(row => ({ json: JSON.parse(JSON.stringify(row)) }))];
      const out = [];
      for (const item of input) {
        if (p.operation === "append" && p.columns.mappingMode === "autoMapInputData") {
          const row = Object.assign({ row_number: nextRow() }, keep(item.json)); table.rows.push(row); sheets.writes.push({ tab, op: "append", row: JSON.parse(JSON.stringify(row)) });
          out.push({ json: row }); continue;
        }
        if (["update", "appendOrUpdate"].includes(p.operation) && p.columns.mappingMode === "defineBelow") {
          const scope = scopeFor(item);
          const values = keep(Object.fromEntries(Object.entries(p.columns.value).map(([k, v]) => [k, evaluate(v, scope)])));
          const match = p.columns.matchingColumns; const found = table.rows.find(row => match.every(key => String(row[key]) === String(values[key])));
          if (found) { Object.assign(found, values); sheets.writes.push({ tab, op: "update", row: JSON.parse(JSON.stringify(found)) }); out.push({ json: found }); }
          else if (p.operation === "appendOrUpdate") {
            const row = Object.assign({ row_number: nextRow() }, values); table.rows.push(row); sheets.writes.push({ tab, op: "append", row: JSON.parse(JSON.stringify(row)) }); out.push({ json: row });
          } else out.push({ json: {} });
          continue;
        }
        throw new Error(`n8n runtime: unsupported Sheets operation in "${node.name}"`);
      }
      return [out];
    }
    if (type === "respondToWebhook") {
      const scope = scopeFor(input[0]);
      const body = evaluate(p.responseBody, scope);
      response = { status: (p.options && p.options.responseCode) || 200, body: p.respondWith === "json" ? body : String(body) };
      return [input];
    }
    throw new Error(`n8n runtime: unsupported node type ${type} ("${node.name}")`);
  }

  const start = workflow.nodes.find(node => /webhook$|scheduleTrigger$/.test(node.type));
  outputs.set(start.name, [{ json: trigger }]); visited.push(start.name);
  const queue = next(start.name).map(name => ({ name, from: start.name, index: 0 }));
  try {
    while (queue.length) {
      const { name, from, index } = queue.shift();
      const input = (from === start.name ? outputs.get(start.name) : (outputs.get(`${from}#${index}`) || outputs.get(from)));
      if (!input || !input.length) continue;
      const node = byName.get(name); const routes = await execute(node, input);
      outputs.set(name, routes[0] || []); visited.push(name);
      routes.forEach((items, i) => { outputs.set(`${name}#${i}`, items || []); for (const target of next(name, i)) queue.push({ name: target, from: name, index: i }); });
    }
  } catch (error) {
    return { error: String(error && error.message || error), visited, response: response || { status: 500, body: JSON.stringify({ message: "Workflow execution failed" }) } };
  }
  return { visited, response, outputs: Object.fromEntries([...outputs].filter(([key]) => !key.includes("#")).map(([k, v]) => [k, v.map(item => item.json)])) };
}

module.exports = { DateTime, evaluate, runWorkflow };
