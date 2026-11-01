"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareChatRequest = prepareChatRequest;
const client_1 = require("../client");
const consts_1 = require("../consts");
const i18n_1 = require("../i18n");
const opencode_headers_1 = require("../opencode_headers");
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
    // Copilot model-menu「账号」(same UX as thinking) → sync active API key first
    try {
        const account_manager_1 = require("../account_manager");
        account_manager_1.applyAccountFromModelOptions(modelInfo.id, options);
    }
    catch {
        /* account manager optional */
    }
    const proxyConfig = (0, proxy_config_loader_1.getProxyConfig)(modelInfo.id);
    if (!proxyConfig?.baseUrl) {
        throw new Error((0, i18n_1.t)("config.proxyNotFound", modelInfo.id));
    }
    const baseUrl = proxyConfig.baseUrl;
    // Mark OpenCode session as early as possible so status bar can show
    try {
        require("../usage_monitor").setActiveChatModel(modelInfo.id, baseUrl);
    }
    catch {
        /* optional */
    }
    const actualApiKey = proxyConfig.apiKey;
    const actualModelId = proxyConfig.modelId;
    // Prefer explicit proxy session; else stable per-conversation segment for
    // OpenCode Go prompt-cache affinity under large Agent contexts.
    const sessionOverride =
        proxyConfig.openCodeSession ||
        (segment?.segmentId ? `upc-${segment.segmentId}` : "");
    const extraHeaders = (0, opencode_headers_1.buildUpstreamHeaders)({
        baseUrl,
        customHeaders: proxyConfig.customHeaders,
        sessionOverride,
    });
    try {
        require("../logger").logger.info(
            `OpenCode session=${extraHeaders["x-opencode-session"] || "(none)"} ` +
                `segment=${segment?.segmentId || "?"} reason=${segment?.reason || "?"}`,
        );
    }
    catch {
        /* optional */
    }
    const client = new client_1.DeepSeekClient(baseUrl, actualApiKey, extraHeaders);
    const modelDef = consts_1.MODELS.find((m) => m.id === modelInfo.id);
    const isThinkingModel = modelDef?.capabilities.thinking ?? false;
    const thinkingEffort = (0, models_1.getConfiguredThinkingEffort)(options, proxyConfig?.thinkingMode);
    const maxTokens = resolveMaxOutputTokens(proxyConfig);
    const temperature = resolveTemperature(proxyConfig);
    // supports_images:
    //   0 = drop images (unless global aux.vision is set → describe via aux)
    //   1 = legacy vision-proxy: describe image as text, then send text-only
    //   2 = native multimodal: OpenAI image_url to backend (e.g. LM Studio)
    let imageMode = normalizeImageMode(proxyConfig?.supportsImages);
    let visionProxy = (0, opencode_headers_1.enrichVisionProxyWithOpenCodeHeaders)(
        proxyConfig?.visionProxy,
        proxyConfig.openCodeSession,
    );
    // v2 global aux.vision: upgrade mode 0→1 when aux endpoint exists
    const visionBase = visionProxy?.baseUrl || visionProxy?.base_url;
    const visionModel = visionProxy?.modelId || visionProxy?.model_id;
    if (imageMode === 0 && visionBase && visionModel) {
        imageMode = 1;
    }
    // Web extract (aux) before vision — operates on VS Code message parts
    let messagesForVision = messages;
    try {
        const web_extract_1 = require("../web_extract");
        messagesForVision = await web_extract_1.maybeSummarizeWebToolResults(
            messages,
            proxyConfig,
            token,
        );
    }
    catch (e) {
        try {
            require("../logger").logger.warn(`web_extract skipped: ${e?.message || e}`);
        }
        catch {
            /* */
        }
    }
    const visionResolution = imageMode === 1
        ? await (0, index_1.resolveImageMessages)(messagesForVision, token, getVisionModel, visionProxy)
        : emptyVisionResolution(messagesForVision);
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
    try {
        const usage_monitor_1 = require("../usage_monitor");
        usage_monitor_1.setActiveChatModel(modelInfo.id, baseUrl);
    }
    catch {
        /* usage monitor optional */
    }
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
        initialResponseNotice: visionResolution.initialResponseNotice,
        vscodeModelId: modelInfo.id,
        baseUrl,
    };
}
