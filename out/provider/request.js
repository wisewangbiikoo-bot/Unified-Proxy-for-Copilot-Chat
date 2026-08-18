"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareChatRequest = prepareChatRequest;
const client_1 = require("../client");
const consts_1 = require("../consts");
const i18n_1 = require("../i18n");
const proxy_config_parse_1 = require("../proxy_config_parse");
const convert_1 = require("./convert");
const dump_1 = require("./dump");
const models_1 = require("./models");
const request_1 = require("./tools/request");
const index_1 = require("./vision/index");
function emptyVisionResolution(messages) {
    return {
        messages,
        stats: {
            inputImageParts: 0,
            inputImageBytes: 0,
            replayedImageMessages: 0,
            describedImageMessages: 0,
            skippedImageMessages: 0,
            markerVisionTextChars: 0,
        },
        replayMarkerMetadata: {},
        visionModelId: undefined,
    };
}
function resolveMaxOutputTokens(proxyConfig) {
    return proxyConfig.maxOutputTokens;
}
function resolveTemperature(proxyConfig) {
    return proxyConfig.temperature ?? proxy_config_parse_1.DEFAULT_TEMPERATURE;
}
function normalizeImageMode(value) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        return 0;
    }
    if (n === 1) {
        return 1;
    }
    return 2;
}
async function prepareChatRequest({ authManager, globalStorageUri, modelInfo, segment, messages, options, token, cacheDiagnostics, getVisionModel, }) {
    const proxy_config_loader_1 = require("../proxy_config_loader");
    const proxyConfig = (0, proxy_config_loader_1.getProxyConfig)(modelInfo.id);
    if (!proxyConfig?.baseUrl) {
        throw new Error((0, i18n_1.t)("config.proxyNotFound", modelInfo.id));
    }
    const baseUrl = proxyConfig.baseUrl;
    const actualApiKey = proxyConfig.apiKey;
    const actualModelId = proxyConfig.modelId;
    const client = new client_1.DeepSeekClient(baseUrl, actualApiKey);
    const modelDef = consts_1.MODELS.find((m) => m.id === modelInfo.id);
    const isThinkingModel = modelDef?.capabilities.thinking ?? false;
    const thinkingEffort = (0, models_1.getConfiguredThinkingEffort)(options, proxyConfig?.thinkingMode);
    const maxTokens = resolveMaxOutputTokens(proxyConfig);
    const temperature = resolveTemperature(proxyConfig);
    // supports_images:
    //   0 = drop images
    //   1 = legacy vision-proxy: describe image as text, then send text-only
    //   2 = native multimodal: OpenAI image_url to backend (e.g. LM Studio)
    const imageMode = normalizeImageMode(proxyConfig?.supportsImages);
    const visionResolution = imageMode === 1
        ? await (0, index_1.resolveImageMessages)(messages, token, getVisionModel, proxyConfig?.visionProxy)
        : emptyVisionResolution(messages);
    const resolvedMessages = visionResolution.messages;
    const deepseekMessages = (0, convert_1.convertMessages)(resolvedMessages, isThinkingModel, {
        passNativeImages: imageMode === 2,
    });
    const tools = (0, request_1.prepareRequestTools)(modelDef?.capabilities.toolCalling, options);
    const totalRequestChars = (0, convert_1.countMessageChars)(deepseekMessages);
    const request = {
        model: actualModelId || modelInfo.id,
        messages: deepseekMessages,
        stream: true,
        temperature,
        tools,
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(isThinkingModel
            ? {
                thinking: {
                    type: thinkingEffort === "none" ? "disabled" : "enabled",
                },
                ...(thinkingEffort === "none"
                    ? { chat_template_kwargs: { enable_thinking: false } }
                    : { reasoning_effort: thinkingEffort }),
            }
            : {}),
    };
    (0, dump_1.dumpDeepSeekRequest)(request, {
        globalStorageUri,
        segment,
        vscodeModelId: modelInfo.id,
        isThinkingModel,
        thinkingEffort,
        maxTokens,
        inputMessages: messages,
        resolvedMessages,
        requestOptions: options,
        visionModelId: visionResolution.visionModelId,
        visionStats: visionResolution.stats,
    });
    const diagnosticsRun = cacheDiagnostics.beginRequest({
        request,
        segment,
        vscodeModelId: modelInfo.id,
        isThinkingModel,
        thinkingEffort,
        maxTokens,
        inputMessages: messages,
        resolvedMessages,
        visionModelId: visionResolution.visionModelId,
        visionStats: visionResolution.stats,
    });
    return {
        client,
        request,
        isThinkingModel,
        totalRequestChars,
        trailingToolResultIds: (0, request_1.collectTrailingToolResultIds)(deepseekMessages),
        cacheDiagnostics: diagnosticsRun,
        segment,
        replayMarkerMetadata: visionResolution.replayMarkerMetadata,
        visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
    };
}
