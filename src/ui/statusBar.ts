/**
 * statusBar.ts — top status bar (1 row, fixed).
 *
 * Shows: agentName · provider · model · ~N ctx tokens    [● daemon]
 * Transparent background, theme-colored text.
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";
import type { TUIColors } from "./themeColors.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

export interface StatusBarOptions {
    screen: Blessed.Widgets.Screen;
    colors: TUIColors;
    /** Row offset (below the banner panel) */
    top: number;
}

export interface StatusBarState {
    agentName: string;
    provider: string;
    model: string;
    ctxTokens?: number;
    daemonRunning?: boolean;
}

export class StatusBar {
    private box: Blessed.Widgets.BoxElement;
    private state: StatusBarState;
    private colors: TUIColors;

    constructor({ screen, colors, top }: StatusBarOptions) {
        this.state = { agentName: "hive", provider: "", model: "" };
        this.colors = colors;

        this.box = blessed.box({
            parent: screen,
            top,
            left: 0,
            width: "100%",
            height: 1,
            tags: false,
            style: {
                fg: colors.dim,
                // no bg — transparent
            },
        });
    }

    update(state: Partial<StatusBarState>): void {
        Object.assign(this.state, state);
        this._render();
    }

    /** Returns the screen row this bar occupies */
    get top(): number {
        return (this.box as Blessed.Widgets.BoxElement & { top: number }).top as number;
    }

    private _render(): void {
        const { agentName, provider, model, ctxTokens, daemonRunning } = this.state;
        const { accent, dim } = this.colors;

        const left = [agentName, provider, model].filter(Boolean).join(" · ");
        const ctxPart = ctxTokens !== undefined ? ` · ~${ctxTokens} ctx` : "";

        // Use ANSI escape codes since tags: false is set
        const daemonDot =
            daemonRunning === true
                ? `\x1b[32m●\x1b[0m running`
                : daemonRunning === false
                    ? `\x1b[31m○\x1b[0m stopped`
                    : "";

        // Color the main info with accent
        const mainPart = `\x1b[38;2;${hexToRgb(accent)}\x1b[m ${left}${ctxPart}`;
        const content = mainPart + (daemonDot ? `    ${daemonDot}` : "");

        void dim; // used implicitly via constructor style
        this.box.setContent(content);
        this.box.screen.render();
    }
}

function hexToRgb(hex: string): string {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `${r};${g};${b}m`;
}
