# Dance Judging

A mobile-first competition administration app built with React, Material UI,
Fastify, Drizzle, and PostgreSQL. The full stack runs in Docker for consistent
local and production environments.

## Features

- Administrator login with an httpOnly session cookie
- Event creation and selection
- Competitor registration with automatic, event-scoped bib numbers
- Jack & Jill and Strictly divisions
- Lead/follow assignments for competitors in each division
- Admin-managed judge profiles with multi-event assignments
- Competition coordinator accounts with event-scoped management access
- Persistent 1–10 judge scoring with save, lock, edit, and revision protection
- Lead/follow/both judging scopes, optional name hiding, and provisional status

## Prerequisites

- Docker Desktop with Docker Compose

No host installation of Node.js, PostgreSQL, or nginx is required.

## Local development

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Replace the development passwords and JWT secret in `.env`.

3. Start the development stack:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```

4. Open http://localhost (or the `WEB_PORT` configured in `.env).

The development override runs Vite and the Fastify API in watch mode. nginx is
the single browser-facing origin and proxies `/api` to Fastify, so cookies and
network behavior match production.

The seed administrator uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. The
seed is idempotent and only creates the account when it does not already exist.

## Judge onboarding and scoring

1. Sign in as an administrator and open **Judges**.
2. Create the judge profile with their name, email, an initial password, and
   one or more assigned events.
3. Share the initial password securely with the judge. Passwords are stored
   only as bcrypt hashes.
4. The judge signs in and selects an assigned event, then a division.
5. The judge selects Leads, Follows, or Both, enters one integer score from
   1–10 for each competitor in that scope, and selects **Save scores**.
6. Saved scores are locked against accidental changes. The judge can select
   **Edit scores**, make changes, and save a new revision.

Event access is checked against the database on every request, so assignment
changes take effect without requiring the judge to sign in again. Division
registrations cannot be changed after scoring begins, protecting completed
judge sheets from roster changes.

## Competition coordinators

Administrators create coordinator accounts and assign them to one or more
events. Coordinators use the same event management UI as administrators for
their assigned events only:

- View assigned events and open competitors, divisions, pairs, and division
  status
- Create and update competitors, divisions, registrations, and strictly pairs
- See competitor names on division status regardless of the division's name
  visibility setting

Coordinators cannot create events, manage judges, or manage other coordinators.
Those actions remain administrator-only.

1. Sign in as an administrator and open **Coordinators**.
2. Create the coordinator profile with their name, email, an initial password,
   and one or more assigned events.
3. Share the initial password securely with the coordinator.
4. The coordinator signs in and manages only the events assigned to them.

## Strictly pair scoring

Strictly divisions require admins to pair each registered lead with one follow.
Judges score each pair once using the lead competitor's bib number. Division
status lists pairs by lead bib with both dancers' first names (when name
visibility allows).

## Scoring logic to revisit

Division status averages are preliminary and are not official placements.
Before finalizing results, define:

- [ ] Official placement and ranking rules
- [ ] Lead/follow comparison rules
- [ ] Judge weighting or dropped high/low scores
- [ ] Tie-breaking
- [ ] Rounds, callbacks, finals, and withdrawn competitors

## Production build

Build and start the production stack:

```bash
docker compose up -d --build
```

The `web` image builds the React client and serves it with nginx. The `api`
image compiles TypeScript, applies pending Drizzle migrations, seeds the initial
administrator if needed, and starts Fastify. PostgreSQL data is retained in the
`pgdata` named volume.

Check service health and logs:

```bash
docker compose ps
docker compose logs -f api web db
```

Stop the stack without deleting database data:

```bash
docker compose down
```

Do not use `docker compose down -v` unless you intend to permanently delete the
database volume.

## Railway deployment

This repository includes a single-service Railway image that builds the React
client, runs Fastify on `127.0.0.1:3001`, and serves everything through nginx
on Railway's `PORT`. Local Docker Compose is unchanged.

### 1. Create the Railway project

1. Create a new Railway project from this repository.
2. Add a **PostgreSQL** plugin to the project.
3. Add a **service** for the app using [`railway.toml`](railway.toml), which
   builds [`Dockerfile.railway`](Dockerfile.railway).

Railway uses the config file instead of a root `Dockerfile`, so local
`docker compose` workflows are unaffected.

### 2. Link PostgreSQL to the app service

In the app service settings, attach the PostgreSQL database. Railway injects
`DATABASE_URL` automatically. No manual database host configuration is required.

### 3. Set required environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `JWT_SECRET` | Yes | Long random secret for session tokens |
| `ADMIN_PASSWORD` | Yes | Initial administrator password (seed is idempotent) |
| `ADMIN_EMAIL` | No | Defaults to `admin@local.dev` |
| `COOKIE_SECURE` | Yes | Set to `true` on Railway (HTTPS) |
| `DATABASE_SSL` | Usually | Set to `true` if Railway PostgreSQL requires SSL |

Do **not** set `PORT`; Railway provides it.

### 4. Deploy

Push to the connected branch or run:

```bash
railway up
```

On each deploy the container will:

1. Apply Drizzle migrations
2. Seed the administrator if missing
3. Start the API and nginx reverse proxy
4. Expose `/api/health` for Railway health checks

Generate a public domain in Railway, then sign in with `ADMIN_EMAIL` and
`ADMIN_PASSWORD`.

### 5. Verify

- Open `https://<your-railway-domain>/`
- Confirm `https://<your-railway-domain>/api/health` returns `{ "status": "ok" }`
- Sign in as the administrator and create a test event

Back up the PostgreSQL plugin regularly from the Railway dashboard.

## Single-VM deployment (GCP Compute or Oracle Cloud)

1. Create a small Linux VM and install Docker Engine with the Compose plugin.
2. Clone this repository onto the VM.
3. Copy `.env.example` to `.env`.
4. Set strong, unique values for `POSTGRES_PASSWORD`, `JWT_SECRET`, and
   `ADMIN_PASSWORD`.
5. Set `WEB_PORT=80`.
6. Run:

   ```bash
   docker compose up -d --build
   ```

7. Allow inbound TCP port 80 in the cloud firewall.

Before public deployment, put TLS in front of the stack (for example, a Caddy
or cloud load-balancer proxy), then set `COOKIE_SECURE=true` and allow port 443.
Keep `.env` private and back up the `pgdata` volume regularly.

## Database maintenance

Open PostgreSQL inside the container:

```bash
docker compose exec db psql -U judging -d judging
```

Create a logical backup:

```bash
docker compose exec -T db pg_dump -U judging judging > judging-backup.sql
```

Restore a backup into an empty database:

```bash
docker compose exec -T db psql -U judging -d judging < judging-backup.sql
```

## Repository layout

- `client/` — Vite, React, Material UI
- `server/` — Fastify API, Drizzle schema and migrations
- `nginx/` — development and production reverse-proxy configuration
- `docker-compose.yml` — production stack
- `docker-compose.dev.yml` — development overrides
- `Dockerfile.railway` — single-service production image for Railway
- `railway.toml` — Railway build and health-check configuration
