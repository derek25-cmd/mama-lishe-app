# Faida monitoring

Prometheus + Grafana + Loki + Promtail, all internal-network-only (Grafana is reachable
via nginx at `grafana.<your-domain>` once that vhost is added to `nginx/nginx.conf`).

- `prometheus.yml` — scrapes the backend's `/api/v1/metrics` endpoint (not yet
  implemented — add a route handler there before this scrape target returns real data).
- `promtail-config.yml` — tails Docker container logs via the daemon socket and ships
  them to Loki.
- `grafana/provisioning/datasources/` — auto-provisions Prometheus + Loki as datasources
  on first boot; no manual "Add datasource" click-through needed.

`GRAFANA_ADMIN_PASSWORD` must be set in `.env` before first boot — Grafana will otherwise
fail its first-run setup.
