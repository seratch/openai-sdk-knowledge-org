import type { D1Database } from "@cloudflare/workers-types";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type DrizzleDB = DrizzleD1Database<typeof schema>;

export function getDrizzleDB(db: D1Database): DrizzleDB {
  return drizzle(db, { schema });
}
