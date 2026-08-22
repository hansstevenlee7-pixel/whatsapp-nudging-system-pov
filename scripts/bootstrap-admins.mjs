const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PUBLIC_APP_URL"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required`);

const base = process.env.SUPABASE_URL.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const redirectTo = `${process.env.PUBLIC_APP_URL.replace(/\/$/, "")}/set-password.html`;
const admins = [
  { display_name: "Hans Lee", email: "hlee0189@student.monash.edu" }
];

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${body.msg || body.message || body.error || "request failed"}`);
  return body;
}

for (const admin of admins) {
  const invited = await request(`/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST", body: JSON.stringify({ email: admin.email, data: { display_name: admin.display_name } })
  });
  const doctorId = `doc_${crypto.randomUUID()}`;
  await request("/rest/v1/profiles?on_conflict=auth_user_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ auth_user_id: invited.id, email: admin.email, display_name: admin.display_name, role: "admin", doctor_id: doctorId, status: "active" })
  });
  console.log(`Invited ${admin.email} as ${doctorId}`);
}
