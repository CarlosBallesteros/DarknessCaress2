import { Pool } from "pg";
import { env } from "../env";

// Lazily connected: the pool opens sockets on first query, so boot never
// depends on the database being up (health does not probe the db either).
export const pool = new Pool({ connectionString: env.DATABASE_URL });
