import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const HIVE_HOME = process.env.HIVE_HOME ?? path.join(os.homedir(), ".hive");
const CTX_PATH = path.join(HIVE_HOME, "ctx");

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
  console.log("--- Running test-hive-ctx.js ---");
  try {
    // 1. hive-ctx npm package imports without error
    const require = createRequire(import.meta.url);
    const { HiveCtx } = require("@imisbahk/hive-ctx");
    check("hive-ctx npm package imports without error", !!HiveCtx);

    // 2. HiveCtx instantiates with ~/.hive/ctx/ storage path
    if (!fs.existsSync(CTX_PATH)) {
      fs.mkdirSync(CTX_PATH, { recursive: true });
    }
    const ctx = new HiveCtx({ storagePath: CTX_PATH, budgetTokens: 300, profile: {} });
    check("HiveCtx instantiates with ~/.hive/ctx/ storage path", !!ctx);

    // 3. ctx.build("hey") returns under 80 tokens
    try {
      const res1 = await ctx.build("hey");
      console.log(`  [build 1 tokens: ${res1.tokenCount}]`);
      check(
        'ctx.build("hey") returns under 80 tokens',
        typeof res1.tokenCount === "number" && res1.tokenCount < 80,
        `Tokens: ${res1.tokenCount}`,
      );
    } catch (e) {
      check('ctx.build("hey") returns under 80 tokens', false, e?.message ?? String(e));
    }

    // 4. ctx.remember stores without error
    try {
      await ctx.remember("test fact xyz123");
      check('ctx.remember("test fact xyz123") stores without error', true);
    } catch (e) {
      check(
        'ctx.remember("test fact xyz123") stores without error',
        false,
        e?.message ?? String(e),
      );
    }

    // 5. ctx.episode stores without error
    try {
      await ctx.episode("test message xyz123", "test response xyz123");
      check('ctx.episode("test message", "test response") stores without error', true);
    } catch (e) {
      check(
        'ctx.episode("test message", "test response") stores without error',
        false,
        e?.message ?? String(e),
      );
    }

    // 6. Both sqlite files exist at ~/.hive/ctx/
    const graphDb = path.join(CTX_PATH, "hive_graph.sqlite");
    const memDb = path.join(CTX_PATH, "hive_memory.sqlite");
    check(
      "Both sqlite files exist at ~/.hive/ctx/",
      fs.existsSync(graphDb) && fs.existsSync(memDb),
      "Missing db files in ctx/",
    );
  } catch (err) {
    check("script crashed", false, err?.message ?? String(err));
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
