// Minimal stub so Prometheus's configured scrape target (monitoring/prometheus.yml)
// resolves to something real instead of a 404. Replace with prom-client counters
// (request duration, RLS denials, sync lag) as those become worth graphing.
export async function GET() {
  const body = ["# HELP faida_up Whether the API process is running", "# TYPE faida_up gauge", "faida_up 1"].join(
    "\n",
  );
  return new Response(body, { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
