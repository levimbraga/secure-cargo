# The manager dashboard and the certificate

What a manager at an insurer or a carrier (`org_admin`) sees, how each number is counted, and how a
load certificate is issued and verified. Goal: see in 30 seconds where the risk is in the fleet.
SecureCargo is a decision-support tool, not an engineering certification.

## Pages (desktop-first, usable on a phone; English and pt-BR)

| Page | What it shows |
|---|---|
| `/app/org` | Numbers for the period (7, 30 or 90 days), the weekly trend, the most common failures, one row per driver |
| `/app/org/alerts` | Loads that failed or are out of compliance and have no proven fix after the organization's N hours |
| `/app/org/inspections` | Every inspection: filters (dates, driver, result, truck, cargo, failure type), search, pages of 25, CSV export; filters live in the URL |
| `/app/org/team` | Members, invitations by email, the organization's policies |
| `/app/inspection?id=` | One inspection: photos, the 7 situations, the checklist, the fix, the re-inspection before/after, the certificate and the audit trail |
| `/app/certificate?id=SC-…` | The certificate, with its QR code and a PDF made in the browser |
| `/verify/<id>` | Public: whether a certificate is authentic, and a minimal summary |

The menu shows the open alerts next to "Organization". A signed-in user without an organization sees
"Create your organization" on `/app/org`.

## How we count (`backend/worker/src/metrics.ts`, tested in `test/manager.test.ts`)

- A load counts once, **as first loaded**. A re-inspection ("I fixed it: take a new photo") is the
  proof of the first one's fix, not a new inspection; it is counted apart ("re-inspections").
- States: approved (`pass`), holds but out of compliance (`warning`), does not arrive intact (`fail`),
  the same three everywhere (`docs/inspection.md`).
- **Needs a fix** = out of compliance or does not arrive intact.
- **Fixed and proven** = needs a fix, and a re-inspection of it was approved. The rate is over the
  loads that needed a fix.
- **Failed, no proven fix** = needs a fix, no approved re-inspection yet. A fix that was only
  simulated by the planner is shown ("Fix simulated, no new photo yet") but does not close it.
- **Alert** = failed, no proven fix, a first inspection, older than N hours (`alert_after_hours`,
  24 by default). Alerts are not bound to the period: an old open failure is the most urgent one.
- **Most common failures**: for each failure type, the share of the loads that needed a fix that
  have it. Physical types (slides, hits the cab, tips, rolls, falls off, strap overloaded) and rule
  types (the six CONTRAN 945 checks, axle, payload, gross weight, height, width, rear overhang).
- **Per driver**: inspections, failure rate (needs a fix over simulated), fixes proven, open.
- **Weekly trend**: first inspections per week (Monday to Sunday, Brasília time), by state.

Failure types and cargo types are kept on each inspection (`failure_codes`, `cargo_types`, written
when the load is confirmed and simulated) so that filters are plain SQL; older rows get theirs from
their stored battery (hourly cron and the overview).

## Authorization

Same rules as everywhere (`src/authz.ts`): the overview, alerts, policies and the org table are for
the organization's managers; a member gets 403; another organization's inspection, audit trail or
certificate answers 404. Filters only narrow the authorization clause, never replace it. Demo
accounts read everything of the demo organization but change no policy, create no organization and
send no invitation.

## Organization policies (`PATCH /org/policies`)

| Policy | Default | Effect (enforced by the Worker) |
|---|---|---|
| Require 2 photos | off | `analyze` and `PUT /draft` refuse an inspection with fewer than 2 photos (`policy_two_photos`); the sample photos are exempt. The capture step asks for both. |
| No certificate when out of compliance | on | Off: a load that holds but breaks a rule gets a certificate that says "Holds, but out of compliance". |
| Alert after N hours | 24 | 1 to 720 hours. |

## Audit trail (`inspection_events`, `GET /inspections/:id/audit`)

Every step is an event with who and when: created, photo added or removed, read by the AI, weight
read from the invoice, load confirmed, simulated, fix simulated, re-inspected, shared, certificate
issued. The page also shows **the AI's reading beside the load the driver confirmed** (truck, body,
units, cargo, lashings, securing; the weight is never read from a photo) and **the driver's edits**:
the site sends the load the AI read (`prefill`) with the confirmed one, and the Worker stores the
difference (units added, removed, moved more than 5 cm, cargo, lashings, stacking, truck). A later
correction records its changes to the previous load.

## Certificate (`src/certificate.ts`)

- **Who gets one:** an inspection that is approved, or fixed and proven. A load that does not arrive
  intact never does; out of compliance only when the policy allows it. The author or the
  organization's managers issue it; whoever may read the inspection reads it.
- **What it records:** the id (`SC-XXXX-XXXX`, 31^8 random ids without ambiguous characters), the
  issue date, the state, the inspection (and the re-inspection that proved the fix), the
  organization, the truck, the cargo (types, units, weight and where it came from), the photo's
  SHA-256, the 7 situations, every legal check with its article, the axle loads, the fix and the
  disclaimer. For "fixed and proven", the results and the photo are the re-inspection's.
- **Hash:** SHA-256 of the record as canonical JSON (keys sorted at every level). The record is
  stored as issued; the verify page recomputes the hash from it, so a record changed after issue
  shows "does not match its hash". Confirming a new load for the inspection revokes its certificate
  ("replaced"). Asking again for the same record returns the certificate already issued.
- **PDF:** made in the browser from the server's record (pdf-lib, A4): id, state, photo, QR to
  `https://securecargo.app/verify/<id>`, dates, organization, truck drawing, cargo, situations,
  checks, axle loads, hash and disclaimer, in the page's language.
- **Verify page:** public, rate-limited per IP. Shows only authenticity, the id, issue and inspection
  dates, the result, situations held, how many rules fail, the truck and the issuing organization:
  no driver name, no photo, no plate. `proxy.ts` serves `/verify/<id>` from the static `/verify` page.

## Organizations and invitations

`POST /orgs` (signed in, no organization, not a demo account) creates the organization in Clerk with
the caller as its admin, mirrors it in D1 and switches the session to it. Managers invite by email
(`POST /org/invitations`, Clerk sends the email; the invitee signs up and the site activates the
organization). Clerk's free plan: 100 monthly retained organizations, 20 members each.
