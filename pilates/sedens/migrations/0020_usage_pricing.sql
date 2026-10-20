-- SEDENS 0020: facility usage and a non-invoicing fee simulation (Phase 4).
--
-- A price plan is SEDENS-global reference data; an organization is assigned a
-- plan by a SEDENS administrator, and an organization without an assignment is
-- simulated with the default plan. Nothing here bills anyone: the facility usage
-- page only multiplies counted rooms and billable visits by these amounts and
-- labels the result "Simulation - not an invoice".
--
-- Amounts: KRW has no minor unit, so *_minor for KRW is a whole number of won
-- (99000 is 99,000 won), the same convention as s_course_prices.amount_minor.
-- VAT is not included unless vat_included = 1; the proposal below excludes it.
CREATE TABLE IF NOT EXISTS s_usage_price_plans(
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('KRW')),
  room_month_minor INTEGER NOT NULL CHECK(room_month_minor >= 0),
  per_session_minor INTEGER NOT NULL CHECK(per_session_minor >= 0),
  vat_included INTEGER NOT NULL DEFAULT 0 CHECK(vat_included IN (0,1)),
  billable_unit TEXT NOT NULL CHECK(billable_unit IN ('visit_with_completed_workout')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS s_org_usage_plans(
  org_id TEXT PRIMARY KEY REFERENCES p_organizations ON DELETE CASCADE,
  -- Cascades like every SEDENS foreign key (docs/SEDENS_SECURITY_MODEL.md section 7).
  -- No route deletes a plan; if one is ever deleted by hand, its facilities are
  -- simulated with the default plan again.
  plan_id TEXT NOT NULL REFERENCES s_usage_price_plans ON DELETE CASCADE,
  assigned_by TEXT REFERENCES p_users ON DELETE SET NULL,
  assigned_at TEXT NOT NULL
);

INSERT OR IGNORE INTO s_usage_price_plans(id,label,currency,room_month_minor,per_session_minor,vat_included,billable_unit,created_at)
VALUES ('proposal-2026-10','Proposed B2B pricing (October 2026)','KRW',99000,250,0,'visit_with_completed_workout','2026-10-20T00:00:00Z');
