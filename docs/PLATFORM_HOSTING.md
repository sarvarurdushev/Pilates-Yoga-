# Durable hosting for the connected studio

The existing service is `srv-daf50ov40ujc739kfh4g`, at
https://pilates-yoga-j1kz.onrender.com/. Keep that service and URL.

The checked-in free blueprint remains free. It writes the database and uploads to
`/tmp/studio.db` and `/tmp/studio.db.media`. Render removes these when an instance
is replaced or restarted. Generated demonstration histories can be recreated;
real captures and custom programs require durable storage.

## Prepared change for the existing service (requires billing authorization)

A practical configuration for the tested inference workload is one CPU / 2 GB
RAM ($25/month) plus a 2 GB persistent disk ($0.50/month), before applicable taxes
or usage overages. Prices checked September 23, 2026 on
https://render.com/pricing. A $7/month 512 MB service also supports disks, but the
measured 460.2 MB inference peak leaves little headroom for concurrent work.

1. Download an organization archive under Admin → Storage & backup before any
   redeployment. Repeat for every real organization. Do not assume `/tmp` survives.
2. Upgrade the existing service; attach a disk named `studio` at `/var/data`, 2 GB.
3. Change its start command to:
   `python -m pilates web --host 0.0.0.0 --db /var/data/studio.db`
4. Set `XDG_CACHE_HOME=/var/data/cache`. The repository automatically stores media
   alongside the database at `/var/data/studio.db.media`.
5. Deploy, register the intended studio administrator, and restore that
   organization's archive into the empty studio. Accounts require fresh sign-in
   credentials because backup files deliberately exclude password hashes and
   session tokens.
6. Verify a saved analysis, original media, note, program and reservation; redeploy
   once more and verify the same IDs/media survive. `storage.ephemeral` must be
   false. Only then mark hosted durability complete.

Render documents that only files under the disk mount persist:
https://render.com/docs/disks.

No paid resource has been provisioned by this change. An external database and
object store could also keep the Render web service free, but require an
explicitly chosen storage provider, account and credentials plus the relevant
repository adapters. Browser storage and manually downloaded backups are not
substitutes for server-side persistence.
