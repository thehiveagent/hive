import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { closeHiveDatabase, openHiveDatabase, upsertPrimaryAgent } from "../dist/storage/db.js";

const scripts = [
  "test-db.js",
  "test-providers.js",
  "test-hive-ctx.js",
  "test-daemon.js",
  "test-cli.js",
  "test-browser.js",
  "test-memory.js",
  "test-theme.js",
  "test-prompts.js",
];

let totalPassed = 0;
let totalFailed = 0;
let suitesFailed = 0;

const hiveHome = fs.mkdtempSync(path.join(os.tmpdir(), "hive-test-"));

seedHiveHome();

function runScript(scriptName) {
  console.log(`\n======================================================`);
  console.log(`Running Suite: ${scriptName}`);
  console.log(`======================================================\n`);

  const scriptPath = path.join(process.cwd(), "scripts", scriptName);

  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: {
      ...process.env,
      HIVE_HOME: hiveHome,
    },
  });

  const output = result.stdout + (result.stderr ? "\n" + result.stderr : "");
  console.log(output.trim());

  const summaryMatch = output.match(/Summary:\s+(\d+)\/(\d+)\s+checks passed/);
  if (summaryMatch) {
    const passed = Number.parseInt(summaryMatch[1], 10);
    const total = Number.parseInt(summaryMatch[2], 10);
    const failed = total - passed;

    totalPassed += passed;
    totalFailed += failed;

    if (result.status !== 0 || failed > 0) {
      suitesFailed += 1;
    }
    return;
  }

  console.log(
    `✗ fail — script crashed or summary not found: exit code ${result.status ?? "unknown"}`,
  );
  totalFailed += 1;
  suitesFailed += 1;
}

function main() {
  console.log("Starting Hive Test Suite Runner...\n");
  console.log(`HIVE_HOME=${hiveHome}\n`);

  for (const script of scripts) {
    if (fs.existsSync(path.join(process.cwd(), "scripts", script))) {
      runScript(script);
      continue;
    }

    console.log(`\n✗ fail — Script not found: ${script}`);
    totalFailed += 1;
    suitesFailed += 1;
  }

  console.log(`\n======================================================`);
  console.log(`FINAL RESULTS`);
  console.log(`======================================================`);
  console.log(`${totalPassed}/${totalPassed + totalFailed} total checks passed across all suites.`);

  if (suitesFailed > 0) {
    console.log(`\n✗ ${suitesFailed} test suite(s) failed.`);
    process.exit(1);
  }

  console.log(`\n✓ All test suites passed successfully!`);
  process.exit(0);
}

main();

function seedHiveHome() {
  fs.mkdirSync(hiveHome, { recursive: true });
  fs.mkdirSync(path.join(hiveHome, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(hiveHome, "ctx"), { recursive: true });

  // Copy bundled prompts into the test hive home (mimics `hive init` prompts load).
  try {
    const sourceDir = path.join(process.cwd(), "prompts");
    const destDir = path.join(hiveHome, "prompts");
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const src = path.join(sourceDir, entry.name);
      const dest = path.join(destDir, entry.name);
      fs.copyFileSync(src, dest);
    }
  } catch {
    // ignore
  }

  // Seed a primary agent so CLI commands don't fail on an empty database.
  try {
    const db = openHiveDatabase();
    try {
      upsertPrimaryAgent(db, {
        name: "Test User",
        agentName: "hive",
        provider: "openai",
        model: "gpt-4o-mini",
        persona: "Test persona.",
      });
    } finally {
      closeHiveDatabase(db);
    }
  } catch {
    // ignore
  }
}
