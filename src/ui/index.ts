/**
 * src/ui/index.ts — re-exports all TUI submodules.
 */

export { printBanner } from "./banner.js";
export {
    formatAgentLabel,
    formatAgentMessage,
    formatError,
    formatInfo,
    formatSeparator,
    formatSuccess,
    formatUserMessage,
    formatWarning,
} from "./renderer.js";
export { Spinner } from "./spinner.js";
export { StatusBar } from "./statusBar.js";
export type { StatusBarState } from "./statusBar.js";
export { ChatBox } from "./chatBox.js";
export { InputBox } from "./inputBox.js";
export { TUI } from "./tui.js";
export type { TUIOptions } from "./tui.js";
