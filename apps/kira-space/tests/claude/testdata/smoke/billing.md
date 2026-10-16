# Billing platform

## billing-api

The billing-api service is owned by the Payments team and is the system of record for invoices. It listens on port 8080 in production and exposes the invoices and credit-notes endpoints to the internal gateway. Customer-facing apps never call it directly: all traffic goes through the gateway so that rate limits and audit logging apply in one place. The service stores its data in a PostgreSQL 15 database named billing, hosted on the shared payments cluster.

Deployments use blue-green releases. The previous version keeps running for thirty minutes after a release so that a rollback is a traffic switch, not a redeploy.

## Operations

It restarts every night at 02:00 UTC because of a known memory leak in the PDF renderer; the restart was chosen over a fix because the renderer is a vendored library the team does not maintain. The on-call rotation is managed in PagerDuty under the schedule named payments-primary, and pages go to the Payments team channel first.

Backups of the billing database run hourly and are kept for fourteen days. Restores are tested every quarter by the platform team, who own the backup tooling.
