# SEDENS deployment modes

The server always knows, and says, which mode it runs in. The mode is chosen once at start-up by `pilates/sedens/modes.py` and reported:

- on start-up: `SEDENS mode: <name> (<label>); persistent storage: <true|false>`;
- by `GET /sedens/config` (`mode.name`, `mode.label`, `mode.storage`, `mode.features`);
- on every SEDENS page: a mode badge, and a storage warning whenever storage is not persistent.

## Choosing the mode

| Setting | Effect |
|---|---|
| `SEDENS_MODE=demo_free` | Free demonstration |
| `SEDENS_MODE=local_room` | Room computer or developer machine |
| `SEDENS_MODE=cloud_production` | **Refuses to start** (not implemented) |
| any other value | Refuses to start with the list of valid modes |
| unset | `demo_free` when `RENDER=true`, otherwise `local_room` |
| `SEDENS_DEMO=0` | `local_room` only: switches demonstration workspaces and simulated room screens off (demonstration routes return 404). `demo_free` always keeps them. |
| `SEDENS_ROOM_SESSION_MINUTES` | Room session length, 15–240, default 120 |

The legacy `/capabilities`, `/evidence/capabilities` and `/platform/me` responses are unchanged.

## What each mode promises

| | `demo_free` | `local_room` | `cloud_production` |
|---|---|---|---|
| Intended host | Render free (0.1 CPU, 512 MB, no disk) | the facility's room computer, or a developer machine | future |
| Storage reported persistent | **never** | yes, unless the database is under `/tmp` or on Render without `/var/data` | — |
| Real server-side analysis | `limited` (works, slow: about 30 s per photo measured on Render free) | `available` | — |
| Precomputed demonstration analysis | allowed (Phase 3/7) | allowed for demonstration orgs | — |
| Local camera | browser only | yes | — |
| Demonstration workspaces, simulated room screens | always | on unless `SEDENS_DEMO=0` | — |
| Paid services | none | none | — |
| Status | REAL (Phase 1) | REAL (Phase 1) | not implemented; start-up refused |

"Real analysis" is available only when the server was started with analysis enabled (`python -m pilates web` without `--no-analyse` and with a database).

## demo_free

- Must not pretend storage is persistent: `storage.persistent` is always `false` with the reason "Free demonstration hosting: records and uploads can be erased on any restart or redeploy." The SEDENS home and room screens show this.
- Uses no paid API, storage, model service or analytics. Everything runs in the one Python process with SQLite and the local filesystem.
- May use precomputed demonstration analysis (to be added with the room scan in Phase 3/7), always labelled DEMO.
- The existing Render service (`srv-daf50ov40ujc739kfh4g`, branch `claude/multi-person-pilates-analysis-w28tt0`) is **not changed** by this branch. When the room journey is ready for external testing, a second free Render service will deploy this branch; switching the existing service is not planned.

## local_room

- Uses the existing real analysis pipeline (RTMO + optional MediaPipe) and local camera/media exactly as `python -m pilates web` does today.
- Real room screens pair through the facility console (`docs/SEDENS_SECURITY_MODEL.md`).
- For durable records, place the database on persistent disk (not `/tmp`). Back up with the existing organization archive; note that SEDENS tables are not yet included in it.

## cloud_production

Reserved. It needs durable database and object storage, managed secrets, production monitoring, a real CRM adapter, legal/privacy review and insurance, none of which is configured or paid for. Starting with `SEDENS_MODE=cloud_production` raises `ModeError` before anything is served.

## Running

```bash
# local room / development (default off Render)
.venv/bin/python -m pilates web --db "$PWD/.local/sedens.db" --host 127.0.0.1 --port 8000

# free demonstration behaviour on any machine
SEDENS_MODE=demo_free .venv/bin/python -m pilates web --db /tmp/sedens-demo.db

# a room computer that must never show demonstrations
SEDENS_MODE=local_room SEDENS_DEMO=0 .venv/bin/python -m pilates web --db /srv/sedens/sedens.db
```

Then open `/` (SEDENS home), `/room.html` (room screen) or `/workspace.html` (existing coaching workspace).
