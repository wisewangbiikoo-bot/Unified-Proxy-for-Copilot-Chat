"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONTEXT_WINDOW_TOKENS = exports.DEFAULT_TEMPERATURE = void 0;
exports.parseProxyEntry = parseProxyEntry;
exports.parseVisionProxyConfig = parseVisionProxyConfig;
/** Default max output: omit from API request (unlimited). */
exports.DEFAULT_MAX_OUTPUT_TOKENS = undefined;
exports.DEFAULT_TEMPERATURE = 0.5;
/** 128K for Copilot UI (displays tokens/1000); use 128000 not 131072. */
exports.DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
/** Same enum as DeepSeek V4 Copilot UI: none | low | high | max */
const THINKING_OFF = new Set([
    "off",
    "none",
    "disabled",
    "停用",
    "0",
    "false",
]);
const THINKING_LIGHT = new Set([
    "low",
    "light",
    "轻量",
    "轻度",
    "quick",
    "fast",
]);
const THINKING_STANDARD = new Set([
    "high",
    "standard",
    "标准",
    "medium",
    "moderate",
    "中度",
    "中",
]);
const THINKING_DEEP = new Set(["max", "deep", "深度", "heavy", "重度", "高"]);
/**
 * Parse one proxy entry from proxy_configs.json.
 * Missing optional fields use documented defaults.
 */
function parseProxyEntry(proxy) {
    return {
        supportsImages: parseSupportsImages(proxy),
        supportsTools: parseSupportsTools(proxy),
        contextWindowTokens: parseContextWindowSize(proxy),
        maxOutputTokens: parseMaxOutputTokens(proxy),
        temperature: parseTemperature(proxy),
        thinkingMode: parseThinkingMode(proxy),
        visionProxy: parseVisionProxyConfig(proxy),
    };
}
function parseSupportsTools(proxy) {
    const raw = proxy.supports_tools ?? proxy.supportsTools ?? proxy["Supports Tools"];
    if (raw === undefined || raw === null || raw === "") {
        return true;
    }
    if (typeof raw === "boolean") {
        return raw;
    }
    if (typeof raw === "number") {
        return raw === 1;
    }
    const s = String(raw).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
}
function parseSupportsImages(proxy) {
    const raw = proxy.supports_images ?? proxy.supportsImages ?? proxy["Supports Images"];
    // Modes: 0=off, 1=vision-proxy text describe, 2=native OpenAI image_url
    if (raw === undefined || raw === null || raw === "") {
        return 0;
    }
    if (typeof raw === "boolean") {
        // Backward compat: true -> legacy describe path (1)
        return raw ? 1 : 0;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
        const n = Math.floor(raw);
        if (n <= 0) {
            return 0;
        }
        if (n === 1) {
            return 1;
        }
        return 2;
    }
    const s = String(raw).trim().toLowerCase();
    if (s === "0" || s === "false" || s === "no" || s === "off" || s === "none") {
        return 0;
    }
    if (s === "2" || s === "native" || s === "image_url" || s === "multimodal") {
        return 2;
    }
    if (s === "1" || s === "true" || s === "yes" || s === "describe" || s === "proxy") {
        return 1;
    }
    const n = Number(s);
    if (Number.isFinite(n)) {
        if (n <= 0) {
            return 0;
        }
        if (n === 1) {
            return 1;
        }
        return 2;
    }
    return 0;
}
function parseContextWindowSize(proxy) {
    const raw = proxy.context_window_size ??
        proxy.contextWindowSize ??
        proxy["Context Window Size"];
    if (raw === undefined || raw === null || raw === "") {
        return exports.DEFAULT_CONTEXT_WINDOW_TOKENS;
    }
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        return Math.floor(raw);
    }
    const text = String(raw).trim().toUpperCase();
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([KMG])?$/);
    if (!match) {
        const n = Number(text);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : exports.DEFAULT_CONTEXT_WINDOW_TOKENS;
    }
    const value = Number(match[1]);
    const unit = match[2];
    if (!unit) {
        return value >= 1000 ? Math.floor(value) : Math.floor(value * 1000);
    }
    const mult = unit === "K" ? 1000 : unit === "M" ? 1000 * 1000 : 1000 * 1000 * 1000;
    return Math.floor(value * mult);
}
function parseMaxOutputTokens(proxy) {
    const raw = proxy.max_output_tokens ??
        proxy.maxOutputTokens ??
        proxy["Max Output Tokens"];
    if (raw === undefined || raw === null || raw === "") {
        return exports.DEFAULT_MAX_OUTPUT_TOKENS;
    }
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n <= 0) {
        return exports.DEFAULT_MAX_OUTPUT_TOKENS;
    }
    return Math.floor(n);
}
function parseTemperature(proxy) {
    const raw = proxy.temperature ?? proxy.Temperature;
    if (raw === undefined || raw === null || raw === "") {
        return exports.DEFAULT_TEMPERATURE;
    }
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) {
        return exports.DEFAULT_TEMPERATURE;
    }
    return Math.min(2, Math.max(0, n));
}
/** Returns none | low | high | max (DeepSeek V4 reasoningEffort). Default: none (停用). */
function parseThinkingMode(proxy) {
    const raw = proxy.thinking_mode ??
        proxy.thinkingMode ??
        proxy["思考模式"] ??
        proxy.thinking;
    if (raw === undefined || raw === null || raw === "") {
        return "none";
    }
    const trimmed = String(raw).trim();
    const s = trimmed.toLowerCase();
    if (THINKING_OFF.has(s)) {
        return "none";
    }
    if (THINKING_DEEP.has(s) || THINKING_DEEP.has(trimmed)) {
        return "max";
    }
    if (THINKING_STANDARD.has(s) || THINKING_STANDARD.has(trimmed)) {
        return "high";
    }
    if (THINKING_LIGHT.has(s) || THINKING_LIGHT.has(trimmed)) {
        return "low";
    }
    return "none";
}

