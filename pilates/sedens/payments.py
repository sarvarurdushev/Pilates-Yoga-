"""Payments: simulated only. No money moves, and no card data exists anywhere.

``DemoPaymentProvider`` records a purchase in a demonstration organization and
grants the entitlement, labelled "DEMO — no real payment occurred." Outside a
demonstration there is no payment provider yet, so paid courses cannot be
bought. Future adapters (a facility's CRM, Toss Payments, app stores) will
implement :class:`PaymentProvider`; none is integrated.
"""

from __future__ import annotations

from . import access, courses
from .util import Denied, now, uid

NOTICE = {"en": "DEMO — no real payment occurred.", "ko": "데모 — 실제 결제는 이루어지지 않았습니다."}
FUTURE_PROVIDERS = ("facility_crm", "toss_payments", "app_store")


class PaymentProvider:
    name = ""
    real_money = False

    def purchase(self, sedens, db, actor, course):
        raise NotImplementedError


class DemoPaymentProvider(PaymentProvider):
    name = "demo"
    real_money = False

    def purchase(self, sedens, db, actor, course):
        org = sedens.org(db, actor.org_id)
        if not org["demo"]:
            raise Denied("Purchases are not available yet. SEDENS only simulates them in demonstrations.",
                         503, "payments_unavailable")
        if not access.can_view_metadata(sedens, db, actor, course) or not access.published(course):
            raise Denied("This course does not exist.", 404, "unknown_course")
        if course["course_type"] == "guided_training" and actor.role != "student":
            raise Denied("Guided training is bought by customers.", 403, "customers_only")
        if not access.on_sale(db, course["id"]):
            raise Denied("This course is not for sale.", 409, "not_for_sale")
        held = access.entitlements(sedens, db, actor.user_id, course)
        if held:
            raise Denied("You already have this course.", 409, "already_entitled")
        price = courses.price(db, course["id"])
        stamp, purchase_id, entitlement_id = now(), uid(), uid()
        db.execute("INSERT INTO s_purchases(id,user_id,org_id,course_id,provider,amount_minor,currency,state,created_at) "
                   "VALUES (?,?,?,?,?,?,?,?,?)", (purchase_id, actor.user_id, actor.org_id, course["id"], self.name,
                                                  price["amount_minor"], price["currency"], "demo_completed", stamp))
        db.execute("INSERT INTO s_entitlements(id,user_id,org_id,course_id,source,purchase_id,granted_at) VALUES (?,?,?,?,?,?,?) "
                   "ON CONFLICT(user_id,course_id,source) DO UPDATE SET purchase_id=excluded.purchase_id, "
                   "granted_at=excluded.granted_at, revoked_at=NULL",
                   (entitlement_id, actor.user_id, actor.org_id, course["id"], "demo_purchase", purchase_id, stamp))
        sedens.audit(db, actor.org_id, actor.user_id, "course:demo-purchase", course["id"],
                     {"purchase_id": purchase_id, "amount_minor": price["amount_minor"], "currency": price["currency"]})
        return {"id": purchase_id, "provider": self.name, "demo": True, "real_money": False,
                "amount_minor": price["amount_minor"], "currency": price["currency"], "state": "demo_completed",
                "notice": NOTICE}


PROVIDER = DemoPaymentProvider()
