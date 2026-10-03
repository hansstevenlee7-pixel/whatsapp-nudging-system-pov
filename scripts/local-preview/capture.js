"use strict";

// Captures appendix screenshots from the local synthetic preview (server.js must
// be running). Uses headless Google Chrome with a temporary profile through the
// DevTools protocol; the user's own browser profile is not touched.
//
// The clinician session is placed in localStorage directly (the preview accepts
// a single synthetic session token), so no credentials are typed or stored.
// For every screenshot the visible page text is saved beside it, so captions
// can be checked against what the page actually showed.
//
//   node scripts/local-preview/capture.js output/appendix_screenshots_2026-10-04

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(ROOT, process.argv[2] || "output/appendix_screenshots");
const BASE = `http://127.0.0.1:${Number(process.env.PREVIEW_PORT || 8790)}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 9333;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "preview-chrome-"));
  const chrome = cp.spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, "about:blank"], { stdio: "ignore" });
  try {
    let targets;
    for (let i = 0; i < 60 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); } catch (_) { await sleep(250); }
    }
    const page = targets.find(target => target.type === "page");
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0; const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, message => message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result));
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
    const waitFor = async (expression, label) => {
      for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await sleep(250); }
      throw new Error(`Timed out waiting for ${label}`);
    };
    const navigate = async url => { await send("Page.navigate", { url }); await sleep(400); await waitFor("document.readyState === 'complete'", `load ${url}`); };

    await send("Page.enable"); await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1.5, mobile: false });
    const shots = [];
    // Full-page captures enlarge the emulated window to the page height instead of
    // scrolling, so sticky header and save bar stay where a reader would see them.
    const viewport = height => send("Emulation.setDeviceMetricsOverride", { width: 1366, height, deviceScaleFactor: 1.5, mobile: false });
    async function fitPage() {
      for (let i = 0; i < 3; i++) {
        const height = Math.ceil((await send("Page.getLayoutMetrics")).cssContentSize.height);
        await viewport(Math.max(900, height)); await sleep(300);
      }
    }
    async function capture(name, description, mode = "page", selector = null) {
      await sleep(500);
      let clip;
      if (mode !== "viewport") await fitPage();
      if (mode === "element") {
        const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
          return { x: Math.max(0, r.left - 16), y: Math.max(0, r.top - 16), width: r.width + 32, height: r.height + 32 }; })()`);
        clip = Object.assign(box, { scale: 1 });
      }
      const shot = await send("Page.captureScreenshot", Object.assign({ format: "png" }, clip ? { clip } : {}));
      await viewport(900);
      const file = path.join(OUT, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      fs.writeFileSync(path.join(OUT, `${name}.txt`), `${await evaluate("document.body.innerText")}\n`);
      shots.push({ file: path.basename(file), text: `${name}.txt`, url: await evaluate("location.pathname + location.search"),
        description, sha256: sha(file) });
    }

    await navigate(`${BASE}/login.html`);
    await capture("01_clinician_sign_in", "Clinician sign-in page before authentication", "viewport");

    await evaluate(`localStorage.setItem("clinician_portal_session", JSON.stringify({ access_token: "local-preview-session",
      refresh_token: "local-preview-refresh", token_type: "bearer", expires_in: 3600 })); true`);
    await navigate(`${BASE}/monitor.html?user_id=synthetic-1`);
    await waitFor(`!document.getElementById("workspace").classList.contains("hidden") &&
      document.getElementById("overviewStatus").textContent.indexOf("Loading") < 0 &&
      !document.getElementById("adaptSummary").classList.contains("hidden")`, "patient overview");
    await capture("02_patient_overview", "Patient overview for the synthetic patient after the pipeline run");

    await evaluate(`document.getElementById("adaptDetails").click(); true`);
    await waitFor(`!document.getElementById("adaptPanel").classList.contains("hidden")`, "adaptation history");
    await capture("03_adaptation_history", "Adaptation history panel opened from the overview");

    await evaluate(`document.getElementById("adaptDetails").click(); document.getElementById("scheduleDetails").open = true; true`);
    await waitFor(`document.querySelectorAll("#week .nudge").length > 0`, "weekly schedule");
    await evaluate(`document.getElementById("nextWeek").click(); true`);
    await waitFor(`/11 Oct/.test(document.getElementById("weekRange").textContent) && document.querySelectorAll("#week .nudge").length > 0`, "week of 5 October");
    await evaluate(`document.querySelector("#week .nudge .expand").click(); true`);
    await sleep(300);
    await capture("04_schedule_review", "Schedule review panel, week of 5-11 October, first message expanded", "element", "#scheduleDetails");

    await navigate(`${BASE}/input.html`);
    await capture("05_prescription_input", "New prescription page");

    const version = await send("Browser.getVersion");
    const manifest = {
      captured_at: new Date().toISOString(), preview_base: BASE, browser: version.product,
      viewport: { width: 1366, height: 900, device_scale_factor: 1.5 },
      session: "Synthetic session token placed in localStorage; the sign-in form was not submitted and no credentials were used.",
      server: "scripts/local-preview/server.js (frozen server clock 2026-10-02T00:00:00Z; outbound requests other than local stand-ins refused)",
      git_commit: cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      working_tree: "dirty; source hashes below identify the exact files served",
      source_sha256: Object.fromEntries(["landing/monitor.html", "landing/login.html", "landing/input.html", "landing/auth.js",
        "landing/review-state.js", "landing/clinician-summary.js", "scripts/local-preview/server.js", "scripts/local-preview/capture.js",
        "scripts/adaptation-benchmark/engine.js", "scripts/adaptation-benchmark/local-store.js"].map(f => [f, sha(path.join(ROOT, f))])),
      screenshots: shots
    };
    fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    socket.close();
    process.stdout.write(`${shots.length} screenshots written to ${OUT}\n`);
  } finally {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
