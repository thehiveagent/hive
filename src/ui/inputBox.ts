/**
 * inputBox.ts — bottom-fixed input rectangle.
 *
 * - Always focused.
 * - Enter → submits.
 * - Shift+Enter → newline.
 * - Ctrl+C / Escape → triggers exit callback.
 * - Tab → triggers tab callback (for command suggestion cycling).
 */
import * as blessed from "blessed";

export interface InputBoxOptions {
    screen: blessed.Widgets.Screen;
    onSubmit: (value: string) => void;
    onExit: () => void;
    onTab?: (partial: string) => string | undefined;
}

export class InputBox {
    private textarea: blessed.Widgets.TextareaElement;

    constructor({ screen, onSubmit, onExit, onTab }: InputBoxOptions) {
        // Border + 1 line of padding = visible input height of 1 line.
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

        // Render a prompt symbol as a pseudo-prefix. We put it inline in the
        // placeholder / label since blessed textareas don't support a true prefix
        let currentValue = "";

        // blessed 'keypress' fires before the widget updates its value
        this.textarea.on("keypress", (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
            const name = key?.name ?? "";
            const shift = key?.shift ?? false;
            const ctrl = key?.ctrl ?? false;

            // Ctrl+C / Ctrl+D → exit
            if (ctrl && (name === "c" || name === "d")) {
                onExit();
                return;
            }

            // Escape → exit
            if (name === "escape") {
                onExit();
                return;
            }

            // Enter without Shift → submit
            if (name === "enter" || name === "return") {
                if (!shift) {
                    const value = this.textarea.getValue().trim();
                    if (value.length > 0) {
                        this.textarea.clearValue();
                        currentValue = "";
                        screen.render();
                        onSubmit(value);
                    }
                    // Don't propagate — prevent newline on plain enter
                    return;
                }
                // Shift+Enter → allow newline (let blessed handle it naturally)
                return;
            }

            // Tab → command completion
            if (name === "tab") {
                const partial = this.textarea.getValue();
                const completed = onTab?.(partial);
                if (completed !== undefined) {
                    this.textarea.setValue(completed);
                    screen.render();
                }
                // Prevent focus cycling
                key.name = ""; // consume
                return;
            }

            void currentValue;
        });

        // Focus the input immediately and keep it focused
        this.textarea.focus();

        screen.on("click", () => {
            this.textarea.focus();
        });
    }

    /**
     * Set the value of the input programmatically (e.g. after tab completion).
     */
    setValue(value: string): void {
        this.textarea.setValue(value);
    }

    /**
     * Clear the input.
     */
    clear(): void {
        this.textarea.clearValue();
    }

    /**
     * Focus the input box.
     */
    focus(): void {
        this.textarea.focus();
    }
}
