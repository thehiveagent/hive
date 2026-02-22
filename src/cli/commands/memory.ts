import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { Command } from "commander";

import {
  clearEpisodes,
  getPrimaryAgent,
  insertKnowledge,
  listKnowledge,
  openHiveDatabase,
  closeHiveDatabase,
} from "../../storage/db.js";
import { renderError, renderHiveHeader, renderInfo, renderSuccess } from "../ui.js";

export function registerMemoryCommand(program: Command): void {
  const memory = program.command("memory").description("Manage Hive memory");

  memory
    .command("list")
    .description("list knowledge graph entries")
    .action(async () => {
      const db = openHiveDatabase();
      try {
        const rows = listKnowledge(db, { limit: 1000 });
        if (rows.length === 0) {
          renderInfo("No knowledge stored.");
          return;
        }

        rows.forEach((row, index) => {
          const pinnedLabel = row.pinned ? " (pinned)" : "";
          renderInfo(`${index + 1}. ${row.content}${pinnedLabel}`);
        });
      } finally {
        closeHiveDatabase(db);
      }
    });

  memory
    .command("clear")
    .description("clear episodic memory")
    .action(async () => {
      const confirm = await promptYesNo(
        "This will delete all episodic memories. Continue? (y/n) ",
      );
      if (!confirm) {
        renderInfo("Cancelled.");
        return;
      }

      const db = openHiveDatabase();
      try {
        clearEpisodes(db);
        renderSuccess("Episodes cleared.");
      } finally {
        closeHiveDatabase(db);
      }
    });

  memory
    .command("show")
    .description("show current persona")
    .action(() => {
      const db = openHiveDatabase();
      try {
        const agent = getPrimaryAgent(db);
        if (!agent) {
          renderError("Hive is not initialized. Run `hive init` first.");
          return;
        }

        renderHiveHeader("Persona");
        renderInfo(agent.persona);
      } finally {
        closeHiveDatabase(db);
      }
    });

  memory
    .command("add <fact>")
    .description("add a fact to the knowledge graph")
    .action(async (fact: string) => {
      const db = openHiveDatabase();
      try {
        insertKnowledge(db, { content: fact });
        renderSuccess("✓ Added.");
      } finally {
        closeHiveDatabase(db);
      }
    });

  memory
    .command("pin <fact>")
    .description("add and pin a fact to the knowledge graph")
    .action(async (fact: string) => {
      const db = openHiveDatabase();
      try {
        insertKnowledge(db, { content: fact, pinned: true });
        renderSuccess("✓ Pinned.");
      } finally {
        closeHiveDatabase(db);
      }
    });
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
  });

  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
