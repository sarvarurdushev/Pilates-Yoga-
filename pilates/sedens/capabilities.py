"""SEDENS capabilities: explicit grants, separate from the platform role enum.

The platform roles (``admin``, ``coach``, ``student``) still decide who may see
which customer records. A capability adds a SEDENS power on top of a role and
never widens customer-data access:

``creator``          author SEDENS content. Requires an active ``coach`` or
                     ``admin`` role. Granted by the user's own facility
                     administrator, by a SEDENS platform admin, or on signing up
                     a dedicated creator organization.
``sedens_reviewer``  review creators and content. Only users of the SEDENS
                     organization (``kind='sedens'``) can hold it, on a
                     ``coach`` account: a reviewer needs no administrator role,
                     and must not have one, because any administrator of an
                     organization can manage every account in it through the
                     coaching workspace.
``sedens_admin``     SEDENS platform administration. Same organization; granted
                     by the command line or by another SEDENS admin. Every
                     ``admin`` account of the SEDENS organization is therefore
                     trusted like a SEDENS admin.

A capability is effective only while the grant is unrevoked, the user is
active, the user's organization kind allows it and the *current session role*
is one the capability requires. A self-declared creator type ("professor") on a
profile confers nothing.
"""

from __future__ import annotations

from .util import Denied, environment, now

CAPABILITIES = ("creator", "sedens_reviewer", "sedens_admin")
SEDENS_ONLY = ("sedens_reviewer", "sedens_admin")
# Session roles under which a capability may be exercised.
ACTING_ROLES = {
    "creator": ("coach", "admin"),
    "sedens_reviewer": ("coach",),
    "sedens_admin": ("admin",),
}
# Roles the target account must hold to receive a grant at all.
HOLDER_ROLES = {
    "creator": ("coach", "admin"),
    "sedens_reviewer": ("coach",),
    "sedens_admin": ("admin",),
}
# Organizations whose own administrator may grant and revoke ``creator``.
CREATOR_GRANTING_KINDS = ("facility", "creator_studio")
ROLE_MESSAGES = {
    "creator": "This permission needs a coach or administrator account.",
    "sedens_reviewer": "The SEDENS reviewer permission needs a coach account of the SEDENS organization.",
    "sedens_admin": "The SEDENS admin permission needs an administrator account of the SEDENS organization.",
}


def held(sedens, db, user_id) -> set[str]:
    """Unrevoked grants that the user's account and organization still allow."""
    user = sedens.user(db, user_id)
    if user is None or not user["active"]:
        return set()
    org = sedens.org(db, user["org_id"])
    found = set()
    for (capability,) in db.execute(
        "SELECT capability FROM s_capabilities WHERE user_id=? AND revoked_at IS NULL",
        (user_id,),
    ):
        if capability in SEDENS_ONLY and org["kind"] != "sedens":
            continue
        if not set(HOLDER_ROLES[capability]) & set(user["roles"]):
            continue
        found.add(capability)
    return found


def effective(sedens, db, actor) -> set[str]:
    """Capabilities usable in this session (the session role matters)."""
    return {
        c for c in held(sedens, db, actor.user_id) if actor.role in ACTING_ROLES[c]
    }


def has(sedens, db, actor, capability) -> bool:
    return capability in effective(sedens, db, actor)


def require(sedens, db, actor, capability):
    if not has(sedens, db, actor, capability):
        raise Denied(
            {
                "creator": "Creator tools need a creator permission on a coach or administrator account.",
                "sedens_reviewer": "This action needs a SEDENS reviewer permission, used from a coach sign-in.",
                "sedens_admin": "This action needs a SEDENS platform administrator permission.",
            }[capability],
            403,
            "capability_required",
        )


def _same_org_admin(granter, granter_org, target) -> bool:
    """A facility or creator studio administrator acting on their own account holders.
    The SEDENS organization's creator grants go through a SEDENS admin."""
    return (
        granter.role == "admin"
        and granter.org_id == target["org_id"]
        and granter_org["kind"] in CREATOR_GRANTING_KINDS
    )


