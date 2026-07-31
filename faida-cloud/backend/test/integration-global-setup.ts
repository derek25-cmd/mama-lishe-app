import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let postgres: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;

// Runs once, in the main Vitest process, before any worker (and therefore
// before any test file's own imports) starts — so setting process.env here
// is what makes db.ts's lazily-created pool and redis.ts's eagerly-created
// client both pick up the ephemeral container URLs instead of whatever the
// dev stack's .env says.
export async function setup(): Promise<void> {
  postgres = await new PostgreSqlContainer("postgres:16-alpine").withDatabase("faida_test").start();
  redisContainer = await new RedisContainer("redis:7-alpine").start();

  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.REDIS_URL = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  process.env.JWT_SECRET = "integration-test-secret-do-not-use-in-real-life";
  process.env.JWT_ACCESS_TTL = "3600";
  process.env.JWT_REFRESH_TTL_DAYS = "30";
  process.env.SMS_DRIVER = "console"; // sufficient on its own to force the console driver, NODE_ENV untouched

  const { runner } = await import("node-pg-migrate");
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: join(__dirname, "..", "migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {}, // quiet — the migration SQL itself is already proven in Phase 1/2's live verification
  });
}

export async function teardown(): Promise<void> {
  await redisContainer?.stop();
  await postgres?.stop();
}
