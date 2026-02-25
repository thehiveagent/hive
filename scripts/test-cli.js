import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function check(label, ok, err) {
  if (ok) {
    console.log(`✓ ${label}`);
    passed += 1;
    return;
  }

  console.log(`✗ ${label} — ${err || "Assertion failed"}`);
  failed += 1;
}

function runCmd(args) {
  try {
    const output = execSync(`node dist/cli/index.js ${args}`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return { output: output.trim(), exitCode: 0 };
  } catch (error) {
    const output =
      typeof error?.stdout?.toString === "function"
        ? error.stdout.toString().trim()
        : String(error?.message ?? error);
    return { output, exitCode: error?.status || 1 };
  }
}

function getPackageVersion() {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw);
  return typeof parsed.version === "string" ? parsed.version : "";
}

async function main() {
  console.log("--- Running test-cli.js ---");
  try {
    const version = getPackageVersion();

    // 1. --version prints version matching package.json
    try {
      const res = runCmd("--version");
      check(
        "--version prints version matching package.json",
        res.exitCode === 0 && version.length > 0 && res.output.includes(version),
        `Expected ${version}, got: ${res.output}`,
      );
    } catch (error) {
      check(
        "--version prints version matching package.json",
        false,
        String(error?.message ?? error),
      );
    }

    // 2. status exits 0 and prints output
    try {
      const res = runCmd("status");
      check("status exits 0 and prints output", res.exitCode === 0 && res.output.length > 0);
    } catch (error) {
      check("status exits 0 and prints output", false, String(error?.message ?? error));
    }

    // 3. doctor exits 0 and prints check results
    try {
      const res = runCmd("doctor");
      check(
        "doctor exits 0 and prints check results",
        res.exitCode === 0 && res.output.includes("✓"),
      );
    } catch (error) {
      check("doctor exits 0 and prints check results", false, String(error?.message ?? error));
    }

    // 4. daemon status exits 0
    try {
      const res = runCmd("daemon status");
      check(
        "daemon status exits 0",
        res.exitCode === 0,
        `Exit code: ${res.exitCode}, Output: ${res.output}`,
      );
    } catch (error) {
      check("daemon status exits 0", false, String(error?.message ?? error));
    }

    // 5. config show prints provider and model
    try {
      const res = runCmd("config show");
      check(
        "config show prints provider and model",
        res.exitCode === 0 && res.output.includes("Provider") && res.output.includes("Model"),
      );
    } catch (error) {
      check("config show prints provider and model", false, String(error?.message ?? error));
    }

    // 6. memory list exits 0
    try {
      const res = runCmd("memory list");
      check("memory list exits 0", res.exitCode === 0);
    } catch (error) {
      check("memory list exits 0", false, String(error?.message ?? error));
    }

    // 7. --help exits 0 and lists usage
    try {
      const res = runCmd("--help");
      check("--help exits 0 and prints usage", res.exitCode === 0 && res.output.includes("Usage:"));
    } catch (error) {
      check("--help exits 0 and prints usage", false, String(error?.message ?? error));
    }
  } catch (err) {
    check("script crashed", false, String(err?.message ?? err));
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
