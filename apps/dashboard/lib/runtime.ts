import fs from "node:fs";
import path from "node:path";

import { resolveDbPath } from "@/lib/db";

export function canRunLocalPipeline(): boolean {
  if (process.env.VERCEL) {
    return false;
  }

  const dbPath = resolveDbPath();
  return fs.existsSync(dbPath) || fs.existsSync(path.dirname(dbPath));
}
