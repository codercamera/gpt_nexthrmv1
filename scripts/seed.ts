import { openDatabase } from "../server/db";
import { seed } from "../server/seed";
const password = process.env.SEED_PASSWORD;
if (!password)
  throw Error(
    "Set SEED_PASSWORD (12+ characters). Seed is explicit and never runs on server start.",
  );
const db = openDatabase();
await seed(db, password);
db.close();
console.log(
  "Demo workspace created: admin, hr, reviewer, approver, manager, employee @test.com; tenant code: demo",
);
