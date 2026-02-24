import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { openHiveDatabase, closeHiveDatabase, getPrimaryAgent, getMetaValue, setMetaValue, createConversation, appendMessage, listMessages } from "../src/storage/db.js";

const HIVE_HOME = path.join(os.homedir(), ".hive");
const HIVE_DB_PATH = path.join(HIVE_HOME, "hive.db");

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
    console.log("--- Running test-db.ts ---");
    try {
        // 1. ~/.hive/hive.db exists and is readable
        let dbExists = fs.existsSync(HIVE_DB_PATH);
        if (!dbExists) {
            // maybe run just to create? Open database will create it. But let's check if it exists first.
            // Usually the daemon test will have created it.
        }
        check("~/.hive/hive.db exists and is readable", dbExists, "File not found");

        // 2. Can open connection via openHiveDatabase()
        let db: any;
        try {
            db = openHiveDatabase();
            check("Can open connection via openHiveDatabase()", true);
        } catch (e: any) {
            check("Can open connection via openHiveDatabase()", false, e.message);
            return; // Cannot proceed without DB
        }

        // 3. getPrimaryAgent() returns a valid agent record
        try {
            const agent = getPrimaryAgent(db);
            check("getPrimaryAgent() returns a valid agent record", agent !== null && typeof agent.id === "string");
        } catch (e: any) {
            check("getPrimaryAgent() returns a valid agent record", false, e.message);
        }

        // 4. All expected tables exist
        try {
            const expectedTables = ["agents", "conversations", "messages", "knowledge", "episodes", "meta", "schema_migrations"];
            const tablesRaw = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            const tableNames = tablesRaw.map((t: any) => t.name);

            let missing = expectedTables.filter(t => !tableNames.includes(t));
            check("All expected tables exist: agents, conversations, messages, knowledge, episodes, meta, schema_migrations", missing.length === 0, `Missing: ${missing.join(", ")}`);
        } catch (e: any) {
            check("All expected tables exist: agents, conversations, messages, knowledge, episodes, meta, schema_migrations", false, e.message);
        }

        // 5. setMetaValue and getMetaValue round-trip correctly
        try {
            setMetaValue(db, "test-xyz123", "value123");
            const val = getMetaValue(db, "test-xyz123");
            check("setMetaValue and getMetaValue round-trip correctly", val === "value123");
            db.prepare("DELETE FROM meta WHERE key = ?").run("test-xyz123");
        } catch (e: any) {
            check("setMetaValue and getMetaValue round-trip correctly", false, e.message);
        }

        // 6. createConversation creates a record with valid ID
        let convId = "";
        try {
            const agent = getPrimaryAgent(db);
            const conv = createConversation(db, { agentId: agent ? agent.id : "test-agent-123", title: "Test Conv xyz123" });
            check("createConversation creates a record with valid ID", typeof conv.id === "string" && conv.id.length > 0);
            convId = conv.id;
        } catch (e: any) {
            check("createConversation creates a record with valid ID", false, e.message);
        }

        // 7. appendMessage stores a message and retrieves it via listMessages
        try {
            if (convId) {
                appendMessage(db, { conversationId: convId, role: "user", content: "test-msg-xyz123" });
                const msgs = listMessages(db, convId);
                check("appendMessage stores a message and retrieves it via listMessages", msgs.length > 0 && msgs[0].content === "test-msg-xyz123");
            } else {
                check("appendMessage stores a message and retrieves it via listMessages", false, "Skipped due to no convId");
            }
        } catch (e: any) {
            check("appendMessage stores a message and retrieves it via listMessages", false, e.message);
        }

        // 8. Foreign key constraints enforced
        try {
            let threw = false;
            try {
                appendMessage(db, { conversationId: "non-existent-conv-xyz123", role: "user", content: "fk-test" });
            } catch (e: any) {
                if (e.message.includes("FOREIGN KEY constraint failed")) {
                    threw = true;
                }
            }
            check("Foreign key constraints enforced", threw, "Did not throw foreign key error");
        } catch (e: any) {
            check("Foreign key constraints enforced", false, e.message);
        }

        // 9. WAL mode active
        try {
            const mode = db.prepare("PRAGMA journal_mode").get();
            check("WAL mode active", mode.journal_mode.toLowerCase() === "wal");
        } catch (e: any) {
            check("WAL mode active", false, e.message);
        }

        // Clean up
        try {
            if (convId) {
                db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(convId);
                db.prepare("DELETE FROM conversations WHERE id = ?").run(convId);
            }
        } catch (e: any) {
            // ignore
        }

        // 10. Close connection cleanly
        try {
            closeHiveDatabase(db);
            check("Close connection cleanly", true);
        } catch (e: any) {
            check("Close connection cleanly", false, e.message);
        }

    } catch (err: any) {
        check("script crashed", false, err.message);
    }

    console.log(`\nSummary: ${passed}/${passed + failed} checks passed.\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
