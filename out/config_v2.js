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
exports.normalizeV2Config = normalizeV2Config;
exports.defaultAutoAssign = defaultAutoAssign;

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

function defaultAutoAssign() {
    return {
        mode: "manual",
        rotate_minutes: 5,
        rotate_every_n_requests: 10,
        model_ids: [],
    };
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
        auto_assign: defaultAutoAssign(),
    };
}

/**
 * Expand legacy provider.accounts into separate providers (one key each).
 * Moves provider.account_switch into top-level auto_assign when needed.
 * Mutates and returns cfg.
 * @param {object} cfg
 */
function normalizeV2Config(cfg) {
    if (!cfg || typeof cfg !== "object") {
        return cfg;
    }
    if (!cfg.auto_assign || typeof cfg.auto_assign !== "object") {
        cfg.auto_assign = defaultAutoAssign();
    }
    if (!Array.isArray(cfg.auto_assign.model_ids)) {
        cfg.auto_assign.model_ids = [];
    }
    const providers = Array.isArray(cfg.providers) ? cfg.providers : [];
    const models = Array.isArray(cfg.models) ? cfg.models : [];
    /** @type {object[]} */
    const nextProviders = [];
    /** @type {Map<string, string[]>} oldProviderId -> new provider ids */
    const remap = new Map();
    /** @type {string[]} */
    const autoFromAccounts = [];

    for (const prov of providers) {
        if (!prov || typeof prov !== "object") {
            continue;
        }
        const accounts = Array.isArray(prov.accounts) ? prov.accounts : null;
        const switchCfg = prov.account_switch || prov.accountSwitch;
        if (accounts && accounts.length > 0) {
            const ids = [];
            accounts.forEach((item, i) => {
                let apiKey = "";
                let accName = `账号${i + 1}`;
                let accId = `key-${i + 1}`;
                if (typeof item === "string") {
                    apiKey = item.trim();
                }
                else if (item && typeof item === "object") {
                    apiKey = String(item.api_key || item.apiKey || item.key || "").trim();
                    accName = String(item.name || item.label || accId).trim() || accId;
                    accId = String(item.id || accName || accId).trim() || accId;
                }
                if (!apiKey) {
                    return;
                }
                const baseName = String(prov.name || prov.id || "provider");
                const newId = ensureUniqueProviderId(
                    [...nextProviders, ...providers.filter((p) => !p.accounts)],
                    slugifyId(`${baseName}-${accId}`),
                );
                nextProviders.push({
                    id: newId,
                    name: accounts.length > 1 ? `${baseName} · ${accName}` : baseName,
                    base_url: prov.base_url,
                    api_key: apiKey,
                    ...(prov.custom_headers ? { custom_headers: prov.custom_headers } : {}),
                    ...(prov.opencode_session ? { opencode_session: prov.opencode_session } : {}),
                });
                ids.push(newId);
            });
            if (!ids.length) {
                // fallback single key
                nextProviders.push(stripProviderAccounts(prov));
                remap.set(prov.id, [prov.id]);
            }
            else {
                remap.set(prov.id, ids);
                if (ids.length > 1) {
                    for (const m of models.filter((x) => x.provider_id === prov.id)) {
                        // will remapped below — collect auto pool model ids after remap
                    }
                    if (switchCfg) {
                        applySwitchToAutoAssign(cfg.auto_assign, switchCfg);
                    }
                }
            }
        }
        else {
            nextProviders.push(stripProviderAccounts(prov));
            remap.set(prov.id, [prov.id]);
        }
    }

    // Remap models: one model entry per new provider when old provider was split
    /** @type {object[]} */
    const nextModels = [];
    for (const model of models) {
        const newProvIds = remap.get(model.provider_id) || [model.provider_id];
        if (newProvIds.length === 1 && newProvIds[0] === model.provider_id) {
            nextModels.push(model);
            continue;
        }
        for (const pid of newProvIds) {
            const newId = makeModelId(pid, model.model_id);
            if (nextModels.some((m) => m.id === newId)) {
                continue;
            }
            const prov = nextProviders.find((p) => p.id === pid);
            nextModels.push({
                ...model,
                id: newId,
                provider_id: pid,
                name:
                    newProvIds.length > 1
                        ? `${model.name || model.model_id} · ${(prov?.name || pid).split("·").pop()?.trim() || pid}`
                        : model.name,
            });
            autoFromAccounts.push(newId);
        }
    }

    cfg.providers = nextProviders;
    cfg.models = nextModels;

    if (autoFromAccounts.length && !(cfg.auto_assign.model_ids || []).length) {
        cfg.auto_assign.model_ids = [...new Set(autoFromAccounts)];
    }

    cfg.providers = (cfg.providers || []).map((p) => stripProviderAccounts(p));
    return cfg;
}

function stripProviderAccounts(prov) {
    delete prov.accounts;
    delete prov.account_switch;
    delete prov.accountSwitch;
    delete prov.api_keys;
    delete prov.apiKeys;
    return {
        id: prov.id,
        name: prov.name || prov.id,
        base_url: prov.base_url,
        api_key: String(prov.api_key || ""),
        ...(prov.custom_headers ? { custom_headers: prov.custom_headers } : {}),
        ...(prov.opencode_session ? { opencode_session: prov.opencode_session } : {}),
    };
}

