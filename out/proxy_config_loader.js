"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProxyConfigPath = getProxyConfigPath;
exports.loadModelsFromConfig = loadModelsFromConfig;
exports.getProxyConfig = getProxyConfig;
exports.enrichModelsWithUpstreamLimits = enrichModelsWithUpstreamLimits;
exports.clearAutoLimitsOverrides = clearAutoLimitsOverrides;
exports.parseModelRef = parseModelRef;
exports.readConfigFile = readConfigFile;
exports.writeConfigFile = writeConfigFile;
exports.upgradeConfigToV2 = upgradeConfigToV2;
exports.getAccountLookupKey = getAccountLookupKey;
exports.MODEL_ACCOUNT_SEP = void 0;
const fs = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const vscode_1 = require("vscode");
const proxy_config_parse_1 = require("./proxy_config_parse");
const upstream_model_limits_1 = require("./upstream_model_limits");
const config_v2_1 = require("./config_v2");
const logger_1 = require("./logger");
const CONFIG_SECTION = "unified-proxy-copilot";
/** When max_output_tokens unset, use 0 so Copilot shows input context only (not input+output). */
const UNLIMITED_OUTPUT_DISPLAY_TOKENS = 0;
const EMPTY_CONFIG = '{\n  "schema_version": 2,\n  "providers": [],\n  "models": [],\n  "aux": {\n    "vision": { "base_url": "", "api_key": "", "model_id": "" },\n    "web_extract": { "base_url": "", "api_key": "", "model_id": "" }\n  }\n}\n';
/** Multi-account model id: `${proxyKey}:::${accountId}` (shown as separate Copilot models). */
const MODEL_ACCOUNT_SEP = ":::";
exports.MODEL_ACCOUNT_SEP = MODEL_ACCOUNT_SEP;

/**
 * @param {string} modelId
 * @returns {{ proxyKey: string, accountId: string }}
 */
function parseModelRef(modelId) {
    const s = String(modelId || "");
    const idx = s.lastIndexOf(MODEL_ACCOUNT_SEP);
    if (idx > 0) {
        return {
            proxyKey: s.slice(0, idx),
            accountId: s.slice(idx + MODEL_ACCOUNT_SEP.length),
        };
    }
    return { proxyKey: s, accountId: "" };
}

/**
 * In-memory only — never written back to proxy_configs.json.
 * @type {Map<string, {
 *   context?: number,
 *   output?: number,
 *   supportsImages?: number,
 *   supportsTools?: boolean,
 *   supportsThinking?: boolean,
 * }>}
 */
const autoLimitsOverrides = new Map();

function clearAutoLimitsOverrides() {
    autoLimitsOverrides.clear();
    (0, upstream_model_limits_1.clearUpstreamLimitsCache)();
}

function getProxyConfigPath() {
    const config = vscode_1.workspace.getConfiguration(CONFIG_SECTION);
    const custom = String(config.get("proxyConfigPath") ?? "").trim();
    return custom || path_1.join(os_1.homedir(), ".vscode", "proxy_configs.json");
}

function ensureConfigFileExists() {
    const configPath = getProxyConfigPath();
    if (fs.existsSync(configPath)) {
        return;
    }
    const dir = path_1.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const examplePath = path_1.join(__dirname, "..", "proxy_configs.json.example");
    const content = fs.existsSync(examplePath)
        ? fs.readFileSync(examplePath, "utf-8")
        : EMPTY_CONFIG;
    fs.writeFileSync(configPath, content, "utf-8");
}

/**
 * @returns {{ ok: boolean, cfg?: object, error?: string, path: string }}
 */
function readConfigFile() {
    const configPath = getProxyConfigPath();
    try {
        ensureConfigFileExists();
        if (!fs.existsSync(configPath)) {
            return { ok: false, error: "missing", path: configPath };
        }
        let cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if ((0, config_v2_1.isV2Config)(cfg)) {
            cfg = (0, config_v2_1.normalizeV2Config)(cfg);
        }
        return { ok: true, cfg, path: configPath };
    }
    catch (e) {
        return { ok: false, error: e?.message || String(e), path: configPath };
    }
}

