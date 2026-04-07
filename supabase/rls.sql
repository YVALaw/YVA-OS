-- ============================================================
-- YVA OS — Row Level Security Policies
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ── Step 1: Helper function ───────────────────────────────────────────────────
-- Returns the role of the currently authenticated user.
-- SECURITY DEFINER means it runs with elevated privileges so it can
-- always read user_roles regardless of other RLS policies.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1
$$ LANGUAGE SQL SECURITY DEFINER STABLE;


-- ── Step 2: Enable RLS on every table ────────────────────────────────────────

ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles        ENABLE ROW LEVEL SECURITY;


-- ── Step 3: Shared org tables ─────────────────────────────────────────────────
-- Any authenticated user (your team) can read and write shared data.
-- Unauthenticated requests (no valid JWT) are blocked entirely.

CREATE POLICY "team_all" ON employees         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON clients           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON projects          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON invoices          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON expenses          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON tasks              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON activity_log      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON candidates        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON invoice_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "team_all" ON counters          FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ── Step 4: Settings table ────────────────────────────────────────────────────
-- Everyone can read settings (exchange rate, company info, etc.)
-- Only CEO can change settings.

CREATE POLICY "settings_read"  ON settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "settings_write" ON settings
  FOR ALL TO authenticated
  USING     (public.current_user_role() = 'ceo')
  WITH CHECK (public.current_user_role() = 'ceo');


-- ── Step 5: User roles table ──────────────────────────────────────────────────
-- Everyone can read the roles list (needed for team access page + role context).
-- Users can insert their own initial role (first login auto-assign).
-- Only CEO can change or remove any role.

CREATE POLICY "user_roles_read" ON user_roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "user_roles_self_insert" ON user_roles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_roles_ceo_update" ON user_roles
  FOR UPDATE TO authenticated
  USING     (public.current_user_role() = 'ceo')
  WITH CHECK (public.current_user_role() = 'ceo');

CREATE POLICY "user_roles_ceo_delete" ON user_roles
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'ceo');


-- ── Step 6: Disable sign-ups (IMPORTANT) ─────────────────────────────────────
-- The app currently allows anyone with the URL to create an account.
-- To lock it down to invited users only, go to:
--   Supabase Dashboard → Authentication → Providers → Email
--   → Turn OFF "Enable sign ups"
-- Then add users manually via Dashboard → Authentication → Users → Invite user.
-- This is strongly recommended before storing payment information.


-- ── Step 7: Verify ───────────────────────────────────────────────────────────
-- After running, verify in the Table Editor that each table shows
-- "RLS enabled" in the top bar, and check the Policies tab to confirm
-- each policy was created. You can test by logging in as a non-CEO user
-- and confirming they cannot modify user_roles or settings directly.
