/**
 * tui.ts — main blessed screen + layout.
 *
 * Orchestrates BannerPanel, StatusBar, ChatBox, InputBox,
 * CommandPicker, and Spinner.
 *
 * Layout (row 0..N from top):
 *   [0..bannerH-1]   BannerPanel (ASCII art, responsive)
 *   [bannerH]        StatusBar (1 row, dim info line)
 *   [bannerH+1..-4]  ChatBox (scrollable)
 *   [overlaid -5..-4]CommandPicker (floating, above input)
 *   [-3..0]          InputBox (3 rows, always focused)
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
import { BannerPanel } from "./bannerPanel.js";
import { CommandPicker } from "./commandPicker.js";
import { loadTUIColors, type TUIColors } from "./themeColors.js";

export interface TUIOptions {
    agentName: string;
    provider: string;
    model: string;
    onInput: (text: string) => Promise<void>;
    onExit: () => void;
}

export class TUI {
    private screen: Blessed.Widgets.Screen;
    private bannerPanel: BannerPanel;
    private statusBar: StatusBar;
    private chatBox: ChatBox;
    private inputBox: InputBox;
    private commandPicker: CommandPicker;
    private spinner: Spinner;
    private colors: TUIColors;
    private _inputBusy = false;

    constructor(opts: TUIOptions) {
        // Load theme colors once at startup
        this.colors = loadTUIColors();
        const colors = this.colors;

        this.screen = blessed.screen({
            smartCSR: true,
            title: `hive — ${opts.agentName}`,
            fullUnicode: true,
            forceUnicode: true,
        });

        // ── Banner (top, fixed height, responsive) ─────────────────────────────
        this.bannerPanel = new BannerPanel({ screen: this.screen, colors });
        const bannerH = this.bannerPanel.height(this.screen.width as number);

        // ── Status bar (row below banner) ─────────────────────────────────────
        this.statusBar = new StatusBar({
            screen: this.screen,
            colors,
            top: bannerH,
        });
        this.statusBar.update({
            agentName: opts.agentName,
            provider: opts.provider,
            model: opts.model,
        });

        // ── Chat box (from banner+statusBar to just above input) ──────────────
        this.chatBox = new ChatBox({
            screen: this.screen,
            colors,
            top: bannerH + 1,
        });

        // ── Spinner ───────────────────────────────────────────────────────────
        this.spinner = new Spinner();

        // ── Command picker (floating, above input box) ────────────────────────
        this.commandPicker = new CommandPicker({
            screen: this.screen,
            colors,
            onSelect: (insertText: string) => {
                this.inputBox.setValue(insertText);
                // Re-filter with new value — if it ends with space, hide picker
                this.commandPicker.update(insertText);
            },
            onDismiss: () => {
                // nothing extra needed
            },
        });

        // ── Input box (bottom, always focused) ────────────────────────────────
        this.inputBox = new InputBox({
            screen: this.screen,
            colors,
            onSubmit: (value: string) => {
                if (this._inputBusy) return;
                this._inputBusy = true;

                // Hide picker on submit
                this.commandPicker.hide();

                // Echo user message (dimmed)
                this.chatBox.append(`\x1b[2m${value}\x1b[0m`);
                this.chatBox.append("");

                void opts.onInput(value).finally(() => {
                    this._inputBusy = false;
                    this.inputBox.focus();
                });
            },
            onExit: opts.onExit,
            onValueChange: (value: string) => {
                // Update picker filter on every keystroke
                this.commandPicker.update(value);
            },
            onKeyForPicker: (keyName: string) => {
                return this.commandPicker.handleKey(keyName);
            },
        });

        // ── Resize ────────────────────────────────────────────────────────────
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

    getColors(): TUIColors {
        return this.colors;
    }
}
