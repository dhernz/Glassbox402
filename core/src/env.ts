// Load the repo .env into process.env without a dependency.
// Processes that aren't launched from demo.sh's shell (the MCP server, a hub
// started by hand) don't inherit the operator's credentials otherwise.
// Existing environment variables always win.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function loadEnv(): void {
  try {
    const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m || line.trimStart().startsWith("#")) continue;
      const val = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch {
    // no .env — fall back to whatever the environment already provides
  }
}