function applySwitchToAutoAssign(autoAssign, switchCfg) {
    let mode = String(switchCfg.mode || "manual").trim().toLowerCase();
    if (mode === "rotate_requests" || mode === "requests") {
        mode = "rotate_requests";
    }
    else if (mode === "auto" || mode === "rotate" || mode === "time") {
        mode = "rotate";
    }
    else {
        mode = "manual";
    }
    autoAssign.mode = mode;
    if (switchCfg.rotate_minutes != null) {
        autoAssign.rotate_minutes = Number(switchCfg.rotate_minutes) || 5;
    }
    if (switchCfg.rotate_every_n_requests != null) {
        autoAssign.rotate_every_n_requests =
            Number(switchCfg.rotate_every_n_requests) || 10;
    }
}

/**
 * Collect account keys from a v1 proxy (legacy multi-key or single api_key).
 * @param {object} proxy
 * @returns {Array<{id:string,name:string,api_key:string}>}
 */
function extractV1Accounts(proxy) {
    const rawList = proxy?.accounts || proxy?.api_keys || proxy?.apiKeys;
    /** @type {Array<{id:string,name:string,api_key:string}>} */
    const accounts = [];
    if (Array.isArray(rawList) && rawList.length) {
        rawList.forEach((item, i) => {
            if (typeof item === "string" && item.trim()) {
                accounts.push({
                    id: `key-${i + 1}`,
                    name: `账号${i + 1}`,
                    api_key: item.trim(),
                });
                return;
            }
            if (item && typeof item === "object") {
                const key = String(item.api_key || item.apiKey || item.key || "").trim();
                if (!key) {
                    return;
                }
                const id = String(item.id || item.name || `key-${i + 1}`).trim() || `key-${i + 1}`;
                const name = String(item.name || item.label || id).trim() || id;
                accounts.push({ id, name, api_key: key });
            }
        });
    }
    if (!accounts.length) {
        const legacy = String(proxy?.api_key || proxy?.apiKey || "").trim();
        if (legacy) {
            accounts.push({ id: "default", name: "default", api_key: legacy });
        }
    }
    // dedupe by key
    const seen = new Set();
    const uniq = [];
    for (const a of accounts) {
        if (seen.has(a.api_key)) {
            continue;
        }
        seen.add(a.api_key);
        uniq.push(a);
    }
    return uniq;
}

/**
 * @param {object} cfg v1
 * @returns {object} v2
 */
function migrateV1ToV2(cfg) {
    const out = emptyV2Config();
    /** @type {string|null} */
    let visionRef = null;
    /** @type {string[]} */
    const autoIds = [];

    for (const [key, proxy] of Object.entries(cfg?.proxies || {})) {
        if (!proxy || typeof proxy !== "object") {
            continue;
        }
        const baseUrl = String(proxy.base_url || proxy.baseUrl || "").trim();
        if (!baseUrl) {
            continue;
        }
        const accounts = extractV1Accounts(proxy);
        if (!accounts.length) {
            continue;
        }
        const switchCfg = proxy.account_switch || proxy.accountSwitch || {};
        if (accounts.length > 1) {
            applySwitchToAutoAssign(out.auto_assign, switchCfg);
        }

        const upstreamModelId = String(proxy.model_id || proxy.modelId || key).trim();
        const params = extractParamsFromV1Proxy(proxy);
        const baseName = String(proxy.name || key || "provider");
        const groupModelIds = [];

        for (const acc of accounts) {
            const providerId = ensureUniqueProviderId(
                out.providers,
                slugifyId(
                    accounts.length > 1 ? `${baseName}-${acc.id}` : baseName || key,
                ),
            );
            const prov = {
                id: providerId,
                name: accounts.length > 1 ? `${baseName} · ${acc.name}` : baseName,
                base_url: baseUrl,
                api_key: acc.api_key,
            };
            if (proxy.custom_headers || proxy.customHeaders) {
                prov.custom_headers = proxy.custom_headers || proxy.customHeaders;
            }
            if (proxy.opencode_session || proxy.openCodeSession) {
                prov.opencode_session = proxy.opencode_session || proxy.openCodeSession;
            }
            out.providers.push(prov);

            const modelEntryId = makeModelId(providerId, upstreamModelId);
            if (!out.models.some((m) => m.id === modelEntryId)) {
                out.models.push({
                    id: modelEntryId,
                    provider_id: providerId,
                    model_id: upstreamModelId,
                    enabled: true,
                    name:
                        accounts.length > 1
                            ? `${proxy.name || upstreamModelId} · ${acc.name}`
                            : String(proxy.name || upstreamModelId),
                    description: String(proxy.description || ""),
                    params: { ...params },
                    param_source: "user",
                });
            }
            groupModelIds.push(modelEntryId);
        }
        if (groupModelIds.length > 1) {
            autoIds.push(...groupModelIds);
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
    if (autoIds.length) {
        out.auto_assign.model_ids = [...new Set(autoIds)];
    }
    return normalizeV2Config(out);
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
