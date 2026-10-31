"use strict";
/**
 * Unified Proxy config schema v2 — providers + enabled models + aux.
 * v1 ({ proxies: {...} }) remains readable via normalize.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA_VERSION = void 0;
exports.SCHEMA_VERSION = 2;
exports.MODEL_SEP = "__";
exports.makeModelId = makeModelId;
exports.splitModelId = splitModelId;
exports.getSchemaVersion = getSchemaVersion;
exports.isV2Config = isV2Config;
exports.slugifyId = slugifyId;
exports.migrateV1ToV2 = migrateV1ToV2;
exports.listProviderEntries = listProviderEntries;
exports.findProvider = findProvider;
exports.findModel = findModel;
exports.modelToProxyShape = modelToProxyShape;
exports.resolveAuxVisionProxy = resolveAuxVisionProxy;
exports.resolveAuxWebExtractTarget = resolveAuxWebExtractTarget;
exports.paramsFromMeta = paramsFromMeta;
exports.applyUserParams = applyUserParams;
exports.ensureUniqueProviderId = ensureUniqueProviderId;
exports.emptyV2Config = emptyV2Config;

const SCHEMA_VERSION = exports.SCHEMA_VERSION;
const MODEL_SEP = exports.MODEL_SEP;

/**
 * @param {string} providerId
 * @param {string} modelId
 */
function makeModelId(providerId, modelId) {
    const p = String(providerId || "").trim() || "provider";
    const m = String(modelId || "").trim() || "model";
    return `${p}${MODEL_SEP}${m}`;
}

/**
 * @param {string} id
 * @returns {{ providerId: string, modelId: string }|null}
 */
function splitModelId(id) {
    const s = String(id || "");
    const idx = s.indexOf(MODEL_SEP);
    if (idx <= 0) {
        return null;
    }
    return {
        providerId: s.slice(0, idx),
        modelId: s.slice(idx + MODEL_SEP.length),
    };
}

/**
 * @param {object} cfg
 * @returns {number}
 */
function getSchemaVersion(cfg) {
    if (!cfg || typeof cfg !== "object") {
        return 1;
    }
    const raw = cfg.schema_version ?? cfg.schemaVersion ?? cfg.unified_proxy_config;
    if (raw === "2.0" || raw === "2" || Number(raw) === 2) {
        return 2;
    }
    if (Array.isArray(cfg.providers) && Array.isArray(cfg.models)) {
        return 2;
    }
    return 1;
}

function isV2Config(cfg) {
    return getSchemaVersion(cfg) >= 2;
}

/**
 * @param {string} text
 */
