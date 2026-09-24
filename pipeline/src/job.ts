// Shared CLI for pipeline jobs: picks the raw-file store, looks up the city, and runs
// each step in order. A failing step doesn't stop the others; the job exits non-zero
// if any failed, which is what makes GitHub email on a failed scheduled run.
//
//   --only <name>   run one step
//   --upload        raw files to S3_BUCKET (R2) instead of data/raw/
//   --remote        allow a non-local DATABASE_URL outside CI (read by @ripstaurant/db)

import { parseArgs } from "node:util";
import { sql } from "@ripstaurant/db";
import { bucketStore, localStore } from "./storage";
import type { RawStore } from "./storage";

export const CITY = "toronto";

export type Step = {
  name: string;
  /** Returns a one-line summary for the log. */
  run: (cityId: string, store: RawStore) => Promise<string>;
};

export async function runJob(steps: Step[]): Promise<void> {
  const { values: args } = parseArgs({
    options: {
      only: { type: "string" },
      upload: { type: "boolean", default: false },
      remote: { type: "boolean", default: false },
    },
  });
  const selected = args.only
    ? steps.filter((s) => s.name === args.only)
    : steps;
  if (!selected.length)
    throw new Error(
      `unknown step "${args.only}" (have: ${steps.map((s) => s.name).join(", ")})`,
    );

  const store = args.upload ? bucketStore() : localStore();
  const [city]: { id: string }[] =
    await sql`select id from cities where slug = ${CITY}`;
  if (!city)
    throw new Error(`city "${CITY}" not found; run bun run db:migrate`);

  console.log(`raw files → ${store.name}`);
  for (const step of selected) {
    const started = performance.now();
    try {
      const summary = await step.run(city.id, store);
      const secs = ((performance.now() - started) / 1000).toFixed(0);
      console.log(`${step.name}: ${summary} (${secs}s)`);
    } catch (error) {
      console.error(`${step.name}: FAILED`, error);
      process.exitCode = 1;
    }
  }
  await sql.close();
}

export function count(n: number): string {
  return n.toLocaleString("en-CA");
}
