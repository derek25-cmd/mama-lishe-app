# Faida backend

Next.js (App Router, route handlers only — no pages) TypeScript API. Mirrors DOC 02's
service decomposition as route groups under `src/app/api/v1/*` rather than separate
deployables.

## Layout

```
src/
  app/api/v1/       route handlers (costing, pos, vendor, auth, health, ...)
  core/costing/      pure costing engine — zero I/O, 100% test coverage (golden fixtures)
  lib/                db (Kysely), redis, s3, auth (jwt/rbac), notifications (fcm/sms/email)
  middleware.ts       bearer-token gate on /api/v1/*
migrations/           Flyway-style SQL, V1..V9, applied in order
scripts/seed.ts        idempotent loader for the reference xlsx workbooks
```

## Dev

```bash
npm install
cp ../.env.example ../.env   # then fill in values, from repo root
npm run dev
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm test` | vitest (all) |
| `npm run test:costing` | costing core only, must stay at 100% coverage |
| `npm run seed` | load `seed-data/*.xlsx` into Postgres (safe to re-run) |

## Migrations

Apply `migrations/V1__*.sql` through `V9__*.sql` in order against `DATABASE_URL`
before running `npm run seed`.
