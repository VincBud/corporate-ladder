-- Corporate Ladder · Pipeline Panic v0.1
--
-- Registers the second verified minigame. Additive only: the existing round
-- functions (create, hint, finalize with XP and contribution events) are
-- game-agnostic and are reused unchanged.
--
--   * game_rules: Pipeline Panic v1, same timing and XP divisor as
--     Reconciliation Rush (90 s, 3 s network tolerance, 1 XP per 20 points).
--   * Contribution formula v1: all of a round's points go to Sales'
--     Pipeline health metric. Reconciliation Rush formulas are untouched.

insert into public.game_rules (game_id, rules_version, duration_ms, tolerance_ms, xp_score_divisor, max_sessions_per_minute)
values ('pipeline-panic', 1, 90000, 3000, 20, 12);

insert into public.contribution_formulas (game_id, formula_version) values ('pipeline-panic', 1);
insert into public.contribution_allocations (game_id, formula_version, metric_id, department_id, weight_bp)
values ('pipeline-panic', 1, 'pipeline-health', 'sales', 10000);
