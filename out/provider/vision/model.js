"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVisionModelGetter = createVisionModelGetter;
exports.setVisionProxyModel = setVisionProxyModel;
exports.getVisionPrompt = getVisionPrompt;
const vscode_1 = __importDefault(require("vscode"));
const i18n_1 = require("../../i18n");
const logger_1 = require("../../logger");
const consts_1 = require("./consts");
/**
 * Get the vision proxy model. Cached after first lookup.
 * Uses the configured model ID, or defaults to DEFAULT_VISION_MODEL_ID.
 */
function createVisionModelGetter() {
    let visionModel;
    let visionModelPromise;
    return {
        async get() {
            if (visionModel) {
                return visionModel;
            }
            if (visionModelPromise) {
                return visionModelPromise;
            }
            visionModelPromise = (async () => {
                const id = getConfiguredVisionModelId() ?? consts_1.DEFAULT_VISION_MODEL_ID;
                const models = await vscode_1.default.lm.selectChatModels({ id });
                if (models.length > 0) {
                    logger_1.logger.info((0, i18n_1.t)('vision.proxyUsing', models[0].id));
                    visionModel = models[0];
                    return models[0];
                }
                logger_1.logger.warn((0, i18n_1.t)('vision.notFound', id));
                return undefined;
            })();
            return visionModelPromise;
        },
        reset() {
            visionModel = undefined;
            visionModelPromise = undefined;
        },
    };
}
/**
 * Let the user pick which model to use for describing image attachments.
 */
async function setVisionProxyModel() {
    const allModels = await vscode_1.default.lm.selectChatModels();
    const candidates = allModels.filter((m) => m.vendor !== 'deepseek');
    if (candidates.length === 0) {
        vscode_1.default.window.showInformationMessage((0, i18n_1.t)('vision.noModel'));
        return;
    }
    const currentId = getConfiguredVisionModelId();
    const items = candidates.map((m) => ({
        label: m.id,
        description: (0, i18n_1.t)('vision.vendorLabel', m.vendor),
        detail: m.id === currentId ? (0, i18n_1.t)('vision.current') : undefined,
    }));
    const picked = await vscode_1.default.window.showQuickPick(items, {
        placeHolder: (0, i18n_1.t)('vision.pickPlaceholder', consts_1.DEFAULT_VISION_MODEL_ID),
        matchOnDescription: true,
    });
    if (picked) {
        const config = vscode_1.default.workspace.getConfiguration('deepseek-copilot');
        await config.update('visionModel', picked.label, vscode_1.default.ConfigurationTarget.Global);
    }
}
function getVisionPrompt() {
    const config = vscode_1.default.workspace.getConfiguration('deepseek-copilot');
    return (config.get('visionPrompt', consts_1.IMAGE_DESCRIPTION_PROMPT).trim() || consts_1.IMAGE_DESCRIPTION_PROMPT);
}
function getConfiguredVisionModelId() {
    const config = vscode_1.default.workspace.getConfiguration('deepseek-copilot');
    const id = config.get('visionModel', '');
    return id.trim() || undefined;
}
//# sourceMappingURL=model.js.map