-- Two changes paired together so the SECURITY DEFINER warnings clear
-- AND the engineer-side panels (§11 OT, §12 PTO) keep working.
--
-- Part 1: Flip 22 views from the default SECURITY DEFINER mode to
-- security_invoker. After this, each view enforces the *querying user's*
-- RLS, not the view-creator's. Closes the "view bypasses RLS" hole the
-- Supabase advisor flagged as CRITICAL.
--
-- Part 2: A handful of views (v_pto_requests_enriched, v_pto_summary,
-- v_overtime_posts_with_signups) join public.users to surface full_name.
-- The existing users_self_or_elevated_select policy lets engineers read
-- only their own row + elevated roles — so under security_invoker an
-- engineer would see NULL/blank names for other engineers in those
-- panels. Adding a broad SELECT policy on users for all authenticated
-- users (the team is internal/trusted; basic profile fields are not
-- sensitive — email/phone live here but every engineer already has each
-- other's). The existing more-restrictive policy is left in place; the
-- new permissive one is OR-ed alongside it.

-- ===== Part 1: 22 views to security_invoker ===========================
ALTER VIEW public.labor_daily                        SET (security_invoker = true);
ALTER VIEW public.pm_closes_daily                    SET (security_invoker = true);
ALTER VIEW public.pm_variance_recent                 SET (security_invoker = true);
ALTER VIEW public.v_bms_heartbeat_latest             SET (security_invoker = true);
ALTER VIEW public.v_delta_alarm_events_recent        SET (security_invoker = true);
ALTER VIEW public.v_delta_alarms_by_category         SET (security_invoker = true);
ALTER VIEW public.v_delta_alarms_current             SET (security_invoker = true);
ALTER VIEW public.v_email_alarms_by_building         SET (security_invoker = true);
ALTER VIEW public.v_email_alarms_open                SET (security_invoker = true);
ALTER VIEW public.v_email_alarms_recent              SET (security_invoker = true);
ALTER VIEW public.v_overtime_posts_with_signups      SET (security_invoker = true);
ALTER VIEW public.v_plantlog_building_daily          SET (security_invoker = true);
ALTER VIEW public.v_plantlog_latest_per_log          SET (security_invoker = true);
ALTER VIEW public.v_plantlog_records_daily           SET (security_invoker = true);
ALTER VIEW public.v_plantlog_user_building_daily     SET (security_invoker = true);
ALTER VIEW public.v_plantlog_user_building_daily_visits SET (security_invoker = true);
ALTER VIEW public.v_plantlog_user_daily_span         SET (security_invoker = true);
ALTER VIEW public.v_plantlog_weekly_tests_status     SET (security_invoker = true);
ALTER VIEW public.v_pm_snapshots                     SET (security_invoker = true);
ALTER VIEW public.v_pto_requests_enriched            SET (security_invoker = true);
ALTER VIEW public.v_pto_summary                      SET (security_invoker = true);
ALTER VIEW public.wo_closes_daily                    SET (security_invoker = true);

-- ===== Part 2: Widen users SELECT for all authenticated users =========
-- This is the parallel change so cross-user joins in security_invoker
-- views (engineer reading other engineers' names in §11/§12) still work.
-- Sensitive credential data lives in auth.users (separate schema),
-- not public.users.

CREATE POLICY users_auth_select_all
  ON public.users
  FOR SELECT
  TO authenticated
  USING (true);
