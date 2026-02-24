import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const HIVE_HOME = path.join(os.homedir(), ".hive");
const PROMPTS_DIR = path.join(HIVE_HOME, "prompts");

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

async function main() {
    console.log("--- Running test-prompts.ts ---");
    try {
        // 1. ~/.hive/prompts/ exists
        check("~/.hive/prompts/ exists", fs.existsSync(PROMPTS_DIR));

        // 2. system.md present
        // 3. memory.md present
        // 4. behavior.md present
        // 5. code.md present
        const files = ["system.md", "memory.md", "behavior.md", "code.md"];
        for (const f of files) {
            const fp = path.join(PROMPTS_DIR, f);
            check(`${f} present`, fs.existsSync(fp));

            // 6. All files readable
            try {
                fs.accessSync(fp, fs.constants.R_OK);
                check(`${f} readable`, true);
            } catch (e: any) {
                check(`${f} readable`, false, e.message);
            }
        }

        // 7. Template variables {name}, {agent_name} present in system.md
        try {
            const sysContent = fs.readFileSync(path.join(PROMPTS_DIR, "system.md"), "utf8");
            check("Template variables {name}, {agent_name} present in system.md", sysContent.includes("{name}") && sysContent.includes("{agent_name}"));
        } catch (e: any) {
            check("Template variables {name}, {agent_name} present in system.md", false, e.message);
        }

        // 8. ctx.build("test") system prompt includes interpolated name (not literal {name})
        try {
            const CTX_PATH = path.join(HIVE_HOME, "ctx");
            const require = createRequire(import.meta.url);
            const { HiveCtx } = require("@imisbahk/hive-ctx");

            const ctx = new HiveCtx({
                storagePath: CTX_PATH,
                budgetTokens: 300,
                profile: { agent_name: "PromptsTestAgent", name: "PromptsTestUser" }
            });

            const res = await ctx.build("test interpolation");
            check("ctx.build(\"test\") system prompt includes interpolated name (not literal {name})",
                !res.systemPrompt.includes("{name}") &&
                !res.systemPrompt.includes("{agent_name}") &&
                (res.systemPrompt.includes("PromptsTestUser") || res.systemPrompt.includes("PromptsTestAgent")));
        } catch (e: any) {
            check("ctx.build(\"test\") system prompt includes interpolated name (not literal {name})", false, e.message);
        }

    } catch (err: any) {
        check("script crashed", false, err.message);
    }

    console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
