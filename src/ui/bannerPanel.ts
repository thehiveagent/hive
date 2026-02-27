/**
 * bannerPanel.ts — persistent ASCII HIVE art panel at top of blessed screen.
 *
 * - Full art (6 rows + 2 rows padding = 8 total) shown when terminal ≥ 48 cols wide.
 * - Compact single-line "HIVE" label shown when narrower.
 * - Reflows on terminal resize.
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";
import { readFileSync } from "node:fs";
import type { TUIColors } from "./themeColors.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

const WORDMARK_LINES = [
    "  ██╗  ██╗██╗██╗   ██╗███████╗",
    "  ██║  ██║██║██║   ██║██╔════╝",
    "  ███████║██║██║   ██║█████╗  ",
    "  ██╔══██║██║╚██╗ ██╔╝██╔══╝  ",
    "  ██║  ██║██║ ╚████╔╝ ███████╗",
    "  ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝",
] as const;

const FULL_HEIGHT = WORDMARK_LINES.length + 2; // art + blank line top + version line
const COMPACT_HEIGHT = 1;
const MIN_WIDTH_FOR_FULL = 48;

function getVersion(): string {
    try {
        const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (typeof parsed.version === "string") return parsed.version.trim();
    } catch {
        // ignore
    }
    return "0.0.0";
}

export class BannerPanel {
    private box: Blessed.Widgets.BoxElement;
    private colors: TUIColors;
    private version: string;

    constructor({ screen, colors }: { screen: Blessed.Widgets.Screen; colors: TUIColors }) {
        this.colors = colors;
        this.version = getVersion();

        this.box = blessed.box({
            parent: screen,
            top: 0,
            left: 0,
            width: "100%",
            height: this._height(screen.width as number),
            tags: false,
            style: {
                fg: colors.accent,
                // transparent — no bg set
            },
        });

        screen.on("resize", () => {
            const w = screen.width as number;
            (this.box as Blessed.Widgets.BoxElement & { height: number }).height = this._height(w);
            this._draw(w);
            screen.render();
        });

        this._draw(screen.width as number);
    }

    /** How tall is the banner? Depends on current terminal width. */
    height(screenWidth: number): number {
        return this._height(screenWidth);
    }

    private _height(w: number): number {
        return w >= MIN_WIDTH_FOR_FULL ? FULL_HEIGHT : COMPACT_HEIGHT;
    }

    private _draw(w: number): void {
        if (w >= MIN_WIDTH_FOR_FULL) {
            // Full ASCII art centered
            const lines: string[] = [""];
            for (const line of WORDMARK_LINES) {
                const padding = Math.max(0, Math.floor((w - line.length) / 2));
                lines.push(" ".repeat(padding) + line);
            }
            const versionStr = `v${this.version}`;
            const vPad = Math.max(0, Math.floor((w - versionStr.length) / 2));
            lines.push(" ".repeat(vPad) + versionStr);
            this.box.setContent(lines.join("\n"));
        } else {
            // Compact: just "◆ HIVE  v0.x.x" on one line
            this.box.setContent(` ◆ HIVE  v${this.version}`);
        }
    }
}
