/**
 * tui.ts — main blessed screen + layout.
 *
 * Orchestrates StatusBar, ChatBox, InputBox, and Spinner.
 * Exposes a clean API that chat.ts uses to drive the UI.
 */
import * as blessed from "blessed";

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
    private screen: blessed.Widgets.Screen;
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

                // Echo user message to chatBox (dimmed)
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

        // Resize handler — blessed handles most of it, just re-render
        this.screen.on("resize", () => {
            this.screen.render();
        });

        this.screen.render();
    }

    // ---------------------------------------------------------------------------
    // Public API used by chat.ts
    // ---------------------------------------------------------------------------

    /** Append a complete message/line to chatBox */
    appendMessage(text: string): void {
        this.chatBox.append(text);
    }

    /** Append a streaming token (buffered by chatBox) */
    appendToken(token: string): void {
        this.chatBox.appendStreamToken(token);
    }

    /** Flush remaining streaming buffer at end of response */
    flushStream(): void {
        this.chatBox.flushStream();
        this.chatBox.append(""); // blank line after response
    }

    /** Show the thinking spinner inline in chatBox */
    showSpinner(): void {
        this.spinner.start(
            (frame) => {
                this.chatBox.showSpinnerFrame(frame);
            },
            () => {
                this.chatBox.clearSpinner();
            },
        );
    }

    /** Hide the thinking spinner */
    hideSpinner(): void {
        this.spinner.stop();
    }

    /** Update the status bar */
    updateStatus(state: Partial<StatusBarState>): void {
        this.statusBar.update(state);
    }

    /** Clear chatBox only (for /clear command) */
    clearChat(): void {
        this.chatBox.clear();
    }

    /** Destroy the blessed screen and restore terminal */
    destroy(): void {
        try {
            this.spinner.stop();
            this.screen.destroy();
        } catch {
            // ignore
        }
    }

    /** Re-focus the input box (e.g. after async command output) */
    focusInput(): void {
        this.inputBox.focus();
    }

    /** Render the screen */
    render(): void {
        this.screen.render();
    }
}
