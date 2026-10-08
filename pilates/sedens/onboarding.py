"""Creating the organizations SEDENS adds beside ordinary facilities.

* A **creator studio** is a dedicated organization for an independent professor
  or expert who belongs to no gym. Its single administrator is the creator.
  A facility coach never needs one: they keep their facility account and gain
  a creator profile there.
* The **SEDENS organization** holds SEDENS reviewers and platform admins. It is
  created from the command line only.

Both reuse the platform's own account creation, inside one transaction.
"""

from __future__ import annotations

from . import capabilities, creators
from .util import Denied, text


def register_creator_studio(sedens, *, name, email, password, studio_name="", display_name="",
                            creator_type="professor") -> str:
    if creator_type not in ("professor", "expert"):
        raise Denied("Choose professor or expert.", 400, "invalid_type")
    display_name = text(display_name or name, 80, "Display name")
    studio_name = text(studio_name or f"{display_name} · SEDENS creator studio", 100, "Studio name")
    with sedens.batch():
        session_token = sedens.repo.create_org(name, email, password, studio_name)
        actor = sedens.repo.actor(session_token)
        with sedens.db() as db:
            sedens.set_org_profile(db, actor.org_id, "creator_studio", studio_name)
            capabilities.grant(sedens, db, None, actor.user_id, "creator", cli=True)
            creators.save_profile(sedens, db, actor, {"display_name": display_name, "creator_type": creator_type})
            sedens.audit(db, actor.org_id, actor.user_id, "creator-studio:create", actor.org_id)
    return session_token


def bootstrap_sedens_org(sedens, *, name, email, password, organization="SEDENS International") -> dict:
    """Command-line only: the SEDENS organization and its first platform admin.

    Reviewers are added afterwards as ``coach`` accounts of this organization and
    given ``sedens_reviewer`` by a SEDENS admin: a reviewer needs no
    administrator role, and an administrator can manage every account here."""
    with sedens.batch():
        session_token = sedens.repo.create_org(name, email, password, organization)
        actor = sedens.repo.actor(session_token)
        with sedens.db() as db:
            sedens.set_org_profile(db, actor.org_id, "sedens", organization, "en")
            capabilities.grant(sedens, db, None, actor.user_id, "sedens_admin", cli=True)
            sedens.repo.logout(session_token)
    return {"org_id": actor.org_id, "user_id": actor.user_id}
