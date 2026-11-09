// Vitest runs the server against a host-reachable Postgres; a compose-spawned
// db publishes no port (01's compose file is final), so tests default to
// localhost:5432 — set DATABASE_URL explicitly to override.
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgres://dc:dc@localhost:5432/darknesscaress";
process.env.JWT_SECRET ??= "test-only-secret";
