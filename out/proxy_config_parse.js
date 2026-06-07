"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONTEXT_WINDOW_TOKENS = exports.DEFAULT_TEMPERATURE = void 0;
exports.parseProxyEntry = parseProxyEntry;
/** Default max output: omit from API request (unlimited). */
exports.DEFAULT_MAX_OUTPUT_TOKENS = undefined;
exports.DEFAULT_TEMPERATURE = 0.5;
/** 128K for Copilot UI (displays tokens/1000); use 128000 not 131072. */
exports.DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
/** Same enum as DeepSeek V4 Copilot UI: none | high | max */
const THINKING_OFF = new Set([
    "off",
    "none",
    "disabled",
    "停用",
    "0",
    "false",
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
    if (raw === undefined || raw === null || raw === "") {
        return false;
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
/** Returns none | high | max (DeepSeek V4 reasoningEffort). Default: none (停用). */
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
    return "none";
}
