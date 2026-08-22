const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PUBLIC_APP_URL"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const supabase = process.env.SUPABASE_URL.replace(/\/$/, "");
const app = process.env.PUBLIC_APP_URL.replace(/\/$/, "");
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const suffix = crypto.randomUUID();
const email = `codex-smoke-${suffix}@example.invalid`;
const password = `Smoke-${crypto.randomUUID()}-aA1!`;
const doctorId = `doc_${crypto.randomUUID()}`;
let authUserId = "";

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

try {
  const created = await jsonRequest(`${supabase}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  if (!created.response.ok) throw new Error(`Create smoke user failed: ${created.response.status}`);
  authUserId = created.body.id;

  const profile = await jsonRequest(`${supabase}/rest/v1/profiles`, {
    method: "POST",
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify({ auth_user_id: authUserId, email, display_name: "Codex Smoke Doctor", role: "doctor", doctor_id: doctorId, status: "active" })
  });
  if (!profile.response.ok) throw new Error(`Create smoke profile failed: ${profile.response.status}`);

  const login = await jsonRequest(`${supabase}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anon, "content-type": "application/json" }, body: JSON.stringify({ email, password })
  });
  if (!login.response.ok || !login.body.access_token) throw new Error(`Smoke login failed: ${login.response.status}`);
  const headers = { authorization: `Bearer ${login.body.access_token}` };

  const me = await jsonRequest(`${app}/api/me`, { headers });
  if (!me.response.ok || me.body.profile?.doctor_id !== doctorId) throw new Error(`GET /api/me failed: ${me.response.status}`);

  const patients = await jsonRequest(`${app}/api/patients`, { headers });
  if (!patients.response.ok || patients.body.count !== 0) throw new Error(`Expected zero assigned patients, got ${patients.body.count}`);

  const forbidden = await jsonRequest(`${app}/api/approve`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ user_id: "ec9b32bd-5224-4fcc-a642-692a4e98ff72", decision: "approve", slots: [] })
  });
  if (forbidden.response.status !== 403) throw new Error(`Expected cross-doctor 403, got ${forbidden.response.status}`);

  console.log("Production auth smoke passed: login, profile, zero-patient filtering, and cross-doctor 403.");
} finally {
  if (authUserId) {
    await fetch(`${supabase}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      method: "DELETE", headers: { apikey: service, authorization: `Bearer ${service}` }
    });
  }
}
