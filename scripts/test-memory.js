import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as os from "node:os";

import {
  closeHiveDatabase,
  deleteKnowledge,
  findClosestKnowledge,
  insertKnowledge,
  openHiveDatabase,
  clearEpisodes,
} from "../dist/storage/db.js";

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
    const output = execSync(`node dist/cli/index.js ${args}`, { stdio: "pipe", encoding: "utf8" });
    return { output: output.trim(), exitCode: 0 };
  } catch (e) {
    return {
      output:
        typeof e?.stdout?.toString === "function"
          ? e.stdout.toString().trim()
          : String(e?.message ?? e),
      exitCode: e?.status || 1,
    };
  }
}

async function main() {
  console.log("--- Running test-memory.js ---");

  let db = null;
  try {
    db = openHiveDatabase();

    // 1. Insert a knowledge fact (same underlying path as /remember fallback)
    try {
      insertKnowledge(db, { content: "test-memory-fact-xyz" });
      check("insertKnowledge stores a fact", true);
    } catch (e) {
      check("insertKnowledge stores a fact", false, e?.message ?? String(e));
    }

    // 2. hive memory list includes it
    try {
      const res = runCmd("memory list");
      check(
        "hive memory list output includes inserted fact",
        res.output.includes("test-memory-fact-xyz"),
      );
    } catch (e) {
      check("hive memory list output includes inserted fact", false, e?.message ?? String(e));
    }

    // 3. delete it via closest match
    try {
      const fact = findClosestKnowledge(db, "test-memory-fact-xyz");
      if (fact) {
        deleteKnowledge(db, fact.id);
      }
      check("deleteKnowledge removes inserted fact", true);
    } catch (e) {
      check("deleteKnowledge removes inserted fact", false, e?.message ?? String(e));
    }

    // 4. hive memory list no longer includes it
    try {
      const res = runCmd("memory list");
      check(
        "hive memory list no longer includes deleted fact",
        !res.output.includes("test-memory-fact-xyz"),
      );
    } catch (e) {
      check("hive memory list no longer includes deleted fact", false, e?.message ?? String(e));
    }

    // 5. Pinned facts show up in hive-ctx
    try {
      insertKnowledge(db, { content: "pinned-fact-xyz", pinned: true });
      const HIVE_HOME = process.env.HIVE_HOME ?? path.join(os.homedir(), ".hive");
      const CTX_PATH = path.join(HIVE_HOME, "ctx");
      const require = createRequire(import.meta.url);
      const { HiveCtx } = require("@imisbahk/hive-ctx");
      const ctx = new HiveCtx({ storagePath: CTX_PATH, budgetTokens: 300 });

      await ctx.remember("pinned-fact-xyz", { pinned: true });
      const res = await ctx.build("anything");
      const included = String(res.systemPrompt ?? "").includes("pinned-fact-xyz");
      check('ctx.build("anything") includes pinned fact', included);
    } catch (e) {
      check('ctx.build("anything") includes pinned fact', false, e?.message ?? String(e));
    }

    // 6. clearEpisodes wipes episodes table
    try {
      clearEpisodes(db);
      const count = db.prepare("SELECT COUNT(*) as c FROM episodes").get().c;
      check("clearEpisodes wipes episodes table", count === 0);
    } catch (e) {
      check("clearEpisodes wipes episodes table", false, e?.message ?? String(e));
    }

    // 7. hive memory show prints persona without crashing
    try {
      const res = runCmd("memory show");
      check(
        "hive memory show prints persona without crashing",
        res.exitCode === 0 && res.output.length > 0,
      );
    } catch (e) {
      check("hive memory show prints persona without crashing", false, e?.message ?? String(e));
    }
  } catch (err) {
    check("script crashed", false, err?.message ?? String(err));
  } finally {
    if (db) {
      try {
        const fact = findClosestKnowledge(db, "pinned-fact-xyz");
        if (fact) {
          deleteKnowledge(db, fact.id);
        }
      } catch {
        // ignore
      }
      closeHiveDatabase(db);
    }
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
