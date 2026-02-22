import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import type { ProviderMessage } from "../providers/base.js";
import {
  type AgentRecord,
  type HiveDatabase,
  findRelevantEpisodes,
  getHiveHomeDir,
  listPinnedKnowledge,
} from "../storage/db.js";

const MAX_CONTEXT_TOKENS = 4000;

interface BuildPromptContextInput {
  agent: AgentRecord;
  db: HiveDatabase;
  userPrompt: string;
  modeAddition?: string;
}

interface PromptContextResult {
  systemMessages: ProviderMessage[];
  trimmedEpisodes: number;
}

export function buildPromptContext(input: BuildPromptContextInput): PromptContextResult {
  const pinned = listPinnedKnowledge(input.db);
  const relevantEpisodes = findRelevantEpisodes(input.db, input.userPrompt, 3);
  const promptsDirectory = join(getHiveHomeDir(), "prompts");

  const episodes: string[] = relevantEpisodes.map((item) => item.episode.content);
  const layers: Array<{ label: string; content: string }> = [
    {
      label: "Layer 1 — Base persona",
      content: input.agent.persona,
    },
    {
      label: "Layer 2 — User profile",
      content: renderProfile(input.agent),
    },
    {
      label: "Layer 3 — Pinned knowledge",
      content: pinned.length > 0
        ? pinned.map((item) => `- ${item.content}`).join("\n")
        : "(no pinned knowledge)",
    },
    {
      label: "Layer 4 — Episodic memories",
      content: renderEpisodes(episodes),
    },
    {
      label: "Layer 5 — Mode prompt",
      content: input.modeAddition?.trim() ?? "(no active mode)",
    },
    {
      label: "Layer 6 — Local prompts (~/.hive/prompts)",
      content: renderPromptFiles(promptsDirectory),
    },
    {
      label: "Layer 7 — Current date & time",
      content: renderNow(),
    },
  ];

  const assembled = assembleLayers(layers);
  const trimmedResult = trimToBudget({
    layers,
    episodes,
    assembled,
  });

  return {
    systemMessages: [
      {
        role: "system",
        content: trimmedResult.context,
      },
    ],
    trimmedEpisodes: trimmedResult.trimmedEpisodes,
  };
}

function renderProfile(agent: AgentRecord): string {
  const rows = [
    agent.name ? `Name: ${agent.name}` : null,
    agent.dob ? `DOB: ${agent.dob}` : null,
    agent.location ? `Location: ${agent.location}` : null,
    agent.profession ? `Profession: ${agent.profession}` : null,
    agent.about_raw ? `About: ${agent.about_raw}` : null,
  ].filter(Boolean) as string[];

  return rows.length > 0 ? rows.join("\n") : "(no profile data)";
}

function renderEpisodes(episodes: string[]): string {
  if (episodes.length === 0) {
    return "(no relevant memories)";
  }

  return episodes.map((episode, index) => `#${index + 1}: ${episode}`).join("\n");
}

function renderPromptFiles(promptsDirectory: string): string {
  try {
    const files = collectPromptFiles(promptsDirectory);
    if (files.length === 0) {
      return "(no local prompt files found)";
    }

    return files
      .map((filePath) => {
        const body = readFileSync(filePath, "utf8").trim();
        const relativePath = relative(promptsDirectory, filePath);
        const heading = `[${relativePath}]`;
        return body.length > 0 ? `${heading}\n${body}` : `${heading}\n(empty file)`;
      })
      .join("\n\n");
  } catch {
    return "(unable to read ~/.hive/prompts)";
  }
}

function collectPromptFiles(directory: string): string[] {
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectPromptFiles(entryPath));
        continue;
      }

      if (entry.isFile()) {
        files.push(entryPath);
      }
    }

    return files.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function renderNow(): string {
  const now = new Date();
  return `${now.toISOString()} (local: ${now.toLocaleString()})`;
}

function assembleLayers(layers: Array<{ label: string; content: string }>): string {
  return layers
    .map((layer) => `${layer.label}\n${layer.content}`)
    .join("\n\n");
}

function trimToBudget(input: {
  layers: Array<{ label: string; content: string }>;
  episodes: string[];
  assembled: string;
}): { context: string; trimmedEpisodes: number } {
  if (countWords(input.assembled) <= MAX_CONTEXT_TOKENS) {
    return { context: input.assembled, trimmedEpisodes: 0 };
  }

  const trimmedEpisodes = [...input.episodes];
  let context = input.assembled;

  while (trimmedEpisodes.length > 0 && countWords(context) > MAX_CONTEXT_TOKENS) {
    trimmedEpisodes.pop();
    context = assembleLayers([
      input.layers[0],
      input.layers[1],
      input.layers[2],
      {
        label: input.layers[3].label,
        content: renderEpisodes(trimmedEpisodes),
      },
      input.layers[4],
      input.layers[5],
      input.layers[6],
    ]);
  }

  if (countWords(context) > MAX_CONTEXT_TOKENS) {
    const words = context.split(/\s+/);
    context = `${words.slice(0, MAX_CONTEXT_TOKENS).join(" ")} …`;
  }

  const removed = input.episodes.length - trimmedEpisodes.length;
  return { context, trimmedEpisodes: removed > 0 ? removed : 0 };
}

function countWords(value: string): number {
  return value.trim().length === 0 ? 0 : value.trim().split(/\s+/).length;
}