/**
 * @param {object} cfg
 */
function writeConfigFile(cfg) {
    const configPath = getProxyConfigPath();
    const dir = path_1.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let doc = cfg;
    if ((0, config_v2_1.isV2Config)(doc)) {
        doc = (0, config_v2_1.normalizeV2Config)(JSON.parse(JSON.stringify(doc)));
    }
    fs.writeFileSync(configPath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
    try {
        require("./auto_assign").rescheduleAutoAssignRotator();
    }
    catch {
        /* optional */
    }
    return configPath;
}

/**
 * Backup then rewrite disk as schema_version 2.
 * @returns {{ ok: boolean, path?: string, bak?: string, error?: string }}
 */
function upgradeConfigToV2() {
    const { ok, cfg, path: configPath, error } = readConfigFile();
    if (!ok || !cfg) {
        return { ok: false, error: error || "read failed" };
    }
    if ((0, config_v2_1.isV2Config)(cfg)) {
        return { ok: true, path: configPath, bak: "" };
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = `${configPath}.bak-${stamp}`;
    try {
        fs.copyFileSync(configPath, bak);
        const v2 = (0, config_v2_1.migrateV1ToV2)(cfg);
        writeConfigFile(v2);
        logger_1.logger.info(`Upgraded proxy_configs to schema_version 2; backup=${bak}`);
        return { ok: true, path: configPath, bak };
    }
    catch (e) {
        return { ok: false, error: e?.message || String(e) };
    }
}

/**
 * Account-manager key: provider id (v2) or proxy key (v1).
 * @param {string} modelOrProxyKey
 * @param {object} [cfg]
 */
function getAccountLookupKey(modelOrProxyKey, cfg) {
    const { proxyKey } = parseModelRef(modelOrProxyKey);
    const doc = cfg || readConfigFile().cfg;
    if (doc && (0, config_v2_1.isV2Config)(doc)) {
        const model = (0, config_v2_1.findModel)(doc, proxyKey);
        if (model?.provider_id) {
            return model.provider_id;
        }
        if ((0, config_v2_1.findProvider)(doc, proxyKey)) {
            return proxyKey;
        }
    }
    return proxyKey;
}

function applyAutoOverrides(overrideKey, options) {
    const over = autoLimitsOverrides.get(overrideKey);
    if (!over) {
        return options;
    }
    const next = { ...options };
    if (!options.contextWindowFromConfig && over.context) {
        next.contextWindowTokens = over.context;
    }
    if (!options.maxOutputFromConfig && over.output) {
        next.maxOutputTokens = over.output;
    }
    if (!options.supportsImagesFromConfig && over.supportsImages !== undefined) {
        next.supportsImages = over.supportsImages;
    }
    if (!options.supportsToolsFromConfig && over.supportsTools !== undefined) {
        next.supportsTools = over.supportsTools;
    }
    if (!options.supportsThinkingFromConfig && over.supportsThinking !== undefined) {
        next.supportsThinking = over.supportsThinking;
    }
    return next;
}

function buildModelFromProxy(key, proxy, account) {
    const options = applyAutoOverrides(key, (0, proxy_config_parse_1.parseProxyEntry)(proxy));
    const maxOutputForUi = options.maxOutputTokens ?? UNLIMITED_OUTPUT_DISPLAY_TOKENS;
    const id = account ? `${key}${MODEL_ACCOUNT_SEP}${account.id}` : key;
    const baseName = proxy.name || key;
    const name = account ? `${baseName} · ${account.name}` : baseName;
    const detail = account
        ? `${proxy.description || baseName} · ${account.name}`
        : proxy.description || `${baseName} - ${proxy.model_id}`;
    return {
        id,
        name,
        family: "unified-proxy",
        version: "auto",
        detail,
        maxInputTokens: options.contextWindowTokens,
        maxOutputTokens: maxOutputForUi,
        capabilities: {
            toolCalling: Boolean(options.supportsTools),
            imageInput: options.supportsImages > 0,
            thinking: Boolean(options.supportsThinking),
        },
        requiresThinkingParam: false,
        _proxyKey: key,
        _accountId: account?.id || "",
        _providerId: proxy._providerId || key,
        _proxyConfig: {
            baseUrl: proxy.base_url,
            apiKey: account?.api_key || proxy.api_key,
            modelId: proxy.model_id,
            supportsImages: options.supportsImages,
            supportsImagesFromConfig: options.supportsImagesFromConfig,
            supportsTools: options.supportsTools,
            supportsToolsFromConfig: options.supportsToolsFromConfig,
            supportsThinking: options.supportsThinking,
            supportsThinkingFromConfig: options.supportsThinkingFromConfig,
            visionProxy: options.visionProxy,
            contextWindowTokens: options.contextWindowTokens,
            contextWindowFromConfig: options.contextWindowFromConfig,
            maxOutputTokens: options.maxOutputTokens,
            maxOutputFromConfig: options.maxOutputFromConfig,
            temperature: options.temperature,
            thinkingMode: options.thinkingMode,
            customHeaders: options.customHeaders,
            openCodeSession: options.openCodeSession,
        },
    };
}

function loadModelsFromConfig() {
    try {
        ensureConfigFileExists();
        const { ok, cfg } = readConfigFile();
        if (!ok || !cfg) {
            return [];
        }
        if ((0, config_v2_1.isV2Config)(cfg)) {
            return loadModelsV2(cfg);
        }
        const models = [];
        if (cfg.proxies) {
            for (const [key, proxy] of Object.entries(cfg.proxies)) {
                if (!proxy?.base_url) {
                    continue;
                }
                models.push(buildModelFromProxy(key, proxy));
            }
        }
        return models;
    }
    catch {
        return [];
    }
}

function loadModelsV2(cfg) {
    const models = [];
    for (const model of cfg.models || []) {
        if (!model?.enabled) {
            continue;
        }
        const provider = (0, config_v2_1.findProvider)(cfg, model.provider_id);
        if (!provider?.base_url) {
            continue;
        }
        const proxy = (0, config_v2_1.modelToProxyShape)(model, provider);
        proxy._providerId = provider.id;
        models.push(buildModelFromProxy(model.id, proxy));
    }
    try {
        const auto_assign_1 = require("./auto_assign");
        const autoModel = auto_assign_1.buildAutoAssignChatModel(cfg);
        if (autoModel) {
            models.unshift(autoModel);
        }
    }
    catch {
        /* optional */
    }
    return models;
}

function getProxyConfig(modelId) {
    try {
        const { ok, cfg } = readConfigFile();
        if (!ok || !cfg) {
            return null;
        }
        const { proxyKey, accountId } = parseModelRef(modelId);
        if ((0, config_v2_1.isV2Config)(cfg)) {
            return getProxyConfigV2(cfg, proxyKey, accountId);
        }
        const proxy = cfg.proxies?.[proxyKey];
        if (!proxy?.base_url) {
            return null;
        }
        const account_manager_1 = require("./account_manager");
        if (accountId) {
            account_manager_1.setActiveAccountId(proxyKey, accountId, "model-select");
        }
        const options = applyAutoOverrides(proxyKey, (0, proxy_config_parse_1.parseProxyEntry)(proxy));
        const resolved = account_manager_1.resolveApiKeyForProxy(proxyKey, proxy);
        return {
            baseUrl: proxy.base_url,
            apiKey: resolved.apiKey || proxy.api_key,
            accountId: resolved.account?.id || accountId || "",
            accountName: resolved.account?.name || "",
            proxyKey,
            providerId: proxyKey,
            modelId: proxy.model_id,
            supportsImages: options.supportsImages,
            supportsImagesFromConfig: options.supportsImagesFromConfig,
            supportsTools: options.supportsTools,
            supportsToolsFromConfig: options.supportsToolsFromConfig,
            supportsThinking: options.supportsThinking,
            supportsThinkingFromConfig: options.supportsThinkingFromConfig,
            visionProxy: options.visionProxy,
            contextWindowTokens: options.contextWindowTokens,
            contextWindowFromConfig: options.contextWindowFromConfig,
            maxOutputTokens: options.maxOutputTokens,
            maxOutputFromConfig: options.maxOutputFromConfig,
            temperature: options.temperature,
            thinkingMode: options.thinkingMode,
            customHeaders: options.customHeaders,
            openCodeSession: options.openCodeSession,
            schemaVersion: 1,
        };
    }
    catch {
        return null;
    }
}

function getProxyConfigV2(cfg, modelEntryId, accountId) {
    const auto_assign_1 = require("./auto_assign");
    let resolvedEntryId = modelEntryId;
    let isAutoAssign = false;
    if (auto_assign_1.isAutoAssignModelId(modelEntryId)) {
        const target = auto_assign_1.getCurrentAutoAssignTargetId(cfg);
        if (!target) {
            return null;
        }
        resolvedEntryId = target;
        isAutoAssign = true;
    }

    const model = (0, config_v2_1.findModel)(cfg, resolvedEntryId);
    if (!model?.enabled) {
        return null;
    }
    const provider = (0, config_v2_1.findProvider)(cfg, model.provider_id);
    if (!provider?.base_url) {
        return null;
    }
    const proxy = (0, config_v2_1.modelToProxyShape)(model, provider);
    const options = applyAutoOverrides(resolvedEntryId, (0, proxy_config_parse_1.parseProxyEntry)(proxy));
    const apiKey = String(provider.api_key || "").trim();

    // Prefer global aux.vision over per-entry vision_proxy (v2 has none on models)
    let visionProxy = options.visionProxy;
    const auxVision = (0, config_v2_1.resolveAuxVisionProxy)(cfg, (_pid, prov) =>
        String(prov?.api_key || ""),
    );
    if (auxVision) {
        visionProxy = (0, proxy_config_parse_1.parseVisionProxyConfig)({ vision_proxy: auxVision });
    }

    return {
        baseUrl: provider.base_url,
        apiKey,
        accountId: provider.id,
        accountName: provider.name || provider.id,
        proxyKey: isAutoAssign ? auto_assign_1.AUTO_ASSIGN_MODEL_ID : resolvedEntryId,
        providerId: provider.id,
        modelId: model.model_id,
        resolvedModelEntryId: resolvedEntryId,
        isAutoAssign,
        supportsImages: options.supportsImages,
        supportsImagesFromConfig: options.supportsImagesFromConfig,
        supportsTools: options.supportsTools,
        supportsToolsFromConfig: options.supportsToolsFromConfig,
        supportsThinking: options.supportsThinking,
        supportsThinkingFromConfig: options.supportsThinkingFromConfig,
        visionProxy,
        contextWindowTokens: options.contextWindowTokens,
        contextWindowFromConfig: options.contextWindowFromConfig,
        maxOutputTokens: options.maxOutputTokens,
        maxOutputFromConfig: options.maxOutputFromConfig,
        temperature: options.temperature,
        thinkingMode: options.thinkingMode,
        customHeaders: options.customHeaders,
        openCodeSession: options.openCodeSession,
        schemaVersion: 2,
        auxVisionRef: cfg.aux?.vision?.ref || null,
        auxWebExtractRef: cfg.aux?.web_extract?.ref || null,
        hasAuxVision: (0, config_v2_1.isAuxConfigured)(cfg.aux?.vision),
        hasAuxWebExtract: (0, config_v2_1.isAuxConfigured)(cfg.aux?.web_extract),
    };
}

function needsUpstreamEnrichment(pc) {
    return (
        !pc.contextWindowFromConfig ||
        !pc.maxOutputFromConfig ||
        !pc.supportsImagesFromConfig ||
        !pc.supportsToolsFromConfig ||
        !pc.supportsThinkingFromConfig
    );
}

/**
 * For omitted config fields, GET upstream /models and fill from OpenCode-style meta.
 * @returns {Promise<boolean>} true if any model was updated
 */
async function enrichModelsWithUpstreamLimits(models) {
    if (!Array.isArray(models) || models.length === 0) {
        return false;
    }
    /** @type {Map<string, { baseUrl: string, apiKey: string, customHeaders: any, openCodeSession: string, items: any[] }>} */
    const groups = new Map();
    for (const m of models) {
        const pc = m?._proxyConfig;
        if (!pc?.baseUrl || !needsUpstreamEnrichment(pc)) {
            continue;
        }
        const gkey = `${pc.baseUrl}\n${pc.apiKey || ""}`;
        let g = groups.get(gkey);
        if (!g) {
            g = {
                baseUrl: pc.baseUrl,
                apiKey: pc.apiKey || "",
                customHeaders: pc.customHeaders,
                openCodeSession: pc.openCodeSession || "",
                items: [],
            };
            groups.set(gkey, g);
        }
        g.items.push(m);
    }
    if (groups.size === 0) {
        return false;
    }

    let changed = false;
    for (const g of groups.values()) {
        const headers = (0, upstream_model_limits_1.buildListHeaders)(
            g.baseUrl,
            g.customHeaders,
            g.openCodeSession,
        );
        const catalog = await (0, upstream_model_limits_1.fetchUpstreamModelLimits)(
            g.baseUrl,
            g.apiKey,
            headers,
        );
        if (!catalog || catalog.size === 0) {
            continue;
        }
        for (const m of g.items) {
            const pc = m._proxyConfig;
            const modelId = String(pc.modelId || "").trim();
            if (!modelId) {
                continue;
            }
            const meta = catalog.get(modelId);
            if (!meta) {
                logger_1.logger.info(
                    `No upstream meta for model_id=${modelId} (proxy ${m.id}); keeping defaults`,
                );
                continue;
            }
            const overrideKey = m._proxyKey || parseModelRef(m.id).proxyKey || m.id;
            const prev = autoLimitsOverrides.get(overrideKey) || {};
            const next = { ...prev };
            let localChange = false;
            const bits = [];

            if (!pc.contextWindowFromConfig && meta.context) {
                if (m.maxInputTokens !== meta.context || pc.contextWindowTokens !== meta.context) {
                    m.maxInputTokens = meta.context;
                    pc.contextWindowTokens = meta.context;
                    next.context = meta.context;
                    localChange = true;
                }
                bits.push(`context=${meta.context}`);
            }
            if (!pc.maxOutputFromConfig && meta.output) {
                if (m.maxOutputTokens !== meta.output || pc.maxOutputTokens !== meta.output) {
                    m.maxOutputTokens = meta.output;
                    pc.maxOutputTokens = meta.output;
                    next.output = meta.output;
                    localChange = true;
                }
                bits.push(`output=${meta.output}`);
            }
            if (!pc.supportsImagesFromConfig && meta.supportsNativeVision !== undefined) {
                const mode = meta.supportsNativeVision ? 2 : 0;
                if (pc.supportsImages !== mode) {
                    pc.supportsImages = mode;
                    m.capabilities.imageInput = mode > 0;
                    next.supportsImages = mode;
                    localChange = true;
                }
                bits.push(`images=${mode}`);
            }
            if (!pc.supportsToolsFromConfig && meta.supportsTools !== undefined) {
                if (pc.supportsTools !== meta.supportsTools) {
                    pc.supportsTools = meta.supportsTools;
                    m.capabilities.toolCalling = Boolean(meta.supportsTools);
                    next.supportsTools = meta.supportsTools;
                    localChange = true;
                }
                bits.push(`tools=${meta.supportsTools}`);
            }
            if (!pc.supportsThinkingFromConfig && meta.supportsThinking !== undefined) {
                if (pc.supportsThinking !== meta.supportsThinking) {
                    pc.supportsThinking = meta.supportsThinking;
                    m.capabilities.thinking = Boolean(meta.supportsThinking);
                    next.supportsThinking = meta.supportsThinking;
                    localChange = true;
                }
                bits.push(`thinking=${meta.supportsThinking}`);
            }

            if (localChange) {
                autoLimitsOverrides.set(overrideKey, next);
                changed = true;
                logger_1.logger.info(
                    `Auto meta for ${m.id} (proxy=${overrideKey}, model_id=${modelId}): ${bits.join(" ") || "(unchanged values)"}`,
                );
            }
        }
    }
    return changed;
}
