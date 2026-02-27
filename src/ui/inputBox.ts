/**
 * inputBox.ts — bottom-fixed input rectangle.
 *
 * - Always focused.
 * - Enter → submits.
 * - Shift+Enter → newline.
 * - Ctrl+C / Escape → triggers exit callback.
 * - Tab → triggers tab callback (for command suggestion cycling).
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

export interface InputBoxOptions {
    screen: Blessed.Widgets.Screen;
    onSubmit: (value: string) => void;
    onExit: () => void;
    onTab?: (partial: string) => string | undefined;
}

export class InputBox {
    private textarea: Blessed.Widgets.TextareaElement;

    constructor({ screen, onSubmit, onExit, onTab }: InputBoxOptions) {
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
                bg: "black",
                border: { fg: "#333333" },
                focus: { border: { fg: "#00ffcc" } },
            },
            border: { type: "line" },
            padding: { left: 1 },
        });

        this.textarea.on("keypress", (ch: string, key: Blessed.Widgets.Events.IKeyEventArg) => {
            const name = key?.name ?? "";
            const shift = key?.shift ?? false;
            const ctrl = key?.ctrl ?? false;

            if (ctrl && (name === "c" || name === "d")) {
                onExit();
                return;
            }

            if (name === "escape") {
                onExit();
                return;
            }

            if (name === "enter" || name === "return") {
                if (!shift) {
                    const value = this.textarea.getValue().trim();
                    if (value.length > 0) {
                        this.textarea.clearValue();
                        screen.render();
                        onSubmit(value);
                    }
                    return;
                }
                return;
            }

            if (name === "tab") {
                const partial = this.textarea.getValue();
                const completed = onTab?.(partial);
                if (completed !== undefined) {
                    this.textarea.setValue(completed);
                    screen.render();
                }
                key.name = "";
                return;
            }

            void ch;
        });

        this.textarea.focus();

        screen.on("click", () => {
            this.textarea.focus();
        });
    }

    setValue(value: string): void {
        this.textarea.setValue(value);
    }

    clear(): void {
        this.textarea.clearValue();
    }

    focus(): void {
        this.textarea.focus();
    }
}
