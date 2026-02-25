import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  openHiveDatabase,
  closeHiveDatabase,
  getPrimaryAgent,
  upsertPrimaryAgent,
  getMetaValue,
  setMetaValue,
  createConversation,
  appendMessage,
  listMessages,
} from "../dist/storage/db.js";

const HIVE_HOME = process.env.HIVE_HOME ?? path.join(os.homedir(), ".hive");
const HIVE_DB_PATH = path.join(HIVE_HOME, "hive.db");

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
  console.log("--- Running test-db.js ---");
  try {
    // 1. Can open connection via openHiveDatabase()
    let db;
    try {
      db = openHiveDatabase();
      check("Can open connection via openHiveDatabase()", true);
    } catch (e) {
      check("Can open connection via openHiveDatabase()", false, e?.message ?? String(e));
      return;
    }

    try {
      // 2. ~/.hive/hive.db exists after opening
      check("~/.hive/hive.db exists after opening", fs.existsSync(HIVE_DB_PATH));

      // 3. getPrimaryAgent() returns a record or null (should not throw)
      let agentForTests = null;
      try {
        const agent = getPrimaryAgent(db);
        check("getPrimaryAgent() does not throw", true);
        if (agent) {
          check("getPrimaryAgent() returns a valid agent record", typeof agent.id === "string");
          agentForTests = agent;
        }
      } catch (e) {
        check("getPrimaryAgent() does not throw", false, e?.message ?? String(e));
      }

      if (!agentForTests) {
        try {
          agentForTests = upsertPrimaryAgent(db, {
            name: "Test User",
            agentName: "hive",
            provider: "openai",
            model: "gpt-4o-mini",
            persona: "Test persona.",
            dob: null,
            location: null,
            profession: null,
            aboutRaw: null,
          });
          check(
            "upsertPrimaryAgent creates an agent on fresh DB",
            typeof agentForTests.id === "string",
          );
        } catch (e) {
          check("upsertPrimaryAgent creates an agent on fresh DB", false, e?.message ?? String(e));
        }
      }

      // 4. All expected tables exist
      try {
        const expectedTables = [
          "agents",
          "conversations",
          "messages",
          "knowledge",
          "episodes",
          "meta",
          "schema_migrations",
        ];
        const tablesRaw = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tableNames = tablesRaw.map((t) => t.name);
        const missing = expectedTables.filter((t) => !tableNames.includes(t));
        check("All expected tables exist", missing.length === 0, `Missing: ${missing.join(", ")}`);
      } catch (e) {
        check("All expected tables exist", false, e?.message ?? String(e));
      }

      // 5. setMetaValue and getMetaValue round-trip correctly
      try {
        setMetaValue(db, "test-xyz123", "value123");
        const val = getMetaValue(db, "test-xyz123");
        check("setMetaValue and getMetaValue round-trip correctly", val === "value123");
        db.prepare("DELETE FROM meta WHERE key = ?").run("test-xyz123");
      } catch (e) {
        check("setMetaValue and getMetaValue round-trip correctly", false, e?.message ?? String(e));
      }

      // 6. createConversation creates a record with valid ID
      let convId = "";
      try {
        const agent = agentForTests ?? getPrimaryAgent(db);
        const conv = createConversation(db, {
          agentId: agent ? agent.id : "test-agent-123",
          title: "Test Conv xyz123",
        });
        check(
          "createConversation creates a record with valid ID",
          typeof conv.id === "string" && conv.id.length > 0,
        );
        convId = conv.id;
      } catch (e) {
        check("createConversation creates a record with valid ID", false, e?.message ?? String(e));
      }

      // 7. appendMessage stores a message and retrieves it via listMessages
      try {
        if (convId) {
          appendMessage(db, { conversationId: convId, role: "user", content: "test-msg-xyz123" });
          const msgs = listMessages(db, convId);
          check(
            "appendMessage stores a message and retrieves it via listMessages",
            msgs.length > 0 && msgs[0].content === "test-msg-xyz123",
          );
        } else {
          check(
            "appendMessage stores a message and retrieves it via listMessages",
            false,
            "Skipped due to no convId",
          );
        }
      } catch (e) {
        check(
          "appendMessage stores a message and retrieves it via listMessages",
          false,
          e?.message ?? String(e),
        );
      }

      // 8. Foreign key constraints enforced
      try {
        let threw = false;
        try {
          appendMessage(db, {
            conversationId: "non-existent-conv-xyz123",
            role: "user",
            content: "fk-test",
          });
        } catch (e) {
          if (String(e?.message ?? e).includes("FOREIGN KEY constraint failed")) {
            threw = true;
          }
        }
        check("Foreign key constraints enforced", threw, "Did not throw foreign key error");
      } catch (e) {
        check("Foreign key constraints enforced", false, e?.message ?? String(e));
      }

      // 9. WAL mode active
      try {
        const mode = db.prepare("PRAGMA journal_mode").get();
        check("WAL mode active", String(mode.journal_mode ?? "").toLowerCase() === "wal");
      } catch (e) {
        check("WAL mode active", false, e?.message ?? String(e));
      }

      // 10. Knowledge table has source column
      try {
        const columns = db.prepare("PRAGMA table_info(knowledge)").all();
        const hasSource = columns.some((col) => col.name === "source");
        check("knowledge table has source column", hasSource, "Missing column: source");
      } catch (e) {
        check("knowledge table has source column", false, e?.message ?? String(e));
      }
    } finally {
      closeHiveDatabase(db);
    }
  } catch (err) {
    check("script crashed", false, err?.message ?? String(err));
  }

  console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
