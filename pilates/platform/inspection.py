"""Read-only, tenant-filtered relationship explorer for organization administrators."""

from .repository import Refused

PUBLIC = {"p_schema", "p_regions", "p_landmarks"}
EXCLUDED = {"p_sessions"}


def schema(db):
    tables = {
        r[0]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'p_*'"
        )
    } - EXCLUDED
    return {
        t: {
            "columns": [r[1] for r in db.execute(f"PRAGMA table_info({t})")],
            "required": [r[1] for r in db.execute(f"PRAGMA table_info({t})") if r[3]],
            "primary_key": [
                r[1] for r in db.execute(f"PRAGMA table_info({t})") if r[5]
            ],
            "foreign_keys": [
                dict(r) for r in db.execute(f"PRAGMA foreign_key_list({t})")
            ],
        }
        for t in sorted(tables)
    }


def scope(table, meta, org, seen=()):
    if table == "p_organizations":
        return "id=?", [org]
    if table in PUBLIC:
        return "1=1", []
    if "org_id" in meta[table]["columns"]:
        return "org_id=?", [org]
    if table in seen:
        raise Refused("This relationship cannot be traversed.", 400)
    for fk in sorted(
        meta[table]["foreign_keys"],
        key=lambda fk: fk["from"] not in meta[table]["required"],
    ):
        parent = fk["table"]
        if parent in PUBLIC or parent not in meta:
            continue
        where, args = scope(parent, meta, org, (*seen, table))
        parent_key = fk["to"] or meta[parent]["primary_key"][0]
        return (
            f'"{fk["from"]}" IN (SELECT "{parent_key}" FROM "{parent}" WHERE {where})',
            args,
        )
    raise Refused("This table has no organization boundary.", 403)


def overview(repo, actor):
    if actor.role != "admin":
        raise Refused("Only administrators can inspect relationships.", 403)
    with repo.db() as db:
        meta = schema(db)
        for table, data in meta.items():
            where, args = scope(table, meta, actor.org_id)
            data["count"] = db.execute(
                f'SELECT count(*) FROM "{table}" WHERE {where}', args
            ).fetchone()[0]
            data["columns"] = [
                c for c in data["columns"] if c not in ("password_hash", "path")
            ]
    return meta


def records(repo, actor, table, offset=0):
    if actor.role != "admin":
        raise Refused("Only administrators can inspect relationships.", 403)
    with repo.db() as db:
        meta = schema(db)
        if table not in meta:
            raise Refused("Choose a listed table.", 404)
        where, args = scope(table, meta, actor.org_id)
        cols = [
            c
            for c in meta[table]["columns"]
            if c not in ("password_hash", "path", "result", "detail", "summary")
        ]
        total = db.execute(
            f'SELECT count(*) FROM "{table}" WHERE {where}', args
        ).fetchone()[0]
        rows = [
            dict(r)
            for r in db.execute(
                f"SELECT "
                + ",".join('"' + c + '"' for c in cols)
                + f' FROM "{table}" WHERE {where} LIMIT 50 OFFSET ?',
                [*args, max(0, int(offset))],
            )
        ]
    return {"columns": cols, "items": rows, "total": total, "offset": int(offset)}
