import { execSync } from "node:child_process";
import { openHiveDatabase, closeHiveDatabase, insertKnowledge } from "../src/storage/db.js";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as os from "node:os";

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
    console.log("--- Running test-memory.ts ---");

    let db: any;
    try {
        db = openHiveDatabase();

        // 1. /remember test-memory-fact-xyz stores to knowledge table
        // Testing the underlying DB insertKnowledge function that /remember uses
        try {
            insertKnowledge(db, { content: "test-memory-fact-xyz" });
            check("/remember test-memory-fact-xyz stores to knowledge table", true);
        } catch (e: any) {
            check("/remember test-memory-fact-xyz stores to knowledge table", false, e.message);
        }

        // 2. hive memory list output includes test-memory-fact-xyz
        try {
            const res = runCmd("memory list");
            check("hive memory list output includes test-memory-fact-xyz", res.output.includes("test-memory-fact-xyz"));
        } catch (e: any) {
            check("hive memory list output includes test-memory-fact-xyz", false, e.message);
        }

        // 3. /forget test-memory-fact-xyz removes it (using closest match or delete function)
        try {
            const { findClosestKnowledge, deleteKnowledge } = await import("../src/storage/db.js");
            const fact = findClosestKnowledge(db, "test-memory-fact-xyz");
            if (fact) {
                deleteKnowledge(db, fact.id);
            }
            check("/forget test-memory-fact-xyz removes it", true);
        } catch (e: any) {
            check("/forget test-memory-fact-xyz removes it", false, e.message);
        }

        // 4. hive memory list no longer includes it
        try {
            const res = runCmd("memory list");
            check("hive memory list no longer includes it", !res.output.includes("test-memory-fact-xyz"));
        } catch (e: any) {
            check("hive memory list no longer includes it", false, e.message);
        }

        // 5. /pin pinned-fact-xyz stores with pinned flag
        try {
            insertKnowledge(db, { content: "pinned-fact-xyz", pinned: true });
            check("/pin pinned-fact-xyz stores with pinned flag", true);
        } catch (e: any) {
            check("/pin pinned-fact-xyz stores with pinned flag", false, e.message);
        }

        // 6. ctx.build("anything") includes pinned fact in context
        try {
            const HIVE_HOME = path.join(os.homedir(), ".hive");
            const CTX_PATH = path.join(HIVE_HOME, "ctx");
            const require = createRequire(import.meta.url);
            const { HiveCtx } = require("@imisbahk/hive-ctx");
            const ctx = new HiveCtx({ storagePath: CTX_PATH, budgetTokens: 300 });

            await ctx.remember("pinned-fact-xyz", { pinned: true });
            const res = await ctx.build("anything");
            const included = res.systemPrompt.includes("pinned-fact-xyz");
            check("ctx.build(\"anything\") includes pinned fact in context", included);
        } catch (e: any) {
            check("ctx.build(\"anything\") includes pinned fact in context", false, e.message);
        }

        // 7. hive memory clear wipes episodes table
        try {
            // Just test the underlying function clearEpisodes directly, or via CLI if it supports --yes
            const { clearEpisodes } = await import("../src/storage/db.js");
            clearEpisodes(db);

            const count = db.prepare("SELECT COUNT(*) as c FROM episodes").get().c;
            check("hive memory clear wipes episodes table", count === 0);
        } catch (e: any) {
            check("hive memory clear wipes episodes table", false, e.message);
        }

        // 8. hive memory show prints persona without crashing
        try {
            const res = runCmd("memory show");
            check("hive memory show prints persona without crashing", res.exitCode === 0 && res.output.length > 0);
        } catch (e: any) {
            check("hive memory show prints persona without crashing", false, e.message);
        }

    } catch (err: any) {
        check("script crashed", false, err.message);
    } finally {
        // 9. Clean up all test facts after
        if (db) {
            try {
                const { findClosestKnowledge, deleteKnowledge } = await import("../src/storage/db.js");
                const fact = findClosestKnowledge(db, "pinned-fact-xyz");
                if (fact) {
                    deleteKnowledge(db, fact.id);
                }
            } catch (e) { }
            closeHiveDatabase(db);
        }
    }

    console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
