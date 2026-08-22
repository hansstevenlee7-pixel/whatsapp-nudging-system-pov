"use strict";

const { JWT } = require("google-auth-library");
const { httpError } = require("./http");

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
let testAdapter = null;
let authClient = null;

function required(name) {
  const value = process.env[name];
  if (!value) throw httpError(503, `${name} is not configured`);
  return value;
}

function spreadsheetId() {
  return required("GOOGLE_SHEETS_SPREADSHEET_ID");
}

function client() {
  if (!authClient) {
    authClient = new JWT({
      email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      key: required("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });
  }
  return authClient;
}

async function request(path, options = {}) {
  const authHeaders = await client().getRequestHeaders();
  const normalizedHeaders = typeof authHeaders.entries === "function" ? Object.fromEntries(authHeaders.entries()) : Object.assign({}, authHeaders);
  const headers = Object.assign({}, normalizedHeaders, options.headers || {});
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const response = await fetch(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId())}${path}`, Object.assign({}, options, { headers }));
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { message: text }; }
  if (!response.ok) {
    const message = body && body.error && body.error.message || body.message || `Google Sheets HTTP ${response.status}`;
    throw httpError(response.status === 401 || response.status === 403 ? 502 : response.status, message);
  }
  return body;
}

function quoteSheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function rowsFromValues(values) {
  const headers = (values[0] || []).map(value => String(value).trim());
  if (!headers.length || headers.some(header => !header)) throw httpError(500, "Google Sheets contains a blank or missing header");
  if (new Set(headers).size !== headers.length) throw httpError(500, "Google Sheets contains duplicate headers");
  const rows = values.slice(1).map((valuesRow, index) => {
    const row = { row_number: index + 2 };
    headers.forEach((header, column) => { row[header] = valuesRow[column] == null ? "" : valuesRow[column]; });
    return row;
  }).filter(row => headers.some(header => String(row[header] == null ? "" : row[header]).trim() !== ""));
  return { headers, rows };
}

async function readTabs(names) {
  if (testAdapter) return testAdapter.readTabs(names);
  const params = names.map(name => `ranges=${encodeURIComponent(quoteSheet(name))}`).join("&");
  const body = await request(`/values:batchGet?majorDimension=ROWS&${params}`);
  const ranges = body.valueRanges || [];
  if (ranges.length !== names.length) throw httpError(502, "Google Sheets returned an incomplete tab response");
  return Object.fromEntries(names.map((name, index) => [name, rowsFromValues(ranges[index].values || [])]));
}

function cell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { userEnteredValue: { numberValue: value } };
  if (typeof value === "boolean") return { userEnteredValue: { boolValue: value } };
  return { userEnteredValue: { stringValue: value == null ? "" : String(value) } };
}

function rowData(headers, row) {
  return { values: headers.map(header => cell(row[header])) };
}

async function sheetIds() {
  const body = await request("?fields=sheets.properties(sheetId,title)");
  return Object.fromEntries((body.sheets || []).map(sheet => [sheet.properties.title, sheet.properties.sheetId]));
}

async function batchWrite(operations) {
  if (!operations.length) return { replies: [] };
  if (testAdapter) return testAdapter.batchWrite(operations);
  const ids = await sheetIds();
  const requests = operations.map(operation => {
    const sheetId = ids[operation.tab];
    if (sheetId == null) throw httpError(500, `Missing Google Sheets tab: ${operation.tab}`);
    const data = rowData(operation.headers, operation.row);
    if (operation.rowNumber) {
      return { updateCells: {
        range: { sheetId, startRowIndex: operation.rowNumber - 1, endRowIndex: operation.rowNumber, startColumnIndex: 0, endColumnIndex: operation.headers.length },
        rows: [data], fields: "userEnteredValue"
      } };
    }
    return { appendCells: { sheetId, rows: [data], fields: "userEnteredValue" } };
  });
  return request(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
}

function assertHeaders(table, requiredHeaders, tab) {
  const missing = requiredHeaders.filter(header => !table.headers.includes(header));
  if (missing.length) throw httpError(500, `${tab} is missing required columns: ${missing.join(", ")}`);
}

function operation(tab, table, row, existing) {
  return { tab, headers: table.headers, row, rowNumber: existing && existing.row_number || null };
}

function _setTestAdapter(adapter) {
  testAdapter = adapter || null;
  authClient = null;
}

module.exports = { readTabs, batchWrite, assertHeaders, operation, _setTestAdapter };
