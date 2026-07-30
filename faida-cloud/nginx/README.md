# Faida nginx

Edge reverse proxy — the only container exposed to the internet (ports 80/443). Everything
else in `docker-compose.yml` sits on the internal Docker network only.

- `nginx.conf` — HTTP→HTTPS redirect, gzip, security headers, 10 MB request body cap,
  rate limiting (`20r/s` per client IP, burst 40), and reverse proxy to `api:3000`.
- `/healthz` is proxied straight to the backend's `/api/v1/health` route.
- `/api/v1/metrics` is explicitly blocked at the edge (404) — Prometheus scrapes it over
  the internal Docker network directly, it's never meant to be public.
- `grafana.<domain>` gets its own vhost proxying to `grafana:3000`, so the dashboard is
  reachable without exposing the Grafana container's port directly.
- TLS certs are expected at `/etc/letsencrypt/live/<domain>/` (certbot) — swap for a
  Cloudflare Tunnel + `cloudflared` sidecar if the server has no public IP; in that case
  nginx can drop both 443 server blocks and just terminate plain HTTP behind the tunnel.

Before first deploy: replace `api.your-domain.com` and `grafana.your-domain.com` with the
real domains everywhere in `nginx.conf`, and obtain certs for both
(`certbot certonly --webroot ...`) before nginx will start cleanly with the 443 blocks
enabled.

## No domain yet? Use the local override

`nginx.conf` will crash-loop (`cannot load certificate ... no such file or directory`) if
the certbot certs it references don't exist — which is the case until a domain is
registered and pointed at this server. Until then, `docker-compose.override.yml` (repo
root, auto-loaded by `docker compose` whenever it's present) swaps in
`nginx/nginx.local.conf` instead: same gzip/security headers/rate limiting/`/healthz`
routing, just plain HTTP on port 80, no TLS. Delete `docker-compose.override.yml` once
real certs exist and `docker compose up -d` picks the production `nginx.conf` back up
automatically.
