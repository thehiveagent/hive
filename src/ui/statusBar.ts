/**
 * statusBar.ts — top status bar (1 row, fixed).
 *
 * Shows: agentName · provider · model · ~N ctx tokens    [● daemon]
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

export interface StatusBarOptions {
    screen: Blessed.Widgets.Screen;
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

    constructor({ screen }: StatusBarOptions) {
        this.state = { agentName: "hive", provider: "", model: "" };

        this.box = blessed.box({
            parent: screen,
            top: 0,
            left: 0,
            width: "100%",
            height: 1,
            tags: true,
            style: {
                fg: "white",
                bg: "black",
                bold: false,
            },
        });
    }

    update(state: Partial<StatusBarState>): void {
        Object.assign(this.state, state);
        this._render();
    }

    private _render(): void {
        const { agentName, provider, model, ctxTokens, daemonRunning } = this.state;

        const left = [agentName, provider, model].filter(Boolean).join(" · ");
        const ctxPart = ctxTokens !== undefined ? ` · ~${ctxTokens} ctx` : "";
        const daemonDot =
            daemonRunning === true
                ? "{green-fg}●{/green-fg} running"
                : daemonRunning === false
                    ? "{red-fg}○{/red-fg} stopped"
                    : "";

        const content = ` ${left}${ctxPart}${daemonDot ? "    " + daemonDot : ""}`;
        this.box.setContent(content);
        this.box.screen.render();
    }
}
