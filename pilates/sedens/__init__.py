"""SEDENS AI Private Room: an additive layer over the connected platform.

Nothing here rewrites ``p_*`` platform rows. SEDENS keeps its own ``s_*``
tables, its own migration ledger and its own ``/sedens/`` HTTP namespace, and
reuses the platform's organizations, users, roles, rooms and reservations.
"""
