/**
 * chatBox.ts — scrollable message history panel.
 *
 * Uses blessed's `log` widget which auto-scrolls on append.
 * Sits between the status bar (top: 1) and input box (bottom: 3).
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

export interface ChatBoxOptions {
    screen: Blessed.Widgets.Screen;
}

export class ChatBox {
    private log: Blessed.Widgets.Log;
    private _spinnerLine = "";
    private _hasSpinner = false;

    constructor({ screen }: ChatBoxOptions) {
        this.log = blessed.log({
            parent: screen,
            top: 1,
            left: 0,
            width: "100%",
            bottom: 3,
            tags: false,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: "│",
                style: { fg: "grey" },
            },
            mouse: true,
            keys: true,
            vi: true,
            style: {
                fg: "white",
                bg: "black",
            },
            padding: { left: 1, right: 1 },
        });
    }

    append(text: string): void {
        const lines = text.split("\n");
        for (const line of lines) {
            this.log.log(line);
        }
        this.log.setScrollPerc(100);
        this.log.screen.render();
    }

    appendStreamToken(token: string): void {
        if (this._hasSpinner) {
            this._hasSpinner = false;
            this._spinnerLine = "";
        }

        this._spinnerLine += token;

        if (token.includes("\n")) {
            const parts = this._spinnerLine.split("\n");
            for (let i = 0; i < parts.length - 1; i++) {
                this.log.log(parts[i]!);
            }
            this._spinnerLine = parts[parts.length - 1]!;
        }

        this.log.setScrollPerc(100);
        this.log.screen.render();
    }

    flushStream(): void {
        if (this._spinnerLine.length > 0) {
            this.log.log(this._spinnerLine);
            this._spinnerLine = "";
        }
        this.log.setScrollPerc(100);
        this.log.screen.render();
    }

    showSpinnerFrame(text: string): void {
        if (!this._hasSpinner) {
            this._hasSpinner = true;
            this.log.log(text);
        } else {
            const content = (this.log as unknown as { _clines?: { fake?: string[] } })._clines;
            if (content && Array.isArray(content.fake) && content.fake.length > 0) {
                content.fake[content.fake.length - 1] = text;
            }
            this.log.setScrollPerc(100);
            this.log.screen.render();
        }
    }

    clearSpinner(): void {
        if (this._hasSpinner) {
            this._hasSpinner = false;
            this._spinnerLine = "";
            const raw = this.log.getContent();
            const lines = raw.split("\n");
            if (lines.length > 0) lines.pop();
            this.log.setContent(lines.join("\n"));
            this.log.setScrollPerc(100);
            this.log.screen.render();
        }
    }

    clear(): void {
        this.log.setContent("");
        this._spinnerLine = "";
        this._hasSpinner = false;
        this.log.screen.render();
    }
}
