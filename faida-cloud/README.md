# Faida (Mama Lishe) — Cloud Stack

| Layer | Technology |
|---|---|
| Frontend | Flutter + Dart (`mobile/`) |
| Backend | Next.js (TypeScript) REST API (`backend/`) |
| Database | PostgreSQL (migrations in `backend/migrations/`) |
| API layer | REST under `/api/v1/*` |
| Auth | JWT + OAuth 2.0 + RBAC (`backend/src/lib/auth/`) |
| Caching | Redis (`backend/src/lib/redis.ts`) |
| File storage | AWS S3 presigned URLs (`backend/src/lib/s3.ts`) |
| Notifications | FCM + SMTP email + Beem SMS (`backend/src/lib/notifications/`) |
| CI/CD | GitHub Actions (`.github/workflows/`) + Docker + Nginx |
| Monitoring | Sentry + Prometheus + Grafana + Loki (`monitoring/`) |

## Quick start (dev)

```bash
cp .env.example .env        # fill in values
docker compose up -d postgres redis
cd backend && npm install && npm run dev
```

Apply migrations in order (V1..V9) with your preferred runner (e.g. Flyway or psql), then `npm run seed`.

## Deploy

Push to `main` → GitHub Actions builds the Docker image, pushes to GHCR, and deploys over SSH (`.github/workflows/deploy.yml`). Set repo secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`.

See `08_Cloud_Setup_Guide_Faida.pdf` in the project folder for the full runbook.

## Carried over from the local-server skeleton

- `backend/src/core/costing/` — tested costing engine (golden fixtures included)
- `backend/migrations/` — full PostgreSQL schema (V1–V9, incl. RLS policies)
- `backend/seed-data/` + `backend/scripts/seed.ts` — ingredient/recipe seed data
