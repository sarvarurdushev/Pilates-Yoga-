-- SEDENS 0008: the affiliation ledger also records how an affiliation ended.
--
-- * creator_org_id: the creator's own organization when the decision was made,
--   so an ending can be recognized after the creator's account is gone.
-- * facility_no: 1 when the latest decision is the facility's "no" (a decline, or
--   a revocation by the facility rather than by the creator). Decided by this
--   server when the decision is made; a restore never changes it.
-- * status 'ended': the affiliation row was deleted while both organizations still
--   exist (a location removed, the creator's account removed). Only deleting a
--   whole organization leaves a lineage that an archive may re-link.
--
-- A restore inserts rows whose status equals the ledger's, so for an unchanged
-- status the ledger keeps its own facility_no and changed_at: an archive cannot
-- turn a facility's "no" into the creator's own withdrawal or restart its date.
ALTER TABLE s_affiliation_ledger ADD COLUMN creator_org_id TEXT;
ALTER TABLE s_affiliation_ledger ADD COLUMN facility_no INTEGER NOT NULL DEFAULT 0;

UPDATE s_affiliation_ledger SET
  creator_org_id = (SELECT u.org_id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id
                    WHERE c.id=s_affiliation_ledger.creator_id),
  facility_no = COALESCE((SELECT CASE WHEN a.status='declined' OR (a.status='revoked' AND a.decided_by IS NOT a.requested_by)
                                     THEN 1 ELSE 0 END
                          FROM s_creator_facility_affiliations a
                          WHERE COALESCE(a.origin_id, a.id)=s_affiliation_ledger.origin_id), 0);

DROP TRIGGER IF EXISTS s_affiliation_ledger_insert;
DROP TRIGGER IF EXISTS s_affiliation_ledger_update;

CREATE TRIGGER s_affiliation_ledger_insert AFTER INSERT ON s_creator_facility_affiliations
BEGIN
  INSERT INTO s_affiliation_ledger(origin_id, creator_id, org_id, location_id, status, changed_at, creator_org_id,
                                   facility_no)
  VALUES (COALESCE(NEW.origin_id, NEW.id), NEW.creator_id, NEW.org_id, NEW.location_id, NEW.status,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          (SELECT u.org_id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id WHERE c.id=NEW.creator_id),
          CASE WHEN NEW.status='declined' OR (NEW.status='revoked' AND NEW.decided_by IS NOT NEW.requested_by)
               THEN 1 ELSE 0 END)
  ON CONFLICT(origin_id) DO UPDATE SET creator_id=excluded.creator_id, org_id=excluded.org_id,
    location_id=excluded.location_id, creator_org_id=excluded.creator_org_id,
    facility_no=CASE WHEN s_affiliation_ledger.status=excluded.status THEN s_affiliation_ledger.facility_no
                     ELSE excluded.facility_no END,
    changed_at=CASE WHEN s_affiliation_ledger.status=excluded.status THEN s_affiliation_ledger.changed_at
                    ELSE excluded.changed_at END,
    status=excluded.status;
END;

CREATE TRIGGER s_affiliation_ledger_update
AFTER UPDATE OF status, creator_id, org_id, location_id, origin_id ON s_creator_facility_affiliations
BEGIN
  INSERT INTO s_affiliation_ledger(origin_id, creator_id, org_id, location_id, status, changed_at, creator_org_id,
                                   facility_no)
  VALUES (COALESCE(NEW.origin_id, NEW.id), NEW.creator_id, NEW.org_id, NEW.location_id, NEW.status,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          (SELECT u.org_id FROM s_creator_profiles c JOIN p_users u ON u.id=c.user_id WHERE c.id=NEW.creator_id),
          CASE WHEN NEW.status='declined' OR (NEW.status='revoked' AND NEW.decided_by IS NOT NEW.requested_by)
               THEN 1 ELSE 0 END)
  ON CONFLICT(origin_id) DO UPDATE SET creator_id=excluded.creator_id, org_id=excluded.org_id,
    location_id=excluded.location_id, creator_org_id=excluded.creator_org_id,
    facility_no=CASE WHEN s_affiliation_ledger.status=excluded.status THEN s_affiliation_ledger.facility_no
                     ELSE excluded.facility_no END,
    changed_at=CASE WHEN s_affiliation_ledger.status=excluded.status THEN s_affiliation_ledger.changed_at
                    ELSE excluded.changed_at END,
    status=excluded.status;
END;

-- A row deleted while both organizations still exist has ended. (During an
-- organization's own deletion the organization row is already gone, so the
-- lineage stays restorable from that organization's archive.)
CREATE TRIGGER s_affiliation_ledger_delete AFTER DELETE ON s_creator_facility_affiliations
WHEN EXISTS(SELECT 1 FROM p_organizations WHERE id=OLD.org_id)
 AND EXISTS(SELECT 1 FROM p_organizations WHERE id=(SELECT creator_org_id FROM s_affiliation_ledger
                                                     WHERE origin_id=COALESCE(OLD.origin_id, OLD.id)))
BEGIN
  UPDATE s_affiliation_ledger SET status='ended', facility_no=0, changed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE origin_id=COALESCE(OLD.origin_id, OLD.id);
END;
