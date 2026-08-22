# Supabase authentication setup

1. The current Supabase project is `Intelligent AI Nudging System` in South Asia
   (Mumbai), selected during prototype setup. Reassess institutional data-residency
   requirements before handling real participant data.
2. In **Authentication → URL Configuration**, set the site URL to the Vercel URL and add
   `https://whatsapp-nudging-system.vercel.app/set-password.html` as a redirect URL.
3. Disable public user sign-ups. Accounts are created only through the authenticated admin API.
4. Run `migrations/001_clinician_auth.sql` in the SQL editor.
5. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
6. Bootstrap Hans and David with `scripts/bootstrap-admins.mjs` after setting the same variables locally.

The service-role key bypasses row-level security and must never be exposed in browser code or committed.
