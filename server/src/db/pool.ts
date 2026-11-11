// Shared pg pool (docs/01): one pool per process, connection string from the
// zod-validated env.
import { Pool } from "pg";
import { env } from "../env";

export const pool = new Pool({ connectionString: env.DATABASE_URL });
