-- SEDENS 0021: customers choose their own password (Phase 4, docs/SEDENS_SECURITY_MODEL.md section 11).
--
-- A facility administrator creates a one-time sign-in link for a customer; the
-- customer opens it and chooses the password. Only the SHA-256 of the link's
-- secret is stored. A link is single use: used_at is set in the same
-- transaction that writes the password. Creating a newer link for the same
-- customer ends the older unused ones (superseded_at), so at most one link per
-- customer can be used. Links are live credentials and are never put in a backup.
CREATE TABLE IF NOT EXISTS s_account_links(
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('setup','reset')),
  issued_by TEXT REFERENCES p_users ON DELETE SET NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  superseded_at TEXT
);
CREATE INDEX IF NOT EXISTS s_account_links_user ON s_account_links(user_id, used_at, superseded_at);

-- What the customer sees under "Sign-in activity" in their Passport. Written by
-- the server only; actor_id is who did it (the customer, or the staff member who
-- created a link, whose change was refused, or who took the customer role away or
-- gave it to the account, which clears its password). purpose is set for link_issued.
CREATE TABLE IF NOT EXISTS s_account_events(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES p_users ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES p_organizations ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('link_issued','password_set_by_customer','staff_password_refused',
                                    'staff_email_refused','sessions_revoked',
                                    'customer_role_removed','customer_role_added')),
  purpose TEXT CHECK(purpose IN ('setup','reset')),
  actor_id TEXT REFERENCES p_users ON DELETE SET NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS s_account_events_user ON s_account_events(user_id, at);
