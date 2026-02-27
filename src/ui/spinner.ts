/**
 * spinner.ts — "thinking…" indicator for chatBox.
 *
 * Shows a spinner line in the chatBox while the agent is processing.
 * The spinner line is managed internally: it appends text via callbacks.
 */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const INTERVAL_MS = 120;

export class Spinner {
    private timer: ReturnType<typeof setInterval> | null = null;
    private frameIndex = 0;
    private active = false;

    /**
     * Start the spinner.
     * @param onFrame Called every tick with the current spinner display string.
     * @param onClear Called when spinner is stopped (to erase the spinner line).
     */
    start(onFrame: (text: string) => void, onClear: () => void): void {
        if (this.active) return;
        this.active = true;
        this.frameIndex = 0;
        this._onClear = onClear;

        // Show immediately
        onFrame(this._buildFrame());

        this.timer = setInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
            onFrame(this._buildFrame());
        }, INTERVAL_MS);
    }

    stop(): void {
        if (!this.active) return;
        this.active = false;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this._onClear?.();
        this._onClear = undefined;
    }

    isActive(): boolean {
        return this.active;
    }

    private _buildFrame(): string {
        return `\x1b[2m${FRAMES[this.frameIndex]} thinking...\x1b[0m`;
    }

    private _onClear?: () => void;
}
