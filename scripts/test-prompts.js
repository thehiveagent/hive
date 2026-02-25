import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const HIVE_HOME = process.env.HIVE_HOME ?? path.join(os.homedir(), ".hive");
const PROMPTS_DIR = path.join(HIVE_HOME, "prompts");

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

async function main() {
  console.log("--- Running test-prompts.js ---");
  try {
    // 1. ~/.hive/prompts/ exists
    check("~/.hive/prompts/ exists", fs.existsSync(PROMPTS_DIR));

    const files = ["System.md", "Memory.md", "Behaviour.md", "Code.md"];
    for (const f of files) {
      const fp = path.join(PROMPTS_DIR, f);
      check(`${f} present`, fs.existsSync(fp));

      try {
        fs.accessSync(fp, fs.constants.R_OK);
        check(`${f} readable`, true);
      } catch (e) {
        check(`${f} readable`, false, e?.message ?? String(e));
      }
    }

    // 2. Template variables present
    try {
      const sysContent = fs.readFileSync(path.join(PROMPTS_DIR, "System.md"), "utf8");
      check(
        "Template variables {name}, {agent_name} present in System.md",
        sysContent.includes("{name}") && sysContent.includes("{agent_name}"),
      );
    } catch (e) {
      check(
        "Template variables {name}, {agent_name} present in System.md",
        false,
        e?.message ?? String(e),
      );
    }

    // 3. ctx.build interpolates profile variables
    try {
      const CTX_PATH = path.join(HIVE_HOME, "ctx");
      const require = createRequire(import.meta.url);
      const { HiveCtx } = require("@imisbahk/hive-ctx");

      const ctx = new HiveCtx({
        storagePath: CTX_PATH,
        budgetTokens: 300,
        profile: { agent_name: "PromptsTestAgent", name: "PromptsTestUser" },
      });

      const res = await ctx.build("test interpolation");
      const prompt = String(res.systemPrompt ?? "");
      check(
        "ctx.build interpolates {name}/{agent_name}",
        !prompt.includes("{name}") &&
          !prompt.includes("{agent_name}") &&
          (prompt.includes("PromptsTestUser") || prompt.includes("PromptsTestAgent")),
      );
    } catch (e) {
      check("ctx.build interpolates {name}/{agent_name}", false, e?.message ?? String(e));
    }
  } catch (err) {
    check("script crashed", false, err?.message ?? String(err));
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
