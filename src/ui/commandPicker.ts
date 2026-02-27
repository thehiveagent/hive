/**
 * commandPicker.ts — floating slash command picker overlay.
 *
 * Appears above the input box when user types "/" — shows all commands
 * filtered in real time. Arrow keys navigate, Enter selects (completes
 * into the input), Escape dismisses.
 */
import { createRequire } from "node:module";
import type * as Blessed from "blessed";
import type { TUIColors } from "./themeColors.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const blessed = require("blessed") as typeof Blessed;

export interface CommandEntry {
    label: string;
    insertText: string;
    description: string;
}

export const ALL_COMMANDS: CommandEntry[] = [
    { label: "/help", insertText: "/help", description: "show commands" },
    { label: "/new", insertText: "/new", description: "start a new conversation" },
    { label: "/clear", insertText: "/clear", description: "clear chat" },
    { label: "/status", insertText: "/status", description: "show session status" },
    { label: "/daemon", insertText: "/daemon", description: "daemon status" },
    { label: "/integrations", insertText: "/integrations", description: "integrations status" },
    { label: "/permissions", insertText: "/permissions", description: "review pending auth" },
    { label: "/tasks", insertText: "/tasks", description: "list background tasks" },
    { label: "/task ", insertText: "/task ", description: "queue a background task" },
    { label: "/task clear", insertText: "/task clear", description: "clear completed/failed tasks" },
    { label: "/remember ", insertText: "/remember ", description: "save a fact to memory" },
    { label: "/forget ", insertText: "/forget ", description: "delete closest fact" },
    { label: "/pin ", insertText: "/pin ", description: "pin fact into context" },
    { label: "/browse ", insertText: "/browse ", description: "read a webpage" },
    { label: "/search ", insertText: "/search ", description: "search the web" },
    { label: "/summarize ", insertText: "/summarize ", description: "summarize a webpage" },
    { label: "/tldr", insertText: "/tldr", description: "summarize this conversation" },
    { label: "/recap", insertText: "/recap", description: "summarize persona + knowledge" },
    { label: "/think ", insertText: "/think ", description: "think step by step" },
    { label: "/mode ", insertText: "/mode ", description: "switch response mode" },
    { label: "/export", insertText: "/export", description: "export conversation markdown" },
    { label: "/save ", insertText: "/save ", description: "name this conversation" },
    { label: "/history", insertText: "/history", description: "list recent conversations" },
    { label: "/retry", insertText: "/retry", description: "resend last message" },
    { label: "/copy", insertText: "/copy", description: "copy last reply" },
    { label: "/terminal ", insertText: "/terminal ", description: "execute terminal command" },
    { label: "/files ", insertText: "/files ", description: "filesystem operations" },
    { label: "/hive help", insertText: "/hive help", description: "Hive shortcuts" },
    { label: "/hive status", insertText: "/hive status", description: "run hive status" },
    { label: "/hive config show", insertText: "/hive config show", description: "show config" },
    { label: "/hive config provider", insertText: "/hive config provider", description: "change provider" },
    { label: "/hive config model", insertText: "/hive config model", description: "change model" },
    { label: "/hive config key", insertText: "/hive config key", description: "set API key" },
    { label: "/hive config theme", insertText: "/hive config theme", description: "change theme" },
    { label: "/hive memory list", insertText: "/hive memory list", description: "list knowledge" },
    { label: "/hive memory auto", insertText: "/hive memory auto", description: "list auto facts" },
    { label: "/hive memory clear", insertText: "/hive memory clear", description: "clear episodes" },
    { label: "/hive memory show", insertText: "/hive memory show", description: "show persona" },
    { label: "/exit", insertText: "/exit", description: "quit" },
];

const MAX_VISIBLE = 8;
const LABEL_WIDTH = 26;

export interface CommandPickerOptions {
    screen: Blessed.Widgets.Screen;
    colors: TUIColors;
    /** Called when an entry is selected — returns the insertText */
    onSelect: (insertText: string) => void;
    /** Called when picker is dismissed (Escape) */
    onDismiss: () => void;
}

export class CommandPicker {
    private list: Blessed.Widgets.ListElement;
    private _visible = false;
    private _matches: CommandEntry[] = [];
    private _selected = 0;
    private colors: TUIColors;
    private onSelect: (text: string) => void;
    private onDismiss: () => void;
    private screen: Blessed.Widgets.Screen;

    constructor({ screen, colors, onSelect, onDismiss }: CommandPickerOptions) {
        this.colors = colors;
        this.onSelect = onSelect;
        this.onDismiss = onDismiss;
        this.screen = screen;

        this.list = blessed.list({
            parent: screen,
            bottom: 3, // just above the input box
            left: 0,
            width: "100%",
            height: MAX_VISIBLE + 2, // +2 for borders
            hidden: true,
            tags: false,
            keys: false, // we handle keys manually
            mouse: false,
            border: { type: "line" },
            style: {
                fg: colors.dim,
                border: { fg: colors.borderDim },
                selected: {
                    fg: colors.accent,
                    bold: true,
                },
            },
            scrollable: true,
        });
    }

    /**
     * Called on every keypress in the inputBox with the current value.
     * Shows/hides and filters the picker.
     */
    update(inputValue: string): void {
        const trimmed = inputValue.trimStart();
        if (!trimmed.startsWith("/")) {
            this.hide();
            return;
        }
        this._filter(trimmed);
        if (this._matches.length === 0) {
            this.hide();
            return;
        }
        this._show();
    }

    /**
     * Handle arrow key from inputBox — returns true if consumed.
     */
    handleKey(keyName: string): boolean {
        if (!this._visible) return false;

        if (keyName === "up") {
            this._selected = this._selected > 0 ? this._selected - 1 : this._matches.length - 1;
            this._renderItems();
            return true;
        }
        if (keyName === "down") {
            this._selected = this._selected < this._matches.length - 1 ? this._selected + 1 : 0;
            this._renderItems();
            return true;
        }
        if (keyName === "enter" || keyName === "return") {
            this._commit();
            return true;
        }
        if (keyName === "escape") {
            this.hide();
            this.onDismiss();
            return true;
        }
        return false;
    }

    isVisible(): boolean {
        return this._visible;
    }

    hide(): void {
        if (!this._visible) return;
        this._visible = false;
        this.list.hide();
        this.screen.render();
    }

    private _show(): void {
        this._visible = true;
        this.list.show();
        this._renderItems();
    }

    private _filter(query: string): void {
        const lower = query.toLowerCase();
        // Prefix matches first, then substring matches
        const prefix = ALL_COMMANDS.filter((c) => c.label.toLowerCase().startsWith(lower));
        const other = ALL_COMMANDS.filter(
            (c) => !prefix.includes(c) && c.label.toLowerCase().includes(lower.slice(1)),
        );
        this._matches = [...prefix, ...other].slice(0, 32);
        this._selected = 0;
    }

    private _renderItems(): void {
        const items = this._matches.map((m, i) => {
            const marker = i === this._selected ? "›" : " ";
            const label = m.label.padEnd(LABEL_WIDTH, " ");
            return `${marker} ${label} ${m.description}`;
        });

        this.list.setItems(items as unknown as string[]);

        // Dynamic height based on match count
        const visible = Math.min(MAX_VISIBLE, this._matches.length);
        (this.list as Blessed.Widgets.ListElement & { height: number }).height = visible + 2;

        // Scroll list to keep selected in view
        this.list.select(this._selected);
        this.screen.render();
    }

    private _commit(): void {
        const entry = this._matches[this._selected];
        if (!entry) return;
        this.hide();
        this.onSelect(entry.insertText);
    }
}
