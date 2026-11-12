import fs from "node:fs";
import path from "node:path";
import { pool } from "./pool";

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log("Migrations complete");
      return pool.end();
    })
    .catch((error) => {
      console.error(error);
      void pool.end().finally(() => process.exit(1));
    });
}
