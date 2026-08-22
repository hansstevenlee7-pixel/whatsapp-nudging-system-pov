"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/schedule");
const { melbourneIso } = require("../api/_lib/schedule-store");
const { fixture, baseSeed } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

function installAuth(t) {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).startsWith("https://supabase.test/rest/v1/profiles")) {
      return new Response(JSON.stringify([{ auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(function () {
    global.fetch = previousFetch;
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
}

function slot(id, day, source, time = "09:00") {
  return {
    schedule_slot_id: id, source_nudge_id: source, prescription_id: "rx-1", day, time,
    nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", tone_variant: "encouraging",
    message_body: `${day} reminder`, message_body_alt: "", template_name: "health_plan_reminder"
  };
}

async function save(slots, range = { start_date: "2099-08-01", end_date: "2099-08-31" }) {
  const req = { method: "PUT", headers: { authorization: "Bearer token" }, body: Object.assign(
    { user_id: "patient-1", slots }, range
  ) };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

// Melbourne is UTC+10 in August, so this instant is midday on the same local day.
const MELBOURNE_MIDDAY = Date.parse("2099-08-05T02:00:00Z");
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function todayInMelbourne() {
  const iso = melbourneIso();
  return { iso, weekday: DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()] };
}

test("removing Sunday persists canonically and rejects its future unsent rows", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  const initialSlots = [slot("slot-wed", "wednesday", "source-wed"), slot("slot-fri", "friday", "source-fri"), slot("slot-sun", "sunday", "source-sun")];

  const initial = await save(initialSlots);
  assert.equal(initial.statusCode, 200);
  assert.equal(JSON.parse(initial.body).persisted, true);
  assert.deepEqual(JSON.parse(initial.body).weekly_schedule.map(row => row.day).sort(), ["friday", "sunday", "wednesday"]);

  const removed = await save(initialSlots.slice(0, 2));
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(JSON.parse(removed.body).weekly_schedule.map(row => row.day).sort(), ["friday", "wednesday"]);
  assert.equal(store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-sun").status, "inactive");
  const sundayDeliveries = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-sun");
  assert.ok(sundayDeliveries.length > 0);
  assert.ok(sundayDeliveries.every(row => row.status === "rejected"));
});

test("repeated saves are idempotent and do not duplicate delivery rows", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  const slots = [slot("slot-sun", "sunday", "source-sun")];
  assert.equal((await save(slots)).statusCode, 200);
  const firstIds = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-sun").map(row => row.nudge_id).sort();
  assert.equal((await save(slots)).statusCode, 200);
  const secondIds = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-sun").map(row => row.nudge_id).sort();
  assert.deepEqual(secondIds, firstIds);
});

test("sent history survives removal of its recurring slot", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  const slots = [slot("slot-wed", "wednesday", "source-wed"), slot("slot-sun", "sunday", "source-sun")];
  assert.equal((await save(slots)).statusCode, 200);
  const sent = store.tables.nudges.rows.find(row => row.schedule_slot_id === "slot-sun");
  sent.status = "sent";
  sent.sent_at = "2099-08-02T09:00:00Z";

  assert.equal((await save(slots.slice(0, 1))).statusCode, 200);
  assert.equal(store.tables.nudges.rows.find(row => row.nudge_id === sent.nudge_id).status, "sent");
});

test("a failed Sheets batch never reports a successful save", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  store.failNextBatch();
  const res = await save([slot("slot-sun", "sunday", "source-sun")]);
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error, "Internal server error");
  assert.equal(store.tables.weekly_schedule.rows.length, 0);
});

test("approving materializes a slot still ahead of now on the current Melbourne day", async function (t) {
  installAuth(t);
  t.mock.timers.enable({ apis: ["Date"], now: MELBOURNE_MIDDAY });
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  const { iso, weekday } = todayInMelbourne();

  const res = await save([slot("slot-today", weekday, "source-wed", "18:00")], { start_date: iso, end_date: iso });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).effective_start_date, iso);

  const created = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-today");
  assert.equal(created.length, 1);
  assert.equal(created[0].scheduled_date, iso);
  assert.equal(created[0].status, "approved");
});

test("approving does not materialize a slot whose Melbourne time has already passed today", async function (t) {
  installAuth(t);
  t.mock.timers.enable({ apis: ["Date"], now: MELBOURNE_MIDDAY });
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  const { iso, weekday } = todayInMelbourne();

  const res = await save([slot("slot-past", weekday, "source-wed", "06:00")], { start_date: iso, end_date: iso });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /no dated nudges/);
  assert.equal(store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-past").length, 0);
});

test("a same-day approval keeps upcoming slots and drops only the passed ones", async function (t) {
  installAuth(t);
  t.mock.timers.enable({ apis: ["Date"], now: MELBOURNE_MIDDAY });
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  const { iso, weekday } = todayInMelbourne();

  const res = await save([
    slot("slot-past", weekday, "source-wed", "06:00"),
    slot("slot-ahead", weekday, "source-fri", "18:00")
  ], { start_date: iso, end_date: iso });

  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-past").length, 0);
  assert.equal(store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-ahead").length, 1);
  // Both remain canonical weekly slots; only today's delivery row is withheld.
  assert.deepEqual(
    store.tables.weekly_schedule.rows.filter(row => row.status === "active").map(row => row.schedule_slot_id).sort(),
    ["slot-ahead", "slot-past"]
  );
});

test("a clinician cannot attach another patient's source row to an owned schedule", async function (t) {
  installAuth(t);
  const seed = baseSeed();
  seed.nudges.push(Object.assign({}, seed.nudges[0], { nudge_id: "foreign-source", user_id: "patient-2" }));
  const store = fixture(seed);
  t.after(() => store.restore());
  const res = await save([slot("slot-foreign", "sunday", "foreign-source")]);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /does not belong to this patient/);
  assert.equal(store.tables.weekly_schedule.rows.length, 0);
});
