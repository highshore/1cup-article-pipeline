import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardDir = path.resolve(scriptDir, "..");
const rootEnvPath = path.resolve(dashboardDir, "../../.env.local");
const dashboardEnvPath = path.join(dashboardDir, ".env.local");

if (!fs.existsSync(rootEnvPath)) {
  process.exit(0);
}

try {
  const existing = fs.lstatSync(dashboardEnvPath);

  if (existing.isSymbolicLink()) {
    const linkedPath = path.resolve(dashboardDir, fs.readlinkSync(dashboardEnvPath));
    if (linkedPath === rootEnvPath) {
      process.exit(0);
    }
  }

  // Preserve an app-local env file if someone created one intentionally.
  process.exit(0);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
    throw error;
  }
}

fs.symlinkSync(path.relative(dashboardDir, rootEnvPath), dashboardEnvPath);