def grant(sedens, db, granter, user_id, capability, *, cli=False):
    """Grant a capability. ``granter`` is an Actor, or None with ``cli=True``."""
    if capability not in CAPABILITIES:
        raise Denied("Choose a known SEDENS permission.", 400, "unknown_capability")
    target = sedens.user(db, user_id)
    if target is None or not target["active"]:
        raise Denied("Choose an active account.", 404, "unknown_user")
    target_org = sedens.org(db, target["org_id"])
    if not set(HOLDER_ROLES[capability]) & set(target["roles"]):
        raise Denied(ROLE_MESSAGES[capability], 400, "role_not_eligible")
    if capability in SEDENS_ONLY and target_org["kind"] != "sedens":
        raise Denied(
            "SEDENS reviewer and admin permissions are only for the SEDENS organization.",
            400,
            "org_not_eligible",
        )
    if not cli:
        if granter is None:
            raise Denied("Sign in to grant permissions.", 401, "sign_in")
        granter_org = sedens.org(db, granter.org_id)
        # Demonstration and real organizations never grant into each other.
        if environment(granter_org) != environment(target_org):
            raise Denied("Choose an account in the same environment.", 403, "environment_mismatch")
        is_platform_admin = has(sedens, db, granter, "sedens_admin")
        if capability == "creator":
            if not (_same_org_admin(granter, granter_org, target) or is_platform_admin):
                raise Denied(
                    "Only this organization's administrator or a SEDENS admin can grant creator tools.",
                    403,
                    "not_permitted",
                )
        elif not is_platform_admin:
            raise Denied("Only a SEDENS admin can grant SEDENS permissions.", 403, "not_permitted")
    stamp = now()
    granted_by = None if cli else granter.user_id
    db.execute(
        "INSERT INTO s_capabilities(user_id,capability,granted_by,granted_at) VALUES (?,?,?,?) "
        "ON CONFLICT(user_id,capability) DO UPDATE SET granted_by=excluded.granted_by, "
        "granted_at=excluded.granted_at, revoked_by=NULL, revoked_at=NULL",
        (user_id, capability, granted_by, stamp),
    )
    sedens.audit(db, target["org_id"], granted_by, "capability:grant", user_id, {"capability": capability, "cli": cli})
    return sorted(held(sedens, db, user_id))


def revoke(sedens, db, granter, user_id, capability, *, cli=False):
    if capability not in CAPABILITIES:
        raise Denied("Choose a known SEDENS permission.", 400, "unknown_capability")
    target = sedens.user(db, user_id)
    if target is None:
        raise Denied("Choose an existing account.", 404, "unknown_user")
    if not cli:
        if granter is None:
            raise Denied("Sign in to change permissions.", 401, "sign_in")
        granter_org = sedens.org(db, granter.org_id)
        target_org = sedens.org(db, target["org_id"])
        if environment(granter_org) != environment(target_org):
            raise Denied("Choose an account in the same environment.", 403, "environment_mismatch")
        is_platform_admin = has(sedens, db, granter, "sedens_admin")
        same_org_admin = _same_org_admin(granter, granter_org, target)
        allowed = is_platform_admin or (capability == "creator" and same_org_admin)
        if not allowed:
            raise Denied("You cannot change this permission.", 403, "not_permitted")
        if capability == "sedens_admin" and user_id == granter.user_id:
            raise Denied("Ask another SEDENS admin to remove your own admin permission.", 400, "self_revoke")
    db.execute(
        "UPDATE s_capabilities SET revoked_by=?, revoked_at=? WHERE user_id=? AND capability=? AND revoked_at IS NULL",
        (None if cli else granter.user_id, now(), user_id, capability),
    )
    sedens.audit(db, target["org_id"], None if cli else granter.user_id, "capability:revoke", user_id, {"capability": capability, "cli": cli})
    return sorted(held(sedens, db, user_id))
