/**
 * tui.ts — main blessed screen + layout.
 *
 * Orchestrates StatusBar, ChatBox, InputBox, and Spinner.
 * Exposes a clean API that chat.ts uses to drive the UI.
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

import { ChatBox } from "./chatBox.js";
import { InputBox } from "./inputBox.js";
import { Spinner } from "./spinner.js";
import { StatusBar, type StatusBarState } from "./statusBar.js";

export interface TUIOptions {
    agentName: string;
    provider: string;
    model: string;
    onInput: (text: string) => Promise<void>;
    onExit: () => void;
    onTab?: (partial: string) => string | undefined;
}

export class TUI {
    private screen: Blessed.Widgets.Screen;
    private statusBar: StatusBar;
    private chatBox: ChatBox;
    private inputBox: InputBox;
    private spinner: Spinner;
    private _inputBusy = false;

    constructor(opts: TUIOptions) {
        this.screen = blessed.screen({
            smartCSR: true,
            title: `hive — ${opts.agentName}`,
            fullUnicode: true,
            forceUnicode: true,
        });

        this.statusBar = new StatusBar({ screen: this.screen });
        this.statusBar.update({
            agentName: opts.agentName,
            provider: opts.provider,
            model: opts.model,
        });

        this.chatBox = new ChatBox({ screen: this.screen });
        this.spinner = new Spinner();

        this.inputBox = new InputBox({
            screen: this.screen,
            onSubmit: (value: string) => {
                if (this._inputBusy) return;
                this._inputBusy = true;

                // Echo user message (dimmed) into chatBox
                this.chatBox.append(`\x1b[2m${value}\x1b[0m`);
                this.chatBox.append("");

                void opts.onInput(value).finally(() => {
                    this._inputBusy = false;
                    this.inputBox.focus();
                });
            },
            onExit: opts.onExit,
            onTab: opts.onTab,
        });

        this.screen.on("resize", () => {
            this.screen.render();
        });

        this.screen.render();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    appendMessage(text: string): void {
        this.chatBox.append(text);
    }

    appendToken(token: string): void {
        this.chatBox.appendStreamToken(token);
    }

    flushStream(): void {
        this.chatBox.flushStream();
        this.chatBox.append("");
    }

    showSpinner(): void {
        this.spinner.start(
            (frame) => { this.chatBox.showSpinnerFrame(frame); },
            () => { this.chatBox.clearSpinner(); },
        );
    }

    hideSpinner(): void {
        this.spinner.stop();
    }

    updateStatus(state: Partial<StatusBarState>): void {
        this.statusBar.update(state);
    }

    clearChat(): void {
        this.chatBox.clear();
    }

    destroy(): void {
        try {
            this.spinner.stop();
            this.screen.destroy();
        } catch {
            // ignore
        }
    }

    focusInput(): void {
        this.inputBox.focus();
    }

    render(): void {
        this.screen.render();
    }
}
