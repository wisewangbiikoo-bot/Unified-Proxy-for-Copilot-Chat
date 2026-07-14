"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProxyConfigPath = getProxyConfigPath;
exports.loadModelsFromConfig = loadModelsFromConfig;
exports.getProxyConfig = getProxyConfig;
const fs = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const vscode_1 = require("vscode");
const proxy_config_parse_1 = require("./proxy_config_parse");
const CONFIG_SECTION = "unified-proxy-copilot";
/** When max_output_tokens unset, use 0 so Copilot shows input context only (not input+output). */
const UNLIMITED_OUTPUT_DISPLAY_TOKENS = 0;
const EMPTY_CONFIG = '{\n  "proxies": {}\n}\n';
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
function buildModelFromProxy(key, proxy) {
    const options = (0, proxy_config_parse_1.parseProxyEntry)(proxy);
    const maxOutputForUi = options.maxOutputTokens ?? UNLIMITED_OUTPUT_DISPLAY_TOKENS;
    return {
        id: key,
        name: proxy.name || key,
        family: "unified-proxy",
        version: "auto",
        detail: proxy.description || `${proxy.name} - ${proxy.model_id}`,
        maxInputTokens: options.contextWindowTokens,
        maxOutputTokens: maxOutputForUi,
        capabilities: {
            toolCalling: options.supportsTools ? 128 : 0,
            // Copilot UI: allow attaching images for modes 1 and 2
            imageInput: options.supportsImages > 0,
            thinking: true,
        },
        requiresThinkingParam: false,
        _proxyConfig: {
            baseUrl: proxy.base_url,
            apiKey: proxy.api_key,
            modelId: proxy.model_id,
            supportsImages: options.supportsImages,
            visionProxy: options.visionProxy,
            contextWindowTokens: options.contextWindowTokens,
            maxOutputTokens: options.maxOutputTokens,
            temperature: options.temperature,
            thinkingMode: options.thinkingMode,
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
        const proxy = proxyConfig.proxies?.[modelId];
        if (!proxy?.base_url) {
            return null;
        }
        const options = (0, proxy_config_parse_1.parseProxyEntry)(proxy);
        return {
            baseUrl: proxy.base_url,
            apiKey: proxy.api_key,
            modelId: proxy.model_id,
            supportsImages: options.supportsImages,
            visionProxy: options.visionProxy,
            contextWindowTokens: options.contextWindowTokens,
            maxOutputTokens: options.maxOutputTokens,
            temperature: options.temperature,
            thinkingMode: options.thinkingMode,
        };
    }
    catch {
        return null;
    }
}
