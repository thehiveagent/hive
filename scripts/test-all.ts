import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const scripts = [
    "test-db.ts",
    "test-providers.ts",
    "test-hive-ctx.ts",
    "test-daemon.ts",
    "test-cli.ts",
    "test-browser.ts",
    "test-memory.ts",
    "test-theme.ts",
    "test-prompts.ts",
];

let totalPassed = 0;
let totalFailed = 0;
let suitesFailed = 0;

function runScript(scriptName: string) {
    console.log(`\n======================================================`);
    console.log(`Running Suite: ${scriptName}`);
    console.log(`======================================================\n`);

    const scriptPath = path.join(process.cwd(), "scripts", scriptName);

    // Use tsx or ts-node to run the script
    // The prompt specifies npx ts-node, but since the project is ESM, we use ts-node --esm or tsx
    // We'll use tsx for reliability as previously discovered
    const result = spawnSync("npx", ["--yes", "tsx", scriptPath], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8"
    });

    const output = result.stdout + (result.stderr ? "\n" + result.stderr : "");
    console.log(output.trim());

    // Aggregate results by parsing the output summary line
    // Example: Summary: 5/5 checks passed.
    const summaryMatch = output.match(/Summary:\s+(\d+)\/(\d+)\s+checks passed/);
    if (summaryMatch) {
        const passed = parseInt(summaryMatch[1], 10);
        const total = parseInt(summaryMatch[2], 10);
        const failed = total - passed;

        totalPassed += passed;
        totalFailed += failed;

        if (result.status !== 0 || failed > 0) {
            suitesFailed++;
        }
    } else {
        console.log(`✗ fail — script crashed or summary not found: exit code ${result.status}`);
        totalFailed += 1; // Count as 1 major failure if we can't parse it
        suitesFailed++;
    }
}

function main() {
    console.log("Starting Hive Test Suite Runner...\n");

    for (const script of scripts) {
        if (fs.existsSync(path.join(process.cwd(), "scripts", script))) {
            runScript(script);
        } else {
            console.log(`\n✗ fail — Script not found: ${script}`);
            totalFailed += 1;
            suitesFailed++;
        }
    }

    console.log(`\n======================================================`);
    console.log(`FINAL RESULTS`);
    console.log(`======================================================`);
    console.log(`${totalPassed}/${totalPassed + totalFailed} total checks passed across all suites.`);

    if (suitesFailed > 0) {
        console.log(`\n✗ ${suitesFailed} test suite(s) failed.`);
        process.exit(1);
    } else {
        console.log(`\n✓ All test suites passed successfully!`);
        process.exit(0);
    }
}

main();
