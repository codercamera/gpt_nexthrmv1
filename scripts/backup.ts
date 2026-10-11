import { openDatabase } from "../server/db";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
const target = resolve(
  process.argv[2] || `./data/backups/hrm-${Date.now()}.sqlite`,
);
mkdirSync(dirname(target), { recursive: true });
const db = openDatabase();
db.query("VACUUM INTO ?").run(target);
db.close();
console.log(target);
