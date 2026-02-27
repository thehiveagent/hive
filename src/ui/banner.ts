import { readFileSync } from "node:fs";

const WORDMARK_LINES = [
    "  ██╗  ██╗██╗██╗   ██╗███████╗",
    "  ██║  ██║██║██║   ██║██╔════╝",
    "  ███████║██║██║   ██║█████╗  ",
    "  ██╔══██║██║╚██╗ ██╔╝██╔══╝  ",
    "  ██║  ██║██║ ╚████╔╝ ███████╗",
    "  ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝",
] as const;

function getVersion(): string {
    try {
        const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
            return parsed.version.trim();
        }
    } catch {
        // ignore
    }
    return "0.0.0";
}

/**
 * Prints the HIVE ASCII banner + version to stdout.
 * Must be called BEFORE blessed screen is created so it appears above the TUI.
 */
export function printBanner(): void {
    const version = getVersion();

    // Use raw stdout.write so it always goes through, even if chalk is unavailable.
    process.stdout.write("\n");
    for (const line of WORDMARK_LINES) {
        process.stdout.write(`\x1b[1m\x1b[36m${line}\x1b[0m\n`);
    }
    process.stdout.write("\n");
    process.stdout.write(`\x1b[2m  v${version}\x1b[0m\n`);
    process.stdout.write("\n");
}
