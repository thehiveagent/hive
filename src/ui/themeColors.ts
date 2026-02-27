/**
 * themeColors.ts — bridge between Hive theme and blessed color strings.
 *
 * Blessed accepts hex color strings (#RRGGBB) for fg/border/etc.
 * This module loads the active theme once and exposes the hex values.
 */
import { getTheme } from "../cli/theme.js";

export interface TUIColors {
    /** Primary accent color — used for borders, highlights, agent name */
    accent: string;
    /** Agent label in chatBox */
    agentLabel: string;
    /** Input box border (unfocused) */
    borderDim: string;
    /** Input box border (focused) */
    borderFocus: string;
    /** Dim text color */
    dim: string;
    /** Success color */
    success: string;
    /** Error color */
    error: string;
}

/**
 * Load colors from the active Hive theme.
 * Called once at TUI startup; reflects whatever theme is current.
 */
export function loadTUIColors(): TUIColors {
    const theme = getTheme();
    const accent = theme.hex; // e.g. "#FFA500"

    // Derive dimmed variant by lowering opacity slightly (just use grey for dim)
    return {
        accent,
        agentLabel: accent,
        borderDim: "#444444",
        borderFocus: accent,
        dim: "#888888",
        success: "#00E676",
        error: "#FF5252",
    };
}
