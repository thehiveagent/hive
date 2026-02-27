/**
 * chatBox.ts — scrollable message history panel.
 *
 * Uses blessed's `log` widget which auto-scrolls on append.
 * Sits between the status bar (top: 1) and input box (bottom: 3).
 */
import * as blessed from "blessed";

export interface ChatBoxOptions {
    screen: blessed.Widgets.Screen;
}

export class ChatBox {
    private log: blessed.Widgets.Log;
    /** Tracks the current streaming line so we can replace it with spinner updates */
    private _spinnerLine = "";
    private _hasSpinner = false;

    constructor({ screen }: ChatBoxOptions) {
        this.log = blessed.log({
            parent: screen,
            top: 1,
            left: 0,
            width: "100%",
            // leaves room for status bar (1) + input box (3)
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

    /**
     * Append a complete line (or block) to the chat history.
     */
    append(text: string): void {
        // Split multi-line text and log each line
        const lines = text.split("\n");
        for (const line of lines) {
            this.log.log(line);
        }
        this.log.setScrollPerc(100);
        this.log.screen.render();
    }

    /**
     * For streaming: append a raw token chunk to the LAST line.
     * We accumulate tokens into a buffer line and re-render it.
     */
    appendStreamToken(token: string): void {
        // If spinner is active, first clear it
        if (this._hasSpinner) {
            this._hasSpinner = false;
            this._spinnerLine = "";
        }

        // We rely on log.log for full lines; for streaming we write to a buffer
        // and only flush on newline tokens.
        this._spinnerLine += token;

        if (token.includes("\n")) {
            const parts = this._spinnerLine.split("\n");
            // All complete lines
            for (let i = 0; i < parts.length - 1; i++) {
                this.log.log(parts[i]!);
            }
            // Remainder starts new buffer
            this._spinnerLine = parts[parts.length - 1]!;
        }

        this.log.setScrollPerc(100);
        this.log.screen.render();
    }

    /**
     * Flush any remaining streaming buffer (called at end of stream).
     */
    flushStream(): void {
        if (this._spinnerLine.length > 0) {
            this.log.log(this._spinnerLine);
            this._spinnerLine = "";
        }
        this.log.setScrollPerc(100);
        this.log.screen.render();
    }

    /**
     * Show spinner frame text as an updating "thinking..." indicator.
     */
    showSpinnerFrame(text: string): void {
        if (!this._hasSpinner) {
            this._hasSpinner = true;
            // Append a line that we will visually update — blessed log doesn't
            // support in-place edit, so we use a side-channel: update the last
            // item in the underlying content by delegating to a live label.
            this.log.log(text);
        } else {
            // Replace the last line in the log by trimming and re-appending.
            // blessed log content is a string; we can manipulate it directly.
            const content = (this.log as unknown as { _clines?: { fake?: string[] } })._clines;
            if (content && Array.isArray(content.fake) && content.fake.length > 0) {
                content.fake[content.fake.length - 1] = text;
            }
            this.log.setScrollPerc(100);
            this.log.screen.render();
        }
    }

    /**
     * Clear the spinner line (called when spinner stops or first real token arrives).
     */
    clearSpinner(): void {
        if (this._hasSpinner) {
            this._hasSpinner = false;
            this._spinnerLine = "";
            // Remove the last line from the log content
            const raw = this.log.getContent();
            const lines = raw.split("\n");
            if (lines.length > 0) lines.pop();
            this.log.setContent(lines.join("\n"));
            this.log.setScrollPerc(100);
            this.log.screen.render();
        }
    }

    /**
     * Clear all chat content (for /clear command).
     */
    clear(): void {
        this.log.setContent("");
        this._spinnerLine = "";
        this._hasSpinner = false;
        this.log.screen.render();
    }
}
