import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { Command } from "commander";

import {
  cancelTask,
  clearCompletedTasks,
  closeHiveDatabase,
  getHiveHomeDir,
  getPrimaryAgent,
  getTaskById,
  insertTask,
  listTasks,
  openHiveDatabase,
} from "../../storage/db.js";
import {
  renderError,
  renderHiveHeader,
  renderInfo,
  renderSeparator,
  renderSuccess,
} from "../ui.js";
import { formatDuration, formatRelativeTime, groupTasks } from "../helpers/tasks.js";
import { getTheme } from "../theme.js";

const DAEMON_DEFAULT_PORT = 2718;
const TCP_TIMEOUT_MS = 500;
const PROMPT_SYMBOL = "›";

export function registerTaskCommand(program: Command): void {
  const task = program.command("task").description("Manage background tasks");

  task
    .command("add")
    .description("Queue a background task")
    .argument("<description>", "task title / description")
    .action(async (description: string) => {
      await runTaskAddCommand(description);
    });

  task
    .command("list")
    .description("List tasks grouped by status")
    .action(async () => {
      await runTaskListCommand();
    });

  task
    .command("checkout")
    .description("Show full result for a task")
    .argument("<id>", "task id")
    .action(async (id: string) => {
      await runTaskCheckoutCommand(id);
    });

  task
    .command("cancel")
    .description("Cancel a queued or running task")
    .argument("<id>", "task id")
    .action(async (id: string) => {
      await runTaskCancelCommand(id);
    });

  task
    .command("clear")
    .description("Delete done/failed tasks (keeps queued/running)")
    .action(async () => {
      await runTaskClearCommand();
    });
}

export async function runTaskAddCommand(title: string): Promise<void> {
  renderHiveHeader("Task · Add");

  const normalized = title.trim();
  if (normalized.length === 0) {
    renderError("Task title is required.");
    return;
  }

  const db = openHiveDatabase();
  try {
    const agent = getPrimaryAgent(db);
    const id = createTaskId();
    insertTask(db, { id, title: normalized, agentId: agent?.id ?? null });

    // Best-effort: notify daemon to start working immediately.
    await sendDaemonCommand({
      type: "task",
      payload: { id, title: normalized, agent_id: agent?.id ?? null },
    });

    renderSuccess("✓ Task queued");
    renderInfo(`· ID     ${id}`);
    renderInfo(`· Title  ${normalized}`);
    renderInfo("· Run `hive task list` to check progress");
  } finally {
    closeHiveDatabase(db);
  }
}

export async function runTaskListCommand(): Promise<void> {
  renderHiveHeader("Tasks");
  renderSeparator();

  const db = openHiveDatabase();
  try {
    const tasks = listTasks(db);
    if (tasks.length === 0) {
      renderInfo("No tasks yet.");
      return;
    }

    const grouped = groupTasks(tasks);

    renderTaskSection("Running", grouped.running, (task) => {
      const started = formatRelativeTime(task.started_at);
      return `started ${started}`;
    });

    renderTaskSection("Queued", grouped.queued, () => "");

    renderTaskSection(
      "Done",
      grouped.done,
      (task) => {
        const completed = formatRelativeTime(task.completed_at);
        return completed;
      },
      { showCheck: true },
    );

    renderTaskSection("Failed", grouped.failed, (task) => {
      const completed = formatRelativeTime(task.completed_at);
      const suffix = task.error ? ` · ${task.error}` : "";
      return `${completed}${suffix}`;
    });
  } finally {
    closeHiveDatabase(db);
  }
}

