"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode_1 = __importDefault(require("vscode"));
const config_1 = require("./config");
const consts_1 = require("./consts");
const i18n_1 = require("./i18n");
const logger_1 = require("./logger");
const provider_1 = require("./provider");
const dump_1 = require("./provider/dump");
const no_proxy_1 = require("./no_proxy");
const fs = require("fs");
let activeProvider;
let configWatchPath;
function reloadModelsFromConfig(notify = false) {
    (0, no_proxy_1.applyNoProxyBypass)();
    const consts = require("./consts");
    const proxy_config_loader_1 = require("./proxy_config_loader");
    const configPath = proxy_config_loader_1.getProxyConfigPath();
    consts.MODELS.length = 0;
    consts.MODELS.push(...proxy_config_loader_1.loadModelsFromConfig());
    activeProvider?.refreshModelPicker();
    // Force the host to re-pull `provideLanguageModelChatInformation`
    // synchronously (same trick as prepareForDeactivate). This covers the
    // startup race where Copilot Chat missed the refresh event above.
    void vscode_1.default.lm.selectChatModels({ vendor: 'unified-proxy' }).catch(() => { });
    const ids = consts.MODELS.map((m) => m.id).join(", ");
    logger_1.logger.info(`Loaded ${consts.MODELS.length} models from ${configPath}: ${ids}`);
    if (notify) {
        void vscode_1.default.window.showInformationMessage(`Reloaded ${consts.MODELS.length} models from config`);
    }
}
function watchProxyConfigFile(context) {
    const proxy_config_loader_1 = require("./proxy_config_loader");
    const configPath = proxy_config_loader_1.getProxyConfigPath();
    if (!fs.existsSync(configPath)) {
        return;
    }
    configWatchPath = configPath;
    let reloadTimer;
    const scheduleReload = () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => reloadModelsFromConfig(false), 500);
    };
    fs.watchFile(configPath, { interval: 1000 }, scheduleReload);
    context.subscriptions.push({ dispose: () => fs.unwatchFile(configPath) });
}
async function activate(context) {
    (0, no_proxy_1.applyNoProxyBypass)();
    try {
        await (0, config_1.migrateLegacyDebugSetting)();
    }
    catch (error) {
        logger_1.logger.warn('Failed to migrate legacy debug setting', error);
    }
    logger_1.logger.info(`Activating extension version=${context.extension.packageJSON.version}` +
        ` debugMode=${(0, config_1.getDebugMode)()}`);
    // Log debugMode changes so users can trace when verbosity was toggled
    let currentDebugMode = (0, config_1.getDebugMode)();
    context.subscriptions.push(vscode_1.default.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`${consts_1.CONFIG_SECTION}.debugMode`)) {
            const previous = currentDebugMode;
            currentDebugMode = (0, config_1.getDebugMode)();
            logger_1.logger.info(`debugMode changed: ${previous} -> ${currentDebugMode}`);
        }
    }));
    context.subscriptions.push(vscode_1.default.commands.registerCommand('unified-proxy-copilot.showLogs', () => logger_1.logger.show()), vscode_1.default.commands.registerCommand('unified-proxy-copilot.openSettings', () => vscode_1.default.commands.executeCommand('workbench.action.openSettings', 'unified-proxy-copilot')), vscode_1.default.commands.registerCommand('unified-proxy-copilot.reloadConfig', () => {
        reloadModelsFromConfig(true);
    }));
    try {
        const provider = new provider_1.DeepSeekChatProvider(context);
        activeProvider = provider;
        context.subscriptions.push(vscode_1.default.commands.registerCommand('unified-proxy-copilot.setApiKey', () => provider.configureApiKey()), vscode_1.default.commands.registerCommand('unified-proxy-copilot.clearApiKey', () => provider.clearApiKey()), vscode_1.default.lm.registerLanguageModelChatProvider('unified-proxy', provider));
        // Fix(#12): Copilot Chat caches model info in chatLanguageModels.json
        // but silently drops configurationSchema (Thinking Effort dropdown).
        // Re-firing onDidChangeLanguageModelChatInformation forces Copilot Chat
        // to re-query our provider through the full (non-cached) path.
        //
        // To avoid a race where our refresh event fires before Copilot Chat is
        // listening, we programmatically activate Copilot Chat first. We do NOT
        // use extensionDependencies because built-in extensions aren't enumerable
        // in Remote-SSH hosts (#37), which causes the hard dependency to fail.
        //
        // If Copilot Chat is unavailable (e.g. Remote-SSH without built-in
        // registration), we log a warning and proceed — Copilot Chat as a
        // built-in typically initialises before onStartupFinished anyway.
        try {
            await vscode_1.default.extensions.getExtension('github.copilot-chat')?.activate();
        }
        catch {
            logger_1.logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed');
        }
        reloadModelsFromConfig(false);
        watchProxyConfigFile(context);
        void showWelcomeIfNeeded(context, provider).catch((error) => {
            logger_1.logger.warn((0, i18n_1.t)('extension.welcomeFailed'), error);
        });
        logger_1.logger.info(`Extension activated version=${context.extension.packageJSON.version}`);
    }
    catch (error) {
        activeProvider = undefined;
        logger_1.logger.error('Failed to activate DeepSeek extension', error);
        void vscode_1.default.window.showErrorMessage((0, i18n_1.t)('extension.activateFailed'));
        throw error;
    }
}
async function openRequestDumpsFolder(context) {
    try {
        const root = await (0, dump_1.ensureRequestDumpRoot)(context.globalStorageUri);
        logger_1.logger.info(`Opening request dumps folder: ${root.toString(true)}`);
        await vscode_1.default.commands.executeCommand('revealFileInOS', root);
    }
    catch (error) {
        logger_1.logger.warn('Failed to open request dumps folder', error);
        void vscode_1.default.window.showErrorMessage((0, i18n_1.t)('extension.openRequestDumpsFolderFailed'));
    }
}
async function showWelcomeIfNeeded(context, provider) {
    if (context.globalState.get(consts_1.WELCOME_SHOWN_KEY)) {
        return;
    }
    if (consts_1.MODELS.length > 0) {
        await context.globalState.update(consts_1.WELCOME_SHOWN_KEY, true);
        return;
    }
    await vscode_1.default.commands.executeCommand('workbench.action.openWalkthrough', consts_1.WALKTHROUGH_ID, false);
    await context.globalState.update(consts_1.WELCOME_SHOWN_KEY, true);
}
async function deactivate() {
    try {
        await activeProvider?.prepareForDeactivate();
    }
    catch (error) {
        logger_1.logger.warn((0, i18n_1.t)('extension.deactivateFailed'), error);
    }
    finally {
        activeProvider = undefined;
        logger_1.logger.info('Extension deactivated');
        logger_1.logger.dispose();
    }
}
//# sourceMappingURL=extension.js.map