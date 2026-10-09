-- SEDENS 0007: organization backups.
-- origin_id names the first affiliation a restored affiliation descends from,
-- so one archive can re-link it at most once while that lineage is alive.
-- s_affiliation_ledger keeps the latest decision for every affiliation lineage,
-- even after the affiliation row is deleted (it has no foreign keys). A restore
-- re-links an affiliation only while this ledger still records exactly what the
-- archive says, so a later withdrawal, decline or revocation can never be
-- undone by an older backup.
ALTER TABLE s_creator_facility_affiliations ADD COLUMN origin_id TEXT;
CREATE INDEX IF NOT EXISTS s_affiliation_origin ON s_creator_facility_affiliations(origin_id);

CREATE TABLE IF NOT EXISTS s_affiliation_ledger(
  origin_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  location_id TEXT,
  status TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

INSERT OR REPLACE INTO s_affiliation_ledger(origin_id, creator_id, org_id, location_id, status, changed_at)
  SELECT COALESCE(origin_id, id), creator_id, org_id, location_id, status, COALESCE(decided_at, requested_at)
  FROM s_creator_facility_affiliations;

CREATE TRIGGER IF NOT EXISTS s_affiliation_ledger_insert AFTER INSERT ON s_creator_facility_affiliations
BEGIN
  INSERT INTO s_affiliation_ledger(origin_id, creator_id, org_id, location_id, status, changed_at)
  VALUES (COALESCE(NEW.origin_id, NEW.id), NEW.creator_id, NEW.org_id, NEW.location_id, NEW.status,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(origin_id) DO UPDATE SET creator_id=excluded.creator_id, org_id=excluded.org_id,
    location_id=excluded.location_id, status=excluded.status, changed_at=excluded.changed_at;
END;

CREATE TRIGGER IF NOT EXISTS s_affiliation_ledger_update
AFTER UPDATE OF status, creator_id, org_id, location_id, origin_id ON s_creator_facility_affiliations
BEGIN
  INSERT INTO s_affiliation_ledger(origin_id, creator_id, org_id, location_id, status, changed_at)
  VALUES (COALESCE(NEW.origin_id, NEW.id), NEW.creator_id, NEW.org_id, NEW.location_id, NEW.status,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT(origin_id) DO UPDATE SET creator_id=excluded.creator_id, org_id=excluded.org_id,
    location_id=excluded.location_id, status=excluded.status, changed_at=excluded.changed_at;
END;
