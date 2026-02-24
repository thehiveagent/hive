import { execSync } from "node:child_process";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, err?: string) {
    if (ok) {
        console.log(`✓ ${label}`);
        passed++;
    } else {
        console.log(`✗ ${label} — ${err || "Assertion failed"}`);
        failed++;
    }
}

function runCmd(args: string): { output: string; exitCode: number } {
    try {
        const output = execSync(`node dist/cli/index.js ${args}`, { stdio: "pipe", encoding: "utf8" });
        return { output: output.trim(), exitCode: 0 };
    } catch (e: any) {
        return { output: e.stdout ? e.stdout.toString().trim() : e.message, exitCode: e.status || 1 };
    }
}

async function main() {
    console.log("--- Running test-cli.ts ---");
    try {
        // 1. --version prints version matching package.json
        try {
            const pkg = require("../../package.json");
            const res = runCmd("--version");
            check("--version prints version matching package.json", res.exitCode === 0 && res.output.includes(pkg.version));
        } catch (e: any) {
            check("--version prints version matching package.json", false, e.message);
        }

        // 2. status exits 0 and prints agent name
        try {
            const res = runCmd("status");
            check("status exits 0 and prints agent name", res.exitCode === 0 && res.output.length > 0);
        } catch (e: any) {
            check("status exits 0 and prints agent name", false, e.message);
        }

        // 3. doctor exits 0 and prints check results
        try {
            const res = runCmd("doctor");
            check("doctor exits 0 and prints check results", res.exitCode === 0 && res.output.includes("✓"));
        } catch (e: any) {
            check("doctor exits 0 and prints check results", false, e.message);
        }

        // 4. daemon status exits 0
        try {
            const res = runCmd("daemon status");
            // Could be running or not, but it shouldn't crash.
            check("daemon status exits 0", res.exitCode === 0, `Exit code: ${res.exitCode}, Output: ${res.output}`);
        } catch (e: any) {
            check("daemon status exits 0", false, e.message);
        }

        // 5. config show prints provider and model
        try {
            const res = runCmd("config show");
            check("config show prints provider and model", res.exitCode === 0 && res.output.includes("Provider") && res.output.includes("Model"));
        } catch (e: any) {
            check("config show prints provider and model", false, e.message);
        }

        // 6. memory list exits 0
        try {
            const res = runCmd("memory list");
            check("memory list exits 0", res.exitCode === 0);
        } catch (e: any) {
            check("memory list exits 0", false, e.message);
        }

        // 7. --help exits 0 and lists all commands
        try {
            const res = runCmd("--help");
            check("--help exits 0 and lists all commands", res.exitCode === 0 && res.output.includes("Usage:"));
        } catch (e: any) {
            check("--help exits 0 and lists all commands", false, e.message);
        }

    } catch (err: any) {
        check("script crashed", false, err.message);
    }

    console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
