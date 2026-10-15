# Project notes

## Stack & commands

- React + MUI client (`client/`), Fastify + Drizzle + Postgres server (`server/`).
- Full stack runs via `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`.
- Migrations: edit `server/src/db/schema.ts`, then `npm run db:generate`
  (or `./node_modules/.bin/drizzle-kit generate --name <name>` on Windows MSYS,
  where `npm run` may fail). Applied at container start via `node dist/db/migrate.js`.
- Typecheck: `./node_modules/.bin/tsc --noEmit` (server), `./node_modules/.bin/tsc -b` (client).
- Lint: `./node_modules/.bin/oxlint` (client).

## Coordinator check-in / scratch flow (added 2026-10-15)

- `division_registrations.checked_in_at` (timestamptz, nullable) records check-in.
  Migration: `server/drizzle/0006_check-in.sql`.
- `GET /api/events/:eventId/divisions/:divisionId/registrations` now returns `checkedInAt`.
- `PUT /api/events/:eventId/divisions/:divisionId/check-in` — body `{ competitorIds }`
  replaces the checked-in set (sets `checked_in_at = now()` for listed, clears the rest).
  Requires event-manager access (admin or assigned coordinator). Allowed even after
  scoring has started.
- `DELETE /api/events/:eventId/divisions/:divisionId/registrations/:competitorId` —
  "scratch": deletes the registration, any `division_pairs` rows involving the
  competitor, and that competitor's `scores` rows in the division. Intentionally
  NOT blocked after scoring starts, since scratching a no-show can happen
  mid-competition. The competitor remains in the event and in other divisions.
- Client: `client/src/pages/CheckInPage.tsx` at
  `/events/:eventId/divisions/:divisionId/check-in`, linked by a "Check-in"
  button in each division accordion on `DivisionsPage`. Per-competitor checkbox
  saves the full checked-in list on each toggle; "Scratch" per row and a bulk
  "Scratch unchecked" button, both with confirm dialogs.

## Competitor front-desk check-in (added 2026-10-15)

- `competitors.checked_in_at` (timestamptz, nullable) — event-level check-in,
  distinct from the per-division `division_registrations.checked_in_at`.
  Migration: `server/drizzle/0007_competitor-check-in.sql`.
- `GET /api/events/:eventId/competitors` now returns each competitor's
  `divisions` array (`{id, name, type, role}`) plus `checkedInAt`.
- `PUT /api/events/:eventId/competitors/:id/check-in` — body `{ bibNumber }`
  (positive int). Sets bib + `checked_in_at = now()`; 409 if the bib is taken
  by another competitor in the event. Event-manager access (admin/coordinator).
- `DELETE /api/events/:eventId/competitors/:id/check-in` — clears `checked_in_at`
  (bib is kept).
- Client: `client/src/pages/CompetitorCheckInPage.tsx` at
  `/events/:eventId/competitors/check-in`, linked from `CompetitorsPage`.
  Search by name/bib; row click opens a dialog listing divisions and a bib
  field; save checks in, "Undo check-in" clears it.

## Assumptions made

- Bib numbers are still auto-assigned provisionally at registration (avoids
  making `bib_number` nullable, which scoring/judging depend on); they can be
  reassigned at front-desk check-in.
- Check-in is separate from division scratch: scratching a competitor removes
  them from that division only.
- Competitor check-in and bib reassignment are allowed at any time (no
  scoring-started lockout), matching the optional check-in flow.

- Scratch is per-division (removes from that division only), matching "remove
  competitors from certain divisions if they are not present for them."
- Scratching a Strictly competitor also removes their pair, leaving their
  partner unpaired (partner must be re-paired or scratched separately).
- Judges' score sheets are driven by current registrations, so scratched
  competitors simply disappear; their score rows are deleted to keep
  preliminary results clean.
- Re-saving registrations via the existing PUT endpoint re-creates
  registration rows, which naturally resets check-in state.
