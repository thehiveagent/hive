import type { TaskRecord, TaskStatus } from "../../storage/db.js";

export type TaskGroups = Record<TaskStatus, TaskRecord[]>;

export function groupTasks(tasks: TaskRecord[]): TaskGroups {
  return tasks.reduce(
    (acc, task) => {
      acc[task.status].push(task);
      return acc;
    },
    { queued: [], running: [], done: [], failed: [] } as TaskGroups,
  );
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return "unknown";
  }

  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return "unknown";
  }

  const deltaMs = Date.now() - t;
  if (deltaMs < 0) {
    return "just now";
  }

  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) {
    return "yesterday";
  }

  return `${days} days ago`;
}

export function formatDuration(startedAt: string | null, completedAt: string | null): string {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  const end = completedAt ? Date.parse(completedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "unknown";
  }

  const minutes = Math.floor((end - start) / 60000);
  if (minutes < 1) {
    return "<1m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remaining}m`;
}
