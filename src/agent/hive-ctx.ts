import type { AgentRecord } from "../storage/db.js";

type HiveCtxModule = {
  HiveCtx: new (config: {
    storagePath: string;
    budgetTokens?: number;
    model?: string;
    profile?: Record<string, string>;
  }) => {
    build(message: string): Promise<{
      systemPrompt: string;
      tokenCount: number;
    }>;
    remember(fact: string, options?: { pinned?: boolean }): Promise<void> | void;
    episode(message: string, response: string): Promise<void> | void;
  };
};

export interface HiveCtxSession {
  build(message: string): Promise<{ system: string; tokens: number }>;
  remember(fact: string, options?: { pinned?: boolean }): Promise<void>;
  episode(message: string, response: string): Promise<void>;
}

export interface InitializeHiveCtxSessionInput {
  storagePath: string;
  profile: AgentRecord;
  model?: string;
}

export interface InitializeHiveCtxSessionResult {
  session: HiveCtxSession | null;
  usingHiveCtx: boolean;
  warning?: string;
}

const HIVE_CTX_FALLBACK_WARNING = "· hive-ctx not found — using legacy context pipeline";

export async function initializeHiveCtxSession(
  input: InitializeHiveCtxSessionInput,
): Promise<InitializeHiveCtxSessionResult> {
  try {
    const moduleUrl = new URL(
      "../../hive-ctx/packages/bindings/dist/index.js",
      import.meta.url,
    ).href;
    const loaded = (await import(moduleUrl)) as Partial<HiveCtxModule>;

    if (typeof loaded.HiveCtx !== "function") {
      throw new Error("HiveCtx export is missing.");
    }

    const hiveCtx = new loaded.HiveCtx({
      storagePath: input.storagePath,
      model: input.model,
      profile: toHiveCtxProfile(input.profile),
    });

    return {
      session: {
        async build(message: string): Promise<{ system: string; tokens: number }> {
          const result = await hiveCtx.build(message);
          return {
            system: result.systemPrompt,
            tokens: result.tokenCount,
          };
        },
        async remember(fact: string, options?: { pinned?: boolean }): Promise<void> {
          if (options?.pinned) {
            try {
              await Promise.resolve(
                hiveCtx.remember(fact, { pinned: true }),
              );
              return;
            } catch {
              // Older hive-ctx versions may not support options.
            }
          }

          await Promise.resolve(hiveCtx.remember(fact));
        },
        async episode(message: string, response: string): Promise<void> {
          await Promise.resolve(hiveCtx.episode(message, response));
        },
      },
      usingHiveCtx: true,
    };
  } catch {
    return {
      session: null,
      usingHiveCtx: false,
      warning: HIVE_CTX_FALLBACK_WARNING,
    };
  }
}

function toHiveCtxProfile(profile: AgentRecord): Record<string, string> {
  const entries: Array<[string, string | null | undefined]> = [
    ["name", profile.name],
    ["agent_name", profile.agent_name],
    ["persona", profile.persona],
    ["dob", profile.dob],
    ["location", profile.location],
    ["profession", profile.profession],
    ["about_raw", profile.about_raw],
  ];

  return entries.reduce<Record<string, string>>((acc, [key, value]) => {
    const normalized = value?.trim();
    if (normalized && normalized.length > 0) {
      acc[key] = normalized;
    }
    return acc;
  }, {});
}
