# Project notes

## Conventions

- After finishing edits, always run `docker compose up --build -d` so changes
  are picked up in the local dev environment.
- Back navigation: any page that sits deeper than its section root renders a
  `Back to <parent>` `Button` above the page title (`sx={{ mb: 1 }}`),
  navigating to the explicit parent route — not `navigate(-1)`. Pages shared
  between manager and judge shells (e.g. `DivisionStatusPage`) pick the parent
  path from `user.role`. See `RoundsPage`/`DivisionStatusPage` for the pattern.
  When adding a page that drills further into a menu, add the same button.

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
- `GET /api/events/:eventId/divisions/:divisionId/registrations` now returns `checkedInAt`
  plus `frontDeskCheckedInAt` (the competitor's event-level check-in).
- `PUT /api/events/:eventId/divisions/:divisionId/check-in` — body `{ competitorIds }`
  replaces the checked-in set (sets `checked_in_at = now()` for listed, clears the rest).
  Requires event-manager access (admin or assigned coordinator). Allowed even after
  scoring has started. Returns 409 once line-up check-in is marked complete.
- `divisions.line_up_check_in_completed_at` (timestamptz, nullable) locks the
  line-up check-in page when set. Migration: `server/drizzle/0010_line-up-check-in.sql`.
  Toggled via `PATCH /api/events/:eventId/divisions/:id` with
  `{ name, type, lineUpCheckInComplete }`. Also blocks the scratch DELETE
  (reopen check-in to scratch a late no-show).
- `GET /api/events/:eventId/divisions` returns `lineUpCheckInCompletedAt` and a
  computed `judgingStatus` (`not_started`/`in_progress`/`completed`): for rounds
  divisions from `division_rounds.status`; for numeric divisions, completed when
  every assigned event judge has a locked `score_submissions` row.
- `round_impressions` (judge × round × competitor → `score` real 1–10) holds the
  per-entry slider value on `RoundScoringPage`, distinct from the official mark
  (vote/rank). Migration: `server/drizzle/0011_round-impressions.sql`. The judge
  sheet GET returns it as `impression` per entry; the scores PUT replaces the
  judge's set whenever the `impressions` key is present in the body (optional).
- `DELETE /api/events/:eventId/divisions/:divisionId/registrations/:competitorId` —
  "scratch": deletes the registration, any `division_pairs` rows involving the
  competitor, and that competitor's `scores` rows in the division. Intentionally
  NOT blocked after scoring starts, since scratching a no-show can happen
  mid-competition. The competitor remains in the event and in other divisions.
- Client: `client/src/pages/CheckInPage.tsx` at
  `/events/:eventId/divisions/:divisionId/check-in`, linked by a "Line up
  check-in" button in each division accordion on `DivisionsPage`. Titled "Line
  up check-in"; only competitors with completed front desk check-in
  (`frontDeskCheckedInAt`) are listed. Per-competitor checkbox
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

## Rounds / heats / callback & relative-placement scoring (added 2026-10-15)

- `divisions.scoring_mode`: `numeric` (legacy 1–10 flow) or `rounds`. Set at
  division creation on `DivisionsPage`; round management at
  `/events/:eventId/divisions/:divisionId/rounds` (`RoundsPage`).
- `division_rounds` (ordered by `position`, `type` = `callback` |
  `relative_placement`, `status` = `pending` | `active` | `complete`). Judges
  may only submit while a round is `active`. `heats` + `heat_entries` group
  entries per round; entries are competitor ids (Strictly uses the pair's lead
  id, matching the numeric flow). `relative_placement` rounds are restricted to
  a single heat.
- `round_submissions` mirrors `score_submissions` but keyed `(judge_id,
  round_id)` with the same editing/locked + revision optimistic-lock pattern.
  `callback_votes` stores yes/alternate/no; `placements` stores rank (must be a
  permutation 1..N over all entries — enforced server-side).
- Results: `GET /api/events/:e/divisions/:d/rounds/:r/results`. Callback
  tallies report yes/alt/no counts and `points` (yes=1, alt=0.5). RP results
  are computed by `server/src/relativePlacement.ts` (majority of cumulative
  ranks, tie-break by count then summed ranks then deeper columns; exact ties
  share a placement). Both exclude ballots that aren't locked.
- Advancement is coordinator-driven: `RoundsPage` results show sorted tallies
  with checkboxes, "Select top N", and "Advance to next round" which writes the
  next round's heats (round-robin across its heats; single heat for finals).
- J&J finals are judged as pairs: `heat_entries.follow_competitor_id`
  (nullable) stores the follow for a `relative_placement` entry. Entries are
  always keyed by the lead's competitor id/bib; the follow's bib is displayed
  alongside. `PUT .../heats` accepts `{ competitorIds: [...] }` or
  `{ entries: [{ competitorId, followCompetitorId }] }` per heat; for J&J
  finals each entry must be a registered lead and any partner a registered
  follow. Advancing into a J&J final sends all checked competitors — leads
  and follows each get their own `heat_entries` row; follow-role rows are
  "promoted follows" (pairing pool only). A lead's `followCompetitorId` must
  point at a promoted follow in the same round, and only lead rows are
  judged/ranked (follow markers are filtered out of RP sheets, validation,
  and results). Scratch removes heat entries where the competitor is the lead OR
  the paired follow (removing the whole pair either way).
- Judge flow: `JudgeRoundsPage` lists rounds (gated on `pending`);
  `RoundScoringPage` renders Y/Alt/No toggle buttons per entry (with lead/
  follow/both scope for J&J) or rank selects for finals.
- Scratching a competitor now also deletes their heat entries, callback votes,
  and placements across the division's rounds. Registration/pair edits are
  blocked once any round submission exists.

## Danceplace CSV competitor import (added 2026-10-17)

- `POST /api/events/:eventId/competitors/import` accepts `{ csv, dryRun?, divisions? }`.
  Parses a Danceplace customer-list report (`server/src/competitorImport.ts`),
  skipping non-"Paid" rows and non-competition tickets, and deduping by name.
  J&J role comes from the ticket's `- LEAD`/`- FOLLOW` suffix; Strictly
  entrants inherit their J&J role. `dryRun` returns a preview; commit creates
  competitors (same `next_bib_number` bump as the single-add route, matched by
  name so re-imports are idempotent) and merges `division_registrations`.
  `divisions` maps `{ jackAndJill, strictly }` to division ids — absent key
  auto-picks the first division of that type, explicit `null` skips.
- Client: "Import CSV" button + preview dialog on `CompetitorsPage`.

## Numeric-mode advancement cutoff (added 2026-10-17)

- `divisions.advance_count` (integer, nullable): the N highest-scoring entries
  per results group (leads / follows / strictly pairs) are flagged `advancing`
  in the division status response. Ties at the cutoff average all advance.
  Migration: `server/drizzle/0014_advance-count.sql`.
- Set at division creation or via the Edit dialog on `DivisionsPage`
  (`PATCH` accepts `advanceCount`, `null` clears). Shown as a "Top N advance"
  chip and an "Adv" column on `DivisionStatusPage`.

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
- In round mode, unmarked callback entries are submitted as "no" — judges
  explicitly choose Yes/Alt/No but blank defaults to No on submit.
- Head judge: `judge_event_assignments.is_head_judge` (one per event, set on
  JudgesPage create/edit). RP ties surviving all majority columns are broken
  by the head judge's rank; callback tally sort order uses points, then yes
  count, then the head judge's vote. Competitors still tied share a placement.
- `placement` column name is `rank` on the `placements` table (raw judge
  input) vs computed `placement` in results output.
