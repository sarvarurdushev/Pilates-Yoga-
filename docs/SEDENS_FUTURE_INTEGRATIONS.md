# SEDENS future integrations

Scope: every external system SEDENS is designed to connect to later, the interface that exists in the code today, what is real, simulated or absent, and what a real integration must satisfy before it is switched on. **None of these integrations is built, paid for or configured.** The app and every test run without credentials (`docs/SEDENS_FREE_DEPLOYMENT.md` §2).

| Integration | Interface today | Status |
|---|---|---|
| Facility CRM (membership, booking, room entry) | `CRMProvider` in `pilates/sedens/crm.py` | `none` (real, no CRM), `demo` (simulated, demonstrations only); BROJ and others not built |
| Payments (course purchases) | `PaymentProvider` in `pilates/sedens/payments.py` | `DemoPaymentProvider` only, demonstrations only; facility CRM billing, Toss Payments and app stores not built |
| Generated exercise video | `HiggsfieldVideoProvider` in `pilates/sedens/video_providers.py` | inactive; refuses every request; no key read |
| Stock footage | `LicensedStockVideoProvider` and the import manifest in `data/content_sources.json` | manifest empty; no import code; nothing downloads automatically |
| Durable file storage | `pilates/sedens/media_store.py` (local folder beside the database) | local disk only |
| Home (B2C) playback of guided training | `access.HOME_PLAYBACK = False` | designed for and off |
| Expert review of content | review statuses in `data/sedens_standard/exercises.v0.json` | every entry `unreviewed`; no expert attributed |
| Production hosting | `SEDENS_MODE=cloud_production` | refuses to start |

## 1. Facility CRM

Described in full in `docs/SEDENS_CRM_ADAPTER.md`: the `EntryRequest` → `EntryDecision` contract, member linking within one facility, what is never stored (credentials, PINs), and the rule that no vendor-specific code lives outside an adapter. A BROJ (or other Korean CRM) adapter implements `CRMProvider.verify_entry`; it needs the vendor's API agreement and credentials kept in the deployment's secret store, never in the repository or in `s_crm_settings` (`crm._check_no_secrets` refuses secret-looking settings).

A facility CRM may later also bill members for courses; that is a payment provider (section 2), not part of entry.

## 2. Payments

```python
class PaymentProvider:
    name = ""
    real_money = False
    def purchase(self, sedens, db, actor, course): ...   # receipt dict, or Denied
```

Today `PROVIDER = DemoPaymentProvider()`: it works only in demonstration organizations, writes a `demo_completed` purchase and a `demo_purchase` entitlement, and returns "DEMO — no real payment occurred." Everywhere else purchases answer 503 `payments_unavailable`. The named future providers are `facility_crm`, `toss_payments` and `app_store` (`payments.FUTURE_PROVIDERS`).

A real provider needs, at least:

| Requirement | Why |
|---|---|
| A migration widening `s_purchases.provider` (today `CHECK(provider IN ('demo'))`), its `state` (today `demo_completed`, `demo_refunded`) and `s_entitlements.source` (no real purchase source exists) | the schema refuses anything but simulated purchases, on purpose |
| A hosted checkout or in-app purchase sheet run by the provider | SEDENS must never collect, see or store card details |
| Confirmation by the provider's signed server-to-server notification, checked and idempotent, before any entitlement is granted | a browser redirect is not proof of payment |
| The amount and currency from `access.in_force(course)["price"]` (the approved price) | a draft price never reaches a customer |
| Refunds and cancellations that end the entitlement (`access.entitlements` already honours only completed purchases) | access must follow the money |
| Receipts, tax and settlement to the creator, and the terms between SEDENS, creators and facilities | business and legal decisions, not code |
| `real_money = True` only on that provider, and the DEMO notice kept for the demo provider | the UI must never present a simulation as a payment |

App-store purchases apply to native apps only; the web app would use Toss Payments or the facility's CRM.

## 3. Generated exercise video (Higgsfield)

`HiggsfieldVideoProvider` exists so the shape of the integration is fixed early:

- `enabled = False`; the registry's `higgsfield` source is `enabled: false`; `video_providers.problems()` reports it if switched on.
- It reads no API key or setting, so nothing is needed to run the app or the tests. `generate()` refuses with 503 `provider_disabled`. Nothing calls Higgsfield, and no generated output is stored or faked.
- The workflow it records (`GENERATION_WORKFLOW`): approved reference movement → generation → comparison (automatic and by a person) → expert review → publish.

Before it could be switched on:

1. A **movement-review state** for media, which does not exist yet (`docs/SEDENS_MEDIA_RIGHTS.md` §14). Rights approval is about permission to distribute; it is not a review of the movement.
2. Generated files enter as ordinary course files with source, provenance (prompt, reference movement, model version), the generated-media label and rights `unreviewed`; every provider has `starts_reviewed = False`.
3. Approval stays a person's decision twice over: a reviewer accepts the file's rights (`decide_media`), and a course version that uses it is approved only after that (`rights_not_reviewed`). Generated video never becomes approved content automatically.
4. The key lives in the host's secret store; the provider is enabled by configuration, never by a code default.
5. A budget and an owner decision: generation is a paid service.

## 4. Stock footage

The registry allows Pexels and Pixabay clips as references only, with `auto_download: false`. A clip may enter the import manifest only after a person watched it, checked the movement and the licence page, and recorded who, when, the checksum and the licence (`video_providers.problems()` enforces the fields). The manifest is empty, and no code turns manifest entries into course files yet. Until then a creator uploads a stock clip themselves with licence `pexels` or `pixabay` (both links required), and it carries "Demo media — movement not yet expert reviewed".

## 5. Durable file storage

Course files live in `<database>.sedens-media/` on local disk (`media_store`): `receive` and `adopt` check and store, `object_path` resolves a key inside the store, `stream_file` serves with ranges and safe headers. An object-storage adapter would replace those four functions behind the same names. It must keep files private (no public bucket URLs; files are served only after `access.media_access`), keep the byte checks on upload, and keep backups and exports able to read every file.

## 6. Home playback of guided training

`access.HOME_PLAYBACK = False`. It only changes the reason reported when there is no room (`room_only`); every route that returns guided steps or their files still requires an authorized room (`rooms.authorize`). Building home playback means:

- a new rule in `can_play_in_room` (or a sibling `can_play_at_home`) and an entitlement source for home use;
- creators' and facilities' agreement: today a facility's inclusion or free offer is for its rooms;
- the same file protection as the room: steps and files served only to an entitled, signed-in customer, never as public links;
- safety wording for training without a facility nearby.

## 7. Expert review of content

SEDENS Standard entries carry a review record (`unreviewed`, `sedens_reviewed`, `expert_reviewed`). Every v0 entry is `unreviewed`. A higher status is accepted only with the reviewer, date, evidence and scope that prove it (`standard.problems()`), and no expert review may be attributed to any named person without explicit evidence for that exact material. Course approval by SEDENS is not expert review of movement and is never shown as such (`docs/SEDENS_CONTENT_GOVERNANCE.md` §3).

## 8. Production hosting

`SEDENS_MODE=cloud_production` refuses to start. It needs durable database and object storage, managed secrets, monitoring, a real CRM adapter, a real payment provider, and legal, privacy and insurance review (`docs/SEDENS_DEPLOYMENT_MODES.md`).
