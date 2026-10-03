"use strict";
const clone = value => JSON.parse(JSON.stringify(value));
// Minimal isolated PostgREST transport. Application store operations are unmodified.
function database(seed) {
  const tables = clone(seed); const requests = []; let nextId = 0;
  async function fetch(url, options = {}) {
    const u = new URL(url);
    if (u.origin !== "https://benchmark.invalid" || !u.pathname.startsWith("/rest/v1/")) throw new Error("Local database URL rejected");
    const name = u.pathname.split("/").at(-1);
    if (!Object.hasOwn(tables, name)) throw new Error(`Unimplemented local table: ${name}`);
    const table = tables[name]; const method = options.method || "GET";
    const payload = options.body ? JSON.parse(options.body) : null;
    requests.push({ table: name, method, query: u.search, payload: clone(payload) });
    const filters = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "on_conflict"].includes(k));
    const matches = row => filters.every(([key, expression]) => {
      if (expression.startsWith("eq.")) return String(row[key]) === expression.slice(3);
      if (expression === "is.null") return row[key] == null;
      if (expression.startsWith("in.(")) return expression.slice(4, -1).split(",").includes(String(row[key]));
      throw new Error(`Unimplemented filter ${expression}`);
    });
    let result;
    if (method === "GET") {
      result = table.filter(matches);
      const order = u.searchParams.get("order");
      if (order) { const [field, dir] = order.split("."); result.sort((a,b) => String(a[field] || "").localeCompare(String(b[field] || "")) * (dir === "desc" ? -1 : 1)); }
      if (u.searchParams.has("limit")) result = result.slice(0, Number(u.searchParams.get("limit")));
    } else if (method === "PATCH") {
      result = table.filter(matches); result.forEach(row => Object.assign(row, payload));
    } else if (method === "POST") {
      result = [];
      for (const input of [].concat(payload)) {
        const keys = (u.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
        const existing = keys.length && table.find(row => keys.every(k => row[k] === input[k]));
        const prefer = options.headers?.prefer || "";
        if (existing && prefer.includes("ignore-duplicates")) continue;
        if (existing) { Object.assign(existing, input); result.push(existing); }
        else {
          const row = clone(input);
          if (name === "adaptation_decisions") Object.assign(row, { decision_id: `bd_${++nextId}`, decided_at: new Date().toISOString() });
          table.push(row); result.push(row);
        }
      }
    } else throw new Error(`Unimplemented local method ${method}`);
    return new Response(JSON.stringify(clone(result)), { status: 200, headers: { "content-type": "application/json" } });
  }
  return { tables, requests, fetch };
}
module.exports = { database, clone };
