export { createMessageHandler, handleMessage, type IncomingMessage, type OutgoingMessage } from "./handler.js";
export { isAuthorized, addAuthorized, removeAuthorized, readAuthorizedConfig, listPendingAuth, setDisabled, isDisabled, type IntegrationPlatform } from "./auth.js";
export { startTelegramIntegration } from "./telegram.js";
export { startWhatsAppIntegration, runWhatsAppSetup } from "./whatsapp.js";
export { startDiscordIntegration, buildDiscordSlashCommandData } from "./discord.js";
export { startSlackIntegration } from "./slack.js";
export { keychainGet, keychainSet, keychainDelete } from "./keychain.js";

