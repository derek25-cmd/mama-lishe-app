import { Counter, Histogram, register } from "prom-client";

// Registered on prom-client's default global registry so /api/v1/metrics
// (a single process-wide scrape endpoint) picks these up automatically
// alongside any other metrics registered elsewhere in the app.
//
// Next.js bundles each API route as its own webpack module graph, even
// within a single Node process — that can pull in a second copy of this
// module (and so a second `new Histogram(...)`) for a route chunk that
// imports it independently of another. A plain `export const` would then
// silently split observations across two disconnected instances: the route
// that calls .observe() writes to one, the /metrics route's import
// resolves to the other, and the scrape always reads zero. Caching the
// instances on `globalThis` keyed by metric name makes every module graph
// share the exact same Histogram/Counter object — the same fix Next.js
// apps use for singletons like a Prisma client across hot-reloads.
declare global {
  var __faidaCostingMetrics__:
    | {
        duration: Histogram<"cache_hit">;
        missingPrice: Counter<"ingredient">;
        stalePrices: Counter<string>;
      }
    | undefined;
}

const metrics = (globalThis.__faidaCostingMetrics__ ??= {
  duration: new Histogram({
    name: "costing_duration_seconds",
    help: "Wall-clock time to compute a costing result (computePlanCosting), including all repository calls",
    labelNames: ["cache_hit"] as const,
    // Sub-150ms warm is the target (Task 5's POST /plans/price spec) —
    // buckets concentrate there, with a long tail for cold-cache/DB-outage cases.
    buckets: [0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2, 5],
    registers: [register],
  }),
  missingPrice: new Counter({
    name: "costing_missing_price_total",
    help: "Number of times an ingredient had no price in any tier (market/region/forecast) during costing",
    labelNames: ["ingredient"] as const,
    registers: [register],
  }),
  stalePrices: new Counter({
    name: "costing_stale_prices_total",
    help: "Number of costing requests that used a price snapshot older than the staleness threshold (see priceFreshness, 14 days)",
    registers: [register],
  }),
});

export const costingDurationSeconds = metrics.duration;
export const costingMissingPriceTotal = metrics.missingPrice;
export const costingStalePricesTotal = metrics.stalePrices;
