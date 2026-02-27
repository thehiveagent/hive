/**
 * renderer.ts — message formatting for chatBox content.
 * All functions return strings (with ANSI codes) — no console.log.
 */

// ANSI helpers (no chalk dependency in TUI layer to avoid conflicts)
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

/**
 * Format a user-submitted message (subtly dimmed + right-justified marker).
 */
export function formatUserMessage(text: string): string {
    return `${DIM}${text}${RESET}`;
}

/**
 * Format an agent reply – applies minimal markdown-lite rendering:
 *   **bold**, *italic*, `code`, # Heading → just dimmed, ``` fences kept plain
 */
export function formatAgentMessage(text: string): string {
    return applyMarkdownLite(text);
}

/**
 * Format an info/system message.
 */
export function formatInfo(text: string): string {
    return `${DIM}${text}${RESET}`;
}

/**
 * Format a success message.
 */
export function formatSuccess(text: string): string {
    return `${GREEN}✓${RESET} ${text}`;
}

/**
 * Format an error message.
 */
export function formatError(text: string): string {
    return `${RED}${text}${RESET}`;
}

/**
 * Format a warning / amber message.
 */
export function formatWarning(text: string): string {
    return `${YELLOW}${text}${RESET}`;
}

/**
 * Format an agent label shown once at the very start.
 */
export function formatAgentLabel(agentName: string): string {
    return `${CYAN}${BOLD}${agentName}${RESET}`;
}

/**
 * A separator line (dim dashes).
 */
export function formatSeparator(char = "────"): string {
    return `${DIM}${char}${RESET}`;
}

// ---------------------------------------------------------------------------
// Markdown-lite renderer
// ---------------------------------------------------------------------------

function applyMarkdownLite(text: string): string {
    const lines = text.split("\n");
    const out: string[] = [];

    let inFence = false;

    for (const line of lines) {
        // Code fences — toggle, pass through plain
        if (line.trimStart().startsWith("```")) {
            inFence = !inFence;
            out.push(`${DIM}${line}${RESET}`);
            continue;
        }

        if (inFence) {
            // Code block content — dim
            out.push(`${DIM}${line}${RESET}`);
            continue;
        }

        // Headings
        const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
        if (headingMatch) {
            out.push(`${BOLD}${headingMatch[2]}${RESET}`);
            continue;
        }

        // Inline: **bold**, *italic*, `code`
        let formatted = line;
        formatted = formatted.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);
        formatted = formatted.replace(/\*(.+?)\*/g, `$1`); // italic → plain
        formatted = formatted.replace(/`([^`]+)`/g, `${DIM}$1${RESET}`);

        out.push(formatted);
    }

    return out.join("\n");
}
