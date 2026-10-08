# SEDENS facility CRM adapter

SEDENS does not depend on any CRM vendor. A facility's membership, booking and payment system is reached through one interface, `CRMProvider` in `pilates/sedens/crm.py`. BROJ, or any other Korean fitness CRM, can become one adapter later; nothing in SEDENS is written for a particular vendor.

```
Facility CRM ──(adapter)──> EntryDecision ──> SEDENS maps member → student ──> room session
 membership, booking,        allowed? why?       s_crm_member_links (same org)     rooms.enter()
 access credential           who? which room?
```

## What exists in Phase 1

| Provider | Status | Use |
|---|---|---|
| `none` | REAL | Default for every facility. No CRM connection: a customer enters with a single-use room code requested on their own signed-in phone, and only at a location the facility assigned them to (`p_student_locations`, re-checked on every room request). No booking is required. |
| `demo` | SIMULATED | Demonstration organizations only (refused for real facilities by `save_settings`, and ignored by `verify_entry` if written directly). Fixtures cover an active member with a booking, an active member without a booking, an inactive membership, and a booking for another room. Access codes are stored as SHA-256 hashes. Every decision is marked `simulated`. |
| BROJ and others | FUTURE | Not built. No paid integration and no vendor credentials in this repository. |

## The contract

```python
@dataclass
class EntryRequest:
    org_id: str          # the facility that owns the paired room screen
    location_id: str
    room_id: str
    method: str          # "access_code" | "qr" | "reservation" | "member_id"
    credential: str = "" # CRM access code, reservation code or member number (never stored)
    pin: str = ""
    member_ref: str | None = None   # filled by SEDENS for access_code, from s_crm_member_links
    student_id: str | None = None   # filled by SEDENS for access_code
    at: datetime                    # the moment of the check (UTC)

class CRMProvider:
    name: str            # stored in s_crm_settings.provider
    simulated: bool      # True only for demonstration providers
    demo_only: bool      # True: refused for real facilities
    methods: tuple       # entry methods this provider supports
    def verify_entry(self, sedens, db, request, config) -> EntryDecision: ...
```

For `access_code`, SEDENS has already authenticated the customer with a single-use room code they requested on their own device; the credential is not passed to the adapter, and the adapter decides only membership and booking for that known customer.

`EntryDecision` must state:

| Field | Meaning |
|---|---|
| `allowed` | whether this person may enter this room now |
| `reason` | a stable code: `allowed`, `facility_membership`, `unknown_member`, `invalid_credential`, `membership_inactive`, `no_booking`, `booking_other_room`, `not_assigned_to_location`, `method_not_supported`, `provider_disabled` (adapters may add codes; the room screen shows a calm message for each) |
| `authenticated` | **True only if the credential proves who is entering** (a signed, single-use QR token; a reservation access code; member number + PIN). A member number alone identifies but does not authenticate; SEDENS refuses entry unless this is true. |
| `membership` | `active`, `inactive` or `unknown` |
| `booking` | `exists`, `reference`, optional `reservation_id`, `room_id`, `location_id`, `starts_at`, `ends_at` (UTC ISO 8601), `source` |
| `facility_id`, `location_id`, `room_id` | what the CRM authorized; SEDENS refuses entry if any differs from the paired screen |
| `member_ref` | the CRM's own member reference, used only to look up `s_crm_member_links` |
| `simulated` | True for demonstration providers |

SEDENS, not the adapter, then: checks the decision allows entry and is authenticating; checks facility/location/room against the paired device; maps `member_ref` to a platform student through `s_crm_member_links` **in the same organization**; checks the student is active with the `student` role; refuses if a staff or different account is signed in on the screen; ends older sessions on that screen or for that customer; issues the room session, never longer than the booking's end + 30 minutes.

`EntryDecision.public()` is what the room screen receives. It never includes the credential or the member reference.

## Rules for a real adapter

1. **No secrets in SEDENS settings.** `s_crm_settings.config` holds non-secret policy only (`require_booking`, `booking_grace_minutes`, provider options). `save_settings` refuses any key that looks like a secret (`secret`, `password`, `api_key`, `token`, `private`, `bearer`, `cookie`). Credentials belong in the deployment's secret store, referenced by name.
2. **Read-only by default.** Phase 1 only asks "may this person enter now". Writing attendance back to the CRM is a separate, explicit future capability.
3. **Time in UTC**, ISO 8601 with offset. Facilities set a booking grace period (0–120 minutes, default 15).
4. **Timeouts and failures deny.** A provider that cannot answer must return `allowed=False` with a reason, never an exception that could be mistaken for success.
5. **No personal data in decisions** beyond `member_ref`. Names, phone numbers and payment details stay in the CRM.
6. **Member links are explicit.** A facility links a CRM member to a SEDENS student once (`s_crm_member_links`); SEDENS never guesses a person by name or email.
7. **Tests:** each adapter ships contract tests for every reason code, the `authenticated` rule, and wrong-room/location/facility decisions (see `tests/test_sedens_crm.py`).

## Future capabilities (designed, not built)

| Capability | Notes |
|---|---|
| Member verification | as above |
| Booking / room reservation | adapter returns the booking; SEDENS never creates CRM bookings in V1 |
| Payment / membership status | membership only; course payments use the separate payment-provider abstraction (Phase 2) |
| Access tokens (QR) | signed, short-lived, single-use tokens issued by the CRM; SEDENS verifies, never issues |
| Refund / cancellation | CRM-side; SEDENS reflects the booking state it is given |
| Attendance write-back | explicit opt-in per facility; records only "attended", no health or scan data |

## Facility settings (Phase 1)

`GET /sedens/facility/crm` (facility admin) shows the provider, whether it is simulated, its entry methods, `require_booking` and the grace period. `POST /sedens/facility/crm` changes only `enabled`, `require_booking` and `booking_grace_minutes`; it never touches fixtures or credentials. Switching a real facility to a real provider is a deployment action, not a page setting, until a real adapter exists.