export async function runTaskCheckoutCommand(id: string): Promise<void> {
  const normalized = id.trim();
  if (!normalized) {
    renderError("Task id is required.");
    return;
  }

  renderHiveHeader(`Task ${normalized}`);
  renderSeparator();

  const db = openHiveDatabase();
  try {
    const task = getTaskById(db, normalized);
    if (!task) {
      renderError(`Task not found: ${normalized}`);
      return;
    }

    renderInfo(`· Title      ${task.title}`);
    renderInfo(`· Status     ${task.status}`);
    renderInfo(`· Started    ${formatRelativeTime(task.started_at)}`);
    renderInfo(`· Completed  ${formatRelativeTime(task.completed_at)}`);
    renderInfo(`· Duration   ${formatDuration(task.started_at, task.completed_at)}`);
    renderSeparator();

    if (task.status !== "done") {
      if (task.status === "failed") {
        renderError(task.error ?? "Task failed.");
      } else {
        renderInfo("Task is not completed yet.");
      }
      return;
    }

    stdout.write("Result:\n");
    const accent = getTheme().accent;
    stdout.write(accent(`hive${PROMPT_SYMBOL} `));
    stdout.write(task.result ?? "(no result)");
    stdout.write("\n");
    renderSeparator();
  } finally {
    closeHiveDatabase(db);
  }
}

export async function runTaskCancelCommand(id: string): Promise<void> {
  const normalized = id.trim();
  if (!normalized) {
    renderError("Task id is required.");
    return;
  }

  renderHiveHeader("Task · Cancel");
  const db = openHiveDatabase();
  try {
    const ok = cancelTask(db, normalized);
    if (!ok) {
      renderError("Task not found, or not cancellable.");
      return;
    }

    // Best-effort: notify daemon to stop the active task loop early.
    await sendDaemonCommand({ type: "task_cancel", id: normalized });

    renderSuccess(`✓ Cancelled ${normalized}`);
  } finally {
    closeHiveDatabase(db);
  }
}

export async function runTaskClearCommand(): Promise<void> {
  renderHiveHeader("Task · Clear");
  const confirmed = await promptYesNo("This will delete all done/failed tasks. Continue? (y/n) ");
  if (!confirmed) {
    renderInfo("Cancelled.");
    return;
  }

  const db = openHiveDatabase();
  try {
    const deleted = clearCompletedTasks(db);
    renderSuccess(`✓ Cleared ${deleted} tasks.`);
  } finally {
    closeHiveDatabase(db);
  }
}

function createTaskId(): string {
  const hex = randomUUID().replace(/-/g, "").slice(0, 6);
  return `t-${hex}`;
}

function renderTaskSection(
  label: string,
  tasks: Array<{
    id: string;
    title: string;
    started_at: string | null;
    completed_at: string | null;
    error: string | null;
  }>,
  formatTail: (task: (typeof tasks)[number]) => string,
  options: { showCheck?: boolean } = {},
): void {
  renderInfo(`${label} (${tasks.length})`);
  if (tasks.length === 0) {
    renderInfo("");
    return;
  }

  for (const task of tasks) {
    const tail = formatTail(task);
    const suffix = tail ? `  ${tail}` : "";
    const check = options.showCheck ? "✓ " : "";
    renderInfo(`· ${task.id}  ${check}${task.title}${suffix}`);
  }

  renderInfo("");
}

async function promptYesNo(question: string): Promise<boolean> {
  if (!stdin.isTTY || !stdout.isTTY) {
    return false;
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function sendDaemonCommand(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const port = readDaemonPort();

  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(JSON.stringify(payload) + "\n");
    });

    let buffer = "";
    let responded = false;

    socket.on("data", (data: Buffer) => {
      if (responded) return;
      buffer += data.toString();
      try {
        const response = JSON.parse(buffer) as Record<string, unknown>;
        responded = true;
        socket.end();
        resolve(response);
      } catch {
        // wait for more data
      }
    });

    socket.on("error", () => {
      if (!responded) {
        socket.destroy();
        resolve(null);
      }
    });

    socket.setTimeout(TCP_TIMEOUT_MS, () => {
      if (!responded) {
        socket.destroy();
        resolve(null);
      }
    });
  });
}

function readDaemonPort(): number {
  // Fall back to file-based port used by status/daemon commands.
  try {
    const content = readFileSync(`${getHiveHomeDir()}/daemon.port`, "utf8").trim();
    const port = Number.parseInt(content, 10);
    return Number.isFinite(port) ? port : DAEMON_DEFAULT_PORT;
  } catch {
    return DAEMON_DEFAULT_PORT;
  }
}
