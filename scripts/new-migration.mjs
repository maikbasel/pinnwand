#!/usr/bin/env node
// Create a sequentially-numbered migration file (no timestamps):
//   pnpm db:migration:new add_labels  ->  supabase/migrations/0002_add_labels.sql
// The Supabase CLI applies migrations in filename sort order and only requires
// a leading numeric version token, so zero-padded counters order correctly.
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "supabase", "migrations");
const MIGRATION_FILE = /^\d+_.*\.sql$/;

const rawName = process.argv[2];
if (!rawName) {
  process.stderr.write("usage: pnpm db:migration:new <name>\n");
  process.exit(1);
}
const name = rawName
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const existing = readdirSync(DIR).filter((f) => MIGRATION_FILE.test(f));
const highest = existing.reduce((max, f) => {
  const n = Number.parseInt(f.split("_")[0], 10);
  return Number.isNaN(n) ? max : Math.max(max, n);
}, 0);
const next = String(highest + 1).padStart(4, "0");

const file = join(DIR, `${next}_${name}.sql`);
writeFileSync(file, `-- ${next}_${name}\n\n`, { flag: "wx" });
process.stdout.write(`created supabase/migrations/${next}_${name}.sql\n`);
