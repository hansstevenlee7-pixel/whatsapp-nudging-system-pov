(function () {
  "use strict";

  var STORAGE_KEY = "clinician_portal_session";
  var configPromise = null;

  function config() {
    if (!configPromise) configPromise = fetch("/api/config", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("Authentication is not configured"); return r.json(); })
      .then(function (c) { if (!c.supabaseUrl || !c.supabaseAnonKey) throw new Error("Authentication is not configured"); return c; });
    return configPromise;
  }

  function session() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) { return null; }
  }

  function saveSession(value) {
    if (value && value.access_token) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  }

  async function authRequest(path, options) {
    var c = await config();
    var headers = Object.assign({ apikey: c.supabaseAnonKey, "content-type": "application/json" }, options && options.headers || {});
    var response = await fetch(c.supabaseUrl.replace(/\/$/, "") + path, Object.assign({}, options || {}, { headers: headers }));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(body.error_description || body.msg || body.message || "Authentication failed");
      error.status = response.status; error.body = body;
      throw error;
    }
    return body;
  }

  async function signIn(email, password) {
    var value = await authRequest("/auth/v1/token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email: email, password: password })
    });
    saveSession(value);
    return value;
  }

  async function refresh() {
    var current = session();
    if (!current || !current.refresh_token) throw new Error("Session expired");
    var value = await authRequest("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", body: JSON.stringify({ refresh_token: current.refresh_token })
    });
    saveSession(value);
    return value;
  }

  async function api(path, options) {
    var current = session();
    if (!current || !current.access_token) throw new Error("Authentication required");
    var headers = Object.assign({}, options && options.headers || {}, { authorization: "Bearer " + current.access_token });
    if (options && options.body && !headers["content-type"]) headers["content-type"] = "application/json";
    var response = await fetch(path, Object.assign({}, options || {}, { headers: headers }));
    if (response.status === 401) {
      try {
        current = await refresh();
        headers.authorization = "Bearer " + current.access_token;
        response = await fetch(path, Object.assign({}, options || {}, { headers: headers }));
      } catch (_) {
        saveSession(null);
        location.replace("login.html?next=" + encodeURIComponent(location.pathname + location.search));
        throw new Error("Session expired");
      }
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(body.error || "Request failed (HTTP " + response.status + ")");
      error.status = response.status; error.body = body;
      throw error;
    }
    return body;
  }

  async function me() { return (await api("/api/me")).profile; }

  async function guard(options) {
    try {
      var profile = await me();
      if (options && options.admin && profile.role !== "admin") {
        location.replace("monitor.html");
        throw new Error("Administrator access required");
      }
      document.documentElement.classList.add("auth-ready");
      return profile;
    } catch (error) {
      if (!/Administrator/.test(error.message)) location.replace("login.html?next=" + encodeURIComponent(location.pathname + location.search));
      throw error;
    }
  }

  async function signOut() {
    var current = session();
    try {
      if (current && current.access_token) await authRequest("/auth/v1/logout", { method: "POST", headers: { authorization: "Bearer " + current.access_token } });
    } catch (_) {}
    saveSession(null);
    location.replace("login.html");
  }

  async function requestReset(email) {
    return authRequest("/auth/v1/recover", {
      method: "POST", body: JSON.stringify({ email: email, redirect_to: location.origin + "/set-password.html" })
    });
  }

  function consumeHashSession() {
    var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    var query = new URLSearchParams(location.search);
    var errorDescription = hash.get("error_description") || query.get("error_description");
    if (errorDescription) {
      history.replaceState(null, "", location.pathname);
      return { error: errorDescription.replace(/\+/g, " ") };
    }
    if (!hash.get("access_token")) return null;
    var value = {
      access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"),
      expires_in: Number(hash.get("expires_in") || 3600), token_type: hash.get("token_type") || "bearer"
    };
    saveSession(value);
    history.replaceState(null, "", location.pathname);
    return value;
  }

  async function updatePassword(password) {
    var current = session();
    if (!current || !current.access_token) throw new Error("Invitation or reset link is invalid or expired");
    return authRequest("/auth/v1/user", {
      method: "PUT", headers: { authorization: "Bearer " + current.access_token }, body: JSON.stringify({ password: password })
    });
  }

  window.Auth = { config: config, session: session, signIn: signIn, signOut: signOut, refresh: refresh, api: api, me: me, guard: guard,
    requestReset: requestReset, consumeHashSession: consumeHashSession, updatePassword: updatePassword };
})();
