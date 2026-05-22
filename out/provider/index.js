"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepSeekChatProvider = void 0;
const vscode_1 = __importDefault(require("vscode"));
const auth_1 = require("../auth");
const config_1 = require("../config");
const consts_1 = require("../consts");
const i18n_1 = require("../i18n");
const logger_1 = require("../logger");
const diagnostics_1 = require("./diagnostics");
const dump_1 = require("./dump");
const models_1 = require("./models");
const request_1 = require("./request");
const segment_1 = require("./segment");
const stream_1 = require("./stream");
const tokens_1 = require("./tokens");
const flow_1 = require("./tools/flow");
const index_1 = require("./vision/index");
/**
 * DeepSeek Chat Provider — implements vscode.LanguageModelChatProvider so
 * DeepSeek V4 models appear directly in the Copilot Chat model picker.
 */
class DeepSeekChatProvider {
    authManager;
    globalStorageUri;
    onDidChangeLanguageModelChatInformationEmitter = new vscode_1.default.EventEmitter();
    isActive = true;
    onDidChangeLanguageModelChatInformation = this.onDidChangeLanguageModelChatInformationEmitter.event;
    cacheDiagnostics = (0, diagnostics_1.createCacheDiagnosticsRecorder)();
    /** Vision proxy: resolver + cached model. */
    vision = (0, index_1.createVisionModelGetter)();
    /**
     * Adaptive chars-per-token ratio, calibrated from actual usage data.
     * Updated via exponential moving average each time the API reports real token counts.
     */
    charsPerToken = 4.0;
    constructor(context) {
        this.authManager = new auth_1.AuthManager(context);
        this.globalStorageUri = context.globalStorageUri;
        context.subscriptions.push(this.onDidChangeLanguageModelChatInformationEmitter, 
        // Settings-based fallback API key + vision model changes.
        vscode_1.default.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('deepseek-copilot.apiKey')) {
                this.onDidChangeLanguageModelChatInformationEmitter.fire();
            }
            if (e.affectsConfiguration('deepseek-copilot.visionModel')) {
                this.vision.reset();
            }
        }), 
        // Multi-window: SecretStorage changes don't fire onDidChangeConfiguration.
        // When another window sets/clears the API key, refresh this window's
        // model picker so the warning state stays in sync.
        context.secrets.onDidChange((e) => {
            if (e.key === 'deepseek-copilot.apiKey') {
                this.onDidChangeLanguageModelChatInformationEmitter.fire();
            }
        }));
    }
    // ---- Public commands ----
    async configureApiKey() {
        const saved = await this.authManager.promptForApiKey();
        if (saved) {
            this.onDidChangeLanguageModelChatInformationEmitter.fire();
        }
    }
    async clearApiKey() {
        await this.authManager.deleteApiKey();
        this.onDidChangeLanguageModelChatInformationEmitter.fire();
        vscode_1.default.window.showInformationMessage((0, i18n_1.t)('auth.removed'));
    }
    async hasApiKey() {
        return this.authManager.hasApiKey();
    }
    /** Force Copilot Chat to re-query model information (including configurationSchema). */
    refreshModelPicker() {
        this.onDidChangeLanguageModelChatInformationEmitter.fire();
    }
    async prepareForDeactivate() {
        this.isActive = false;
        this.onDidChangeLanguageModelChatInformationEmitter.fire();
        // Force the host to re-pull `provideLanguageModelChatInformation` synchronously
        // before the extension unloads. With `isActive = false` we now return [],
        // which makes Copilot Chat drop DeepSeek models from the picker immediately
        // instead of leaving stale entries behind after deactivate. The returned
        // model list itself is unused — we only call this for its side effect.
        try {
            await vscode_1.default.lm.selectChatModels({ vendor: 'unified-proxy' });
        }
        catch (error) {
            logger_1.logger.warn('Failed to refresh DeepSeek models during deactivate', error);
        }
    }
    /** See provider/vision */
    async setVisionProxyModel() {
        await (0, index_1.setVisionProxyModel)();
    }
    // ---- LanguageModelChatProvider ----
    async provideLanguageModelChatInformation(_options, _token) {
        if (!this.isActive) {
            return [];
        }
        return consts_1.MODELS.map((model) => (0, models_1.toChatInfo)(model));
    }
    async provideLanguageModelChatResponse(modelInfo, messages, options, progress, token) {
        const segment = (0, segment_1.resolveConversationSegment)(messages);
        (0, dump_1.dumpProviderInput)({
            globalStorageUri: this.globalStorageUri,
            segment,
            modelInfo,
            messages,
            requestOptions: options,
        });
        const toolFlow = (0, flow_1.processToolFlow)({
            stabilizeToolList: (0, config_1.getStabilizeToolListEnabled)(),
            messages,
            tools: options.tools,
            progress,
        });
        if (toolFlow.preflightHandled) {
            return;
        }
        const prepared = await (0, request_1.prepareChatRequest)({
            authManager: this.authManager,
            globalStorageUri: this.globalStorageUri,
            modelInfo,
            segment,
            messages: toolFlow.messages,
            options,
            token,
            cacheDiagnostics: this.cacheDiagnostics,
            getVisionModel: () => this.vision.get(),
        });
        return (0, stream_1.streamChatCompletion)({
            prepared,
            progress,
            token,
            initialResponseNotice: toolFlow.initialResponseNotice,
            getCharsPerToken: () => this.charsPerToken,
            setCharsPerToken: (charsPerToken) => {
                this.charsPerToken = charsPerToken;
            },
        });
    }
    async provideTokenCount(_modelInfo, text, _token) {
        return (0, tokens_1.estimateTokenCount)(text, this.charsPerToken);
    }
}
exports.DeepSeekChatProvider = DeepSeekChatProvider;
//# sourceMappingURL=index.js.map