"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProxyConfigPath = getProxyConfigPath;
exports.loadModelsFromConfig = loadModelsFromConfig;
exports.getProxyConfig = getProxyConfig;
exports.enrichModelsWithUpstreamLimits = enrichModelsWithUpstreamLimits;
exports.clearAutoLimitsOverrides = clearAutoLimitsOverrides;
exports.parseModelRef = parseModelRef;
const fs = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const vscode_1 = require("vscode");
const proxy_config_parse_1 = require("./proxy_config_parse");
const upstream_model_limits_1 = require("./upstream_model_limits");
const logger_1 = require("./logger");
const CONFIG_SECTION = "unified-proxy-copilot";
/** When max_output_tokens unset, use 0 so Copilot shows input context only (not input+output). */
const UNLIMITED_OUTPUT_DISPLAY_TOKENS = 0;
const EMPTY_CONFIG = '{\n  "proxies": {}\n}\n';
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
 * Cleared on Reload Config / restart; re-fetched from upstream /models each time.
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
function applyAutoOverrides(proxyKey, options) {
    const over = autoLimitsOverrides.get(proxyKey);
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
            // Boolean capability (DeepSeek 0.9.4 #291): no stale numeric 128-tool cap.
            toolCalling: Boolean(options.supportsTools),
            // Copilot UI: allow attaching images for modes 1 and 2
            imageInput: options.supportsImages > 0,
            thinking: Boolean(options.supportsThinking),
        },
        requiresThinkingParam: false,
        _proxyKey: key,
        _accountId: account?.id || "",
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
        const configPath = getProxyConfigPath();
        if (!fs.existsSync(configPath)) {
            return [];
        }
        const proxyConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const models = [];
        if (proxyConfig.proxies) {
            for (const [key, proxy] of Object.entries(proxyConfig.proxies)) {
                if (!proxy?.base_url) {
                    continue;
                }
                // One Copilot model per proxy entry; multi-account switched in「设置」panel.
                models.push(buildModelFromProxy(key, proxy));
            }
        }
        return models;
    }
    catch {
        return [];
    }
}
function getProxyConfig(modelId) {
    try {
        const configPath = getProxyConfigPath();
        if (!fs.existsSync(configPath)) {
            return null;
        }
        const proxyConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const { proxyKey, accountId } = parseModelRef(modelId);
        const proxy = proxyConfig.proxies?.[proxyKey];
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
        };
    }
    catch {
        return null;
    }
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
 * Mutates `models` in place and updates autoLimitsOverrides.
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
            // Vision: only native (2) or off (0). Mode 1 (describe proxy) stays config-only.
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
