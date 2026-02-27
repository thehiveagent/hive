/**
 * inputBox.ts — bottom-fixed input rectangle.
 *
 * Transparent background, theme-colored focused border.
 * Delegates keypress events to CommandPicker when picker is active.
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";
import type { TUIColors } from "./themeColors.js";
import type { CommandPicker } from "./commandPicker.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

export interface InputBoxOptions {
    screen: Blessed.Widgets.Screen;
    colors: TUIColors;
    onSubmit: (value: string) => void;
    onExit: () => void;
    /** Called on every keypress with the current input value, for picker filtering */
    onValueChange?: (value: string) => void;
    /** Called with the current key name first — if picker handles it, skip default */
    onKeyForPicker?: (keyName: string) => boolean;
}

export class InputBox {
    private textarea: Blessed.Widgets.TextareaElement;
    private screen: Blessed.Widgets.Screen;

    constructor({ screen, colors, onSubmit, onExit, onValueChange, onKeyForPicker }: InputBoxOptions) {
        this.screen = screen;

        this.textarea = blessed.textarea({
            parent: screen,
            bottom: 0,
            left: 0,
            width: "100%",
            height: 3,
            inputOnFocus: true,
            keys: true,
            mouse: true,
            style: {
                fg: "white",
                // no bg — transparent
                border: { fg: colors.borderDim },
                focus: { border: { fg: colors.borderFocus } },
            },
            border: { type: "line" },
            padding: { left: 1 },
        });

        this.textarea.on("keypress", (ch: string, key: Blessed.Widgets.Events.IKeyEventArg) => {
            const name = key?.name ?? "";
            const shift = key?.shift ?? false;
            const ctrl = key?.ctrl ?? false;

            // Exit
            if (ctrl && (name === "c" || name === "d")) { onExit(); return; }
            if (name === "escape") {
                // If picker is visible and handles escape, don't exit
                if (onKeyForPicker?.("escape")) return;
                onExit();
                return;
            }

            // Up/Down — delegate to picker if visible
            if (name === "up" || name === "down") {
                if (onKeyForPicker?.(name)) return;
                // Otherwise do nothing (no history traversal in TUI mode)
                return;
            }

            // Enter — delegate to picker if visible; otherwise submit
            if (name === "enter" || name === "return") {
                if (!shift) {
                    if (onKeyForPicker?.(name)) return;
                    const value = this.textarea.getValue().trim();
                    if (value.length > 0) {
                        this.textarea.clearValue();
                        screen.render();
                        onSubmit(value);
                    }
                    return;
                }
                // Shift+Enter → newline (let blessed handle)
                return;
            }

            // Tab — consume (picker handles it via onKeyForPicker)
            if (name === "tab") {
                if (onKeyForPicker?.("tab")) return;
                key.name = "";
                return;
            }

            // After every other keypress, notify of value change for picker filtering
            // We use setImmediate so the textarea value is updated first
            setImmediate(() => {
                onValueChange?.(this.textarea.getValue());
            });

            void ch;
        });

        this.textarea.focus();

        screen.on("click", () => {
            this.textarea.focus();
        });
    }

    /** Programmatically set the input value (e.g. from picker selection) */
    setValue(value: string): void {
        this.textarea.setValue(value);
        this.screen.render();
    }

    clear(): void {
        this.textarea.clearValue();
    }

    focus(): void {
        this.textarea.focus();
    }

    getCurrentValue(): string {
        return this.textarea.getValue();
    }
}