function slugifyId(text) {
    const s = String(text || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return s || "provider";
}

function emptyV2Config() {
    return {
        schema_version: SCHEMA_VERSION,
        providers: [],
        models: [],
        aux: {
            vision: { ref: null },
            web_extract: { ref: null },
        },
    };
}

/**
 * @param {object} cfg v1
 * @returns {object} v2
 */
function migrateV1ToV2(cfg) {
    const out = emptyV2Config();
    const byUrl = new Map();
    /** @type {string|null} */
    let visionRef = null;

    for (const [key, proxy] of Object.entries(cfg?.proxies || {})) {
        if (!proxy || typeof proxy !== "object") {
            continue;
        }
        const baseUrl = String(proxy.base_url || proxy.baseUrl || "").trim();
        if (!baseUrl) {
            continue;
        }
        const urlKey = baseUrl.replace(/\/$/, "").toLowerCase();
        let providerId = byUrl.get(urlKey);
        if (!providerId) {
            providerId = ensureUniqueProviderId(
                out.providers,
                slugifyId(proxy.name || key || "provider"),
            );
            byUrl.set(urlKey, providerId);
            const prov = {
                id: providerId,
                name: String(proxy.name || key || providerId),
                base_url: baseUrl,
                api_key: String(proxy.api_key || proxy.apiKey || ""),
            };
            if (Array.isArray(proxy.accounts) && proxy.accounts.length) {
                prov.accounts = proxy.accounts;
            }
            if (proxy.account_switch || proxy.accountSwitch) {
                prov.account_switch = proxy.account_switch || proxy.accountSwitch;
            }
            if (proxy.custom_headers || proxy.customHeaders) {
                prov.custom_headers = proxy.custom_headers || proxy.customHeaders;
            }
            if (proxy.opencode_session || proxy.openCodeSession) {
                prov.opencode_session = proxy.opencode_session || proxy.openCodeSession;
            }
            out.providers.push(prov);
        }

        const upstreamModelId = String(proxy.model_id || proxy.modelId || key).trim();
        const modelEntryId = makeModelId(providerId, upstreamModelId);
        if (!out.models.some((m) => m.id === modelEntryId)) {
            out.models.push({
                id: modelEntryId,
                provider_id: providerId,
                model_id: upstreamModelId,
                enabled: true,
                name: String(proxy.name || upstreamModelId),
                description: String(proxy.description || ""),
                params: extractParamsFromV1Proxy(proxy),
                param_source: "user",
            });
        }

        if (!visionRef && (proxy.vision_proxy || proxy.visionProxy)) {
            visionRef = migrateVisionProxy(
                out,
                proxy.vision_proxy || proxy.visionProxy,
            );
        }
    }

    out.aux.vision.ref = visionRef;
    out.aux.web_extract.ref = null;
    return out;
}

function extractParamsFromV1Proxy(proxy) {
    const params = {};
    if (proxy.context_window_size !== undefined || proxy.contextWindowSize !== undefined) {
        params.context_window_size = proxy.context_window_size ?? proxy.contextWindowSize;
    }
    else {
        params.context_window_size = 0;
    }
    if (proxy.max_output_tokens !== undefined || proxy.maxOutputTokens !== undefined) {
        params.max_output_tokens = proxy.max_output_tokens ?? proxy.maxOutputTokens;
    }
    else {
        params.max_output_tokens = 0;
    }
    if (proxy.supports_images !== undefined || proxy.supportsImages !== undefined) {
        params.supports_images = proxy.supports_images ?? proxy.supportsImages;
    }
    else {
        params.supports_images = 0;
    }
    if (proxy.supports_tools !== undefined || proxy.supportsTools !== undefined) {
        params.supports_tools = proxy.supports_tools ?? proxy.supportsTools;
    }
    else {
        params.supports_tools = 0;
    }
    if (proxy.supports_thinking !== undefined || proxy.supportsThinking !== undefined) {
        params.supports_thinking = proxy.supports_thinking ?? proxy.supportsThinking;
    }
    else {
        params.supports_thinking = 0;
    }
    if (proxy.temperature !== undefined && proxy.temperature !== null) {
        params.temperature = proxy.temperature;
    }
    if (proxy.thinking_mode !== undefined || proxy.thinkingMode !== undefined) {
        params.thinking_mode = proxy.thinking_mode ?? proxy.thinkingMode;
    }
    return params;
}

/**
 * @param {object} out v2 config being built
 * @param {object} visionProxy
 * @returns {string|null} model ref
 */
function migrateVisionProxy(out, visionProxy) {
    if (!visionProxy || typeof visionProxy !== "object") {
        return null;
    }
    const baseUrl = String(visionProxy.base_url || visionProxy.baseUrl || "").trim();
    const modelId = String(visionProxy.model_id || visionProxy.modelId || "").trim();
    if (!baseUrl || !modelId) {
        return null;
    }
    const urlKey = baseUrl.replace(/\/$/, "").toLowerCase();
    let provider = out.providers.find(
        (p) => String(p.base_url || "").replace(/\/$/, "").toLowerCase() === urlKey,
    );
    if (!provider) {
        const id = ensureUniqueProviderId(out.providers, slugifyId(`vision-${modelId}`));
        provider = {
            id,
            name: `Vision · ${modelId}`,
            base_url: baseUrl,
            api_key: String(visionProxy.api_key || visionProxy.apiKey || ""),
        };
        if (visionProxy.custom_headers || visionProxy.customHeaders) {
            provider.custom_headers = visionProxy.custom_headers || visionProxy.customHeaders;
        }
        out.providers.push(provider);
    }
    const ref = makeModelId(provider.id, modelId);
    if (!out.models.some((m) => m.id === ref)) {
        out.models.push({
            id: ref,
            provider_id: provider.id,
            model_id: modelId,
            enabled: true,
            name: modelId,
            params: {
                context_window_size: 0,
                max_output_tokens: 0,
                supports_images: 2,
                supports_tools: 0,
                supports_thinking: 0,
            },
            param_source: "auto",
        });
    }
    return ref;
}

/**
 * @param {Array<{id:string}>} providers
 * @param {string} baseId
 */
function ensureUniqueProviderId(providers, baseId) {
    let id = baseId || "provider";
    if (!providers.some((p) => p.id === id)) {
        return id;
    }
    let n = 2;
    while (providers.some((p) => p.id === `${baseId}-${n}`)) {
        n += 1;
    }
    return `${baseId}-${n}`;
}

/**
 * Providers as [key, proxyLike] for account_manager / usage.
 * @param {object} cfg
 * @returns {Array<[string, object]>}
 */
function listProviderEntries(cfg) {
    if (!isV2Config(cfg)) {
        return Object.entries(cfg?.proxies || {}).filter(([, p]) => p?.base_url);
    }
    return (cfg.providers || [])
        .filter((p) => p?.base_url)
        .map((p) => [p.id, providerToProxyShape(p)]);
}

function providerToProxyShape(provider) {
    return {
        name: provider.name || provider.id,
        base_url: provider.base_url,
        api_key: provider.api_key,
        accounts: provider.accounts,
        account_switch: provider.account_switch,
        custom_headers: provider.custom_headers || provider.customHeaders,
        opencode_session: provider.opencode_session || provider.openCodeSession,
    };
}

/**
 * @param {object} cfg
 * @param {string} providerId
 */
function findProvider(cfg, providerId) {
    if (!isV2Config(cfg)) {
        const p = cfg?.proxies?.[providerId];
        return p ? { id: providerId, ...p } : null;
    }
    return (cfg.providers || []).find((p) => p.id === providerId) || null;
}

/**
 * @param {object} cfg
 * @param {string} modelEntryId
 */
function findModel(cfg, modelEntryId) {
    if (!isV2Config(cfg)) {
        return null;
    }
    return (cfg.models || []).find((m) => m.id === modelEntryId) || null;
}

/**
 * Merge model params + provider into a v1-like proxy object for parseProxyEntry.
 * @param {object} model
 * @param {object} provider
 */
function modelToProxyShape(model, provider) {
    const params = model?.params && typeof model.params === "object" ? model.params : {};
    return {
        name: model.name || model.model_id || model.id,
        description: model.description || "",
        base_url: provider.base_url,
        api_key: provider.api_key,
        accounts: provider.accounts,
        account_switch: provider.account_switch,
        model_id: model.model_id,
        custom_headers: provider.custom_headers || provider.customHeaders,
        opencode_session: provider.opencode_session || provider.openCodeSession,
        context_window_size: params.context_window_size ?? 0,
        max_output_tokens: params.max_output_tokens ?? 0,
        supports_images: params.supports_images ?? 0,
        supports_tools: params.supports_tools ?? 0,
        supports_thinking: params.supports_thinking ?? 0,
        temperature: params.temperature,
        thinking_mode: params.thinking_mode,
    };
}

/**
 * @param {object} cfg
 * @param {(providerId: string, provider: object) => string} [resolveApiKey]
 * @returns {object|null} vision_proxy endpoint shape
 */
function resolveAuxVisionProxy(cfg, resolveApiKey) {
    if (!isV2Config(cfg)) {
        return null;
    }
    const ref = cfg.aux?.vision?.ref;
    if (!ref) {
        return null;
    }
    const model = findModel(cfg, ref);
    if (!model) {
        return null;
    }
    const provider = findProvider(cfg, model.provider_id);
    if (!provider?.base_url) {
        return null;
    }
    const apiKey =
        typeof resolveApiKey === "function"
            ? resolveApiKey(provider.id, provider) || provider.api_key
            : provider.api_key;
    return {
        type: "endpoint",
        protocol: "openai-chat",
        base_url: provider.base_url,
        api_key: apiKey || "",
        model_id: model.model_id,
        custom_headers: provider.custom_headers || provider.customHeaders || null,
    };
}

/**
 * @param {object} cfg
 * @returns {{ model: object, provider: object }|null}
 */
function resolveAuxWebExtractTarget(cfg) {
    if (!isV2Config(cfg)) {
        return null;
    }
    const ref = cfg.aux?.web_extract?.ref;
    if (!ref) {
        return null;
    }
    const model = findModel(cfg, ref);
    const provider = model ? findProvider(cfg, model.provider_id) : null;
    if (!model || !provider?.base_url) {
        return null;
    }
    return { model, provider };
}

/**
 * Build default params from upstream /models meta.
 * @param {object|null|undefined} meta
 */
function paramsFromMeta(meta) {
    const params = {
        context_window_size: 0,
        max_output_tokens: 0,
        supports_images: 0,
        supports_tools: 0,
        supports_thinking: 0,
    };
    if (!meta) {
        return params;
    }
    if (meta.context) {
        params.context_window_size = meta.context;
    }
    if (meta.output) {
        params.max_output_tokens = meta.output;
    }
    if (meta.supportsNativeVision !== undefined) {
        params.supports_images = meta.supportsNativeVision ? 2 : 0;
    }
    if (meta.supportsTools !== undefined) {
        params.supports_tools = meta.supportsTools ? 1 : 0;
    }
    if (meta.supportsThinking !== undefined) {
        params.supports_thinking = meta.supportsThinking ? 1 : 0;
    }
    return params;
}

/**
 * Apply user edits onto model.params; mark param_source user.
 * @param {object} model
 * @param {object} edits
 */
function applyUserParams(model, edits) {
    if (!model.params || typeof model.params !== "object") {
        model.params = {};
    }
    const p = model.params;
    if (edits.thinking_mode !== undefined) {
        p.thinking_mode = edits.thinking_mode;
    }
    if (edits.context_window_size !== undefined) {
        p.context_window_size = edits.context_window_size;
    }
    if (edits.max_output_tokens !== undefined) {
        p.max_output_tokens = edits.max_output_tokens;
    }
    if (edits.temperature !== undefined) {
        if (edits.temperature === null) {
            delete p.temperature;
        }
        else {
            p.temperature = edits.temperature;
        }
    }
    if (edits.supports_images !== undefined) {
        p.supports_images = edits.supports_images;
    }
    if (edits.supports_tools !== undefined) {
        p.supports_tools = edits.supports_tools;
    }
    if (edits.supports_thinking !== undefined) {
        p.supports_thinking = edits.supports_thinking;
    }
    model.param_source = "user";
    return model;
}
