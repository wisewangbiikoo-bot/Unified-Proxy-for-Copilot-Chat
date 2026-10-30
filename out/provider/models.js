"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toChatInfo = toChatInfo;
exports.getConfiguredThinkingEffort = getConfiguredThinkingEffort;
const vscode_1 = __importDefault(require("vscode"));
const i18n_1 = require("../i18n");
function toChatInfo(m) {
    const detailKey = resolveDetailKey(m);
    const modelDescription = detailKey ? (0, i18n_1.t)(detailKey) : m.detail;
    const proxy_config_loader_1 = require("../proxy_config_loader");
    const proxyConfig = (0, proxy_config_loader_1.getProxyConfig)(m.id);
    const showWarning = proxyConfig === null;
    const schemaDefault = proxyConfig?.thinkingMode ??
        m._proxyConfig?.thinkingMode ??
        "high";
    const hasThinkingMenu = m.capabilities.thinking;
    // Copilot 原生面板只稳定渲染 reasoningEffort；多账号已拆成模型列表里的多行。
    return {
        id: m.id,
        name: m.name,
        family: m.family,
        version: m.version,
        detail: showWarning
            ? (0, i18n_1.t)("config.proxyMissingDetail")
            : hasThinkingMenu
                ? getThinkingEnumDescription(schemaDefault)
                : modelDescription,
        tooltip: showWarning ? (0, i18n_1.t)("config.proxyMissingDetail") : modelDescription,
        statusIcon: showWarning ? new vscode_1.default.ThemeIcon("warning") : undefined,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
        isBYOK: true,
        isUserSelectable: true,
        capabilities: {
            toolCalling: m.capabilities.toolCalling,
            imageInput: m.capabilities.imageInput,
        },
        ...(hasThinkingMenu
            ? {
                configurationSchema: buildThinkingEffortSchema(schemaDefault, modelDescription),
            }
            : {}),
    };
}
function getThinkingEnumDescription(effort) {
    if (effort === "max") {
        return (0, i18n_1.t)("thinking.max.desc");
    }
    if (effort === "high") {
        return (0, i18n_1.t)("thinking.high.desc");
    }
    if (effort === "low") {
        return (0, i18n_1.t)("thinking.low.desc");
    }
    return (0, i18n_1.t)("thinking.none.desc");
}
function getConfiguredThinkingEffort(options, schemaDefault) {
    const configuredEffort = options.modelConfiguration?.reasoningEffort ??
        options.configuration?.reasoningEffort;
    if (configuredEffort === "none") {
        return "none";
    }
    if (configuredEffort === "low") {
        return "low";
    }
    if (configuredEffort === "high") {
        return "high";
    }
    if (configuredEffort === "max") {
        return "max";
    }
    if (schemaDefault === "none" || schemaDefault === "low" || schemaDefault === "high" || schemaDefault === "max") {
        return schemaDefault;
    }
    return "high";
}
function buildThinkingEffortSchema(defaultEffort = "high", modelDescription) {
    return {
        type: "object",
        description: modelDescription,
        properties: {
            reasoningEffort: {
                type: "string",
                title: (0, i18n_1.t)("status.thinking"),
                enum: ["none", "low", "high", "max"],
                enumItemLabels: [
                    (0, i18n_1.t)("thinking.none"),
                    (0, i18n_1.t)("thinking.low"),
                    (0, i18n_1.t)("thinking.high"),
                    (0, i18n_1.t)("thinking.max"),
                ],
                enumDescriptions: [
                    (0, i18n_1.t)("thinking.none.desc"),
                    (0, i18n_1.t)("thinking.low.desc"),
                    (0, i18n_1.t)("thinking.high.desc"),
                    (0, i18n_1.t)("thinking.max.desc"),
                ],
                default: defaultEffort,
                group: "navigation",
            },
        },
    };
}
function resolveDetailKey(m) {
    const proxyKey = m._proxyKey || m.id;
    const suffix = proxyKey.startsWith("deepseek-v4-")
        ? proxyKey.slice("deepseek-v4-".length)
        : proxyKey;
    const key = `model.${suffix}.detail`;
    const translated = (0, i18n_1.t)(key);
    return translated !== key ? key : undefined;
}