/**
 * Parse the optional vision_proxy config for a proxy entry.
 * Returns null if not configured.
 *
 * Config structure (in proxy_configs.json):
 *   "vision_proxy": {
 *     "type": "endpoint",           // "endpoint" | "vscode-lm"
 *     "protocol": "openai-chat",    // "openai-chat" | "openai-responses" | "anthropic-messages"
 *     "base_url": "http://...",     // endpoint URL (required for type=endpoint)
 *     "api_key": "...",             // API key for the endpoint
 *     "model_id": "...",            // vision model ID
 *     "custom_headers": { ... }     // optional extra HTTP headers
 *   }
 */
function parseVisionProxyConfig(proxy) {
    const raw = proxy.vision_proxy ?? proxy.visionProxy ?? null;
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const type = parseStringField(raw, "type", "vscode-lm").toLowerCase();
    if (type !== "endpoint" && type !== "vscode-lm") {
        return null;
    }
    if (type === "vscode-lm") {
        // type=vscode-lm means use VS Code LM API (existing behavior).
        // No extra fields needed; model selection via settings or default.
        return { type: "vscode-lm", protocol: null, baseUrl: null, apiKey: null, modelId: null, customHeaders: null };
    }
    // type=endpoint
    const protocol = parseStringField(raw, "protocol", "openai-chat").toLowerCase();
    const baseUrl = parseStringField(raw, "base_url") || parseStringField(raw, "baseUrl") || "";
    const apiKey = parseStringField(raw, "api_key") || parseStringField(raw, "apiKey") || "";
    const modelId = parseStringField(raw, "model_id") || parseStringField(raw, "modelId") || "";
    let customHeaders = null;
    if (raw.custom_headers && typeof raw.custom_headers === "object") {
        customHeaders = {};
        for (const [k, v] of Object.entries(raw.custom_headers)) {
            if (typeof v === "string") {
                customHeaders[k] = v;
            }
        }
    }
    if (!baseUrl) {
        return null;
    }
    return { type: "endpoint", protocol, baseUrl, apiKey, modelId, customHeaders };
}

function parseStringField(obj, key, fallback) {
    const v = obj[key];
    if (v && typeof v === "string") {
        return v.trim() || (fallback ?? "");
    }
    return fallback ?? "";
}
