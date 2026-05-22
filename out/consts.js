"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODELS = exports.WALKTHROUGH_ID = exports.WELCOME_SHOWN_KEY = exports.API_KEY_SECRET = exports.LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = exports.CONFIG_SECTION = void 0;
const proxy_config_loader_1 = require("./proxy_config_loader");
/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */
/** VS Code configuration section prefix for all extension settings. */
exports.CONFIG_SECTION = 'unified-proxy-copilot';
// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
exports.LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;
// ---- Secret keys ----
/** SecretStorage key for the API key (optional, can use config file instead). */
exports.API_KEY_SECRET = 'unified-proxy-copilot.apiKey';
/** memento key tracking whether the welcome walkthrough has been shown. */
exports.WELCOME_SHOWN_KEY = 'unified-proxy-copilot.welcomeShown';
// ---- Walkthrough ----
/** Walkthrough contribution ID. */
exports.WALKTHROUGH_ID = 'biikoo.unified-proxy-copilot#deepseekGettingStarted';
// ---- Model registry ----
/** Available models exposed through the language model provider. Loaded dynamically from proxy_configs.json */
exports.MODELS = (0, proxy_config_loader_1.loadModelsFromConfig)();
//# sourceMappingURL=consts.js.map