import { Gauge, register } from "prom-client";
// Importing this registers the costing_* metrics on prom-client's default
// registry (the same `register` this route scrapes) as a side effect —
// nothing here calls them directly.
import "@/lib/costing/metrics";

const up = new Gauge({ name: "faida_up", help: "Whether the API process is running", registers: [register] });
up.set(1);

export async function GET() {
  const body = await register.metrics();
  return new Response(body, { headers: { "Content-Type": register.contentType } });
}
