#!/usr/bin/env node
// `npx x402ify <url> --price 0.01 --wallet 0x…` — the one command.
// Loads the repo .env (Hedera operator creds), turns on real Hedera settlement,
// picks a free port, and runs the gateway in front of your API.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // core/bin
const core = join(here, "..");                         // core
const root = join(core, "..");                         // repo root

// load repo .env (operator/payer creds + HEDERA_LIVE) without clobbering real env
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
if (!process.env.HEDERA_LIVE) process.env.HEDERA_LIVE = "1";

const args = process.argv.slice(2);
if (!args.includes("--port")) args.push("--port", String(4030 + Math.floor(Math.random() * 900)));

const tsxLocal = join(root, "node_modules/.bin/tsx");
const tsx = existsSync(tsxLocal) ? tsxLocal : "tsx";
const child = spawn(tsx, [join(core, "src/x402ify.ts"), ...args], { stdio: "inherit" });
child.on("exit", (c) => process.exit(c ?? 0));
