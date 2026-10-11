import { openDatabase } from "../server/db";
const db = openDatabase();
console.log(db.query("SELECT * FROM schema_migrations").all());
console.log("foreign_key_check", db.query("PRAGMA foreign_key_check").all());
db.close();
