"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthManager = void 0;
const vscode_1 = __importDefault(require("vscode"));
const consts_1 = require("./consts");
const i18n_1 = require("./i18n");
/**
 * Manages DeepSeek API key via VS Code SecretStorage (secure) with
 * fallback to extension settings (less secure, for CI/automation).
 */
class AuthManager {
    secretStorage;
    constructor(context) {
        this.secretStorage = context.secrets;
    }
    /**
     * Get API key. Tries SecretStorage first, then falls back to settings.
     */
    async getApiKey() {
        const secretKey = await this.secretStorage.get(consts_1.API_KEY_SECRET);
        if (secretKey) {
            return secretKey;
        }
        const config = vscode_1.default.workspace.getConfiguration('deepseek-copilot');
        const settingsKey = config.get('apiKey');
        if (settingsKey?.trim()) {
            return settingsKey.trim();
        }
        return undefined;
    }
    /**
     * Store API key in SecretStorage.
     */
    async setApiKey(apiKey) {
        await this.secretStorage.store(consts_1.API_KEY_SECRET, apiKey.trim());
    }
    /**
     * Delete stored API key.
     */
    async deleteApiKey() {
        await this.secretStorage.delete(consts_1.API_KEY_SECRET);
    }
    /**
     * Check if an API key is configured.
     */
    async hasApiKey() {
        const key = await this.getApiKey();
        return key !== undefined && key.length > 0;
    }
    /**
     * Prompt user to enter API key via input box.
     */
    async promptForApiKey() {
        const apiKey = await vscode_1.default.window.showInputBox({
            prompt: (0, i18n_1.t)('auth.prompt'),
            placeHolder: (0, i18n_1.t)('auth.placeholder'),
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value?.trim()) {
                    return (0, i18n_1.t)('auth.emptyValidation');
                }
                return undefined;
            },
        });
        if (apiKey) {
            await this.setApiKey(apiKey);
            vscode_1.default.window.showInformationMessage((0, i18n_1.t)('auth.saved'));
            return true;
        }
        return false;
    }
}
exports.AuthManager = AuthManager;
//# sourceMappingURL=auth.js.map