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
    const context = parseContextWindowSize(proxy);
    const maxOut = parseMaxOutputTokens(proxy);
    const images = parseSupportsImages(proxy);
    const tools = parseSupportsTools(proxy);
    const thinking = parseSupportsThinking(proxy);
    return {
        supportsImages: images.value,
        supportsImagesFromConfig: images.fromConfig,
        supportsTools: tools.value,
        supportsToolsFromConfig: tools.fromConfig,
        supportsThinking: thinking.value,
        supportsThinkingFromConfig: thinking.fromConfig,
        contextWindowTokens: context.value,
        contextWindowFromConfig: context.fromConfig,
        maxOutputTokens: maxOut.value,
        maxOutputFromConfig: maxOut.fromConfig,
        temperature: parseTemperature(proxy),
        thinkingMode: parseThinkingMode(proxy),
        visionProxy: parseVisionProxyConfig(proxy),
        customHeaders: parseCustomHeaders(proxy),
        openCodeSession: parseOpenCodeSessionOverride(proxy),
    };
}
/**
 * @returns {{ value: boolean, fromConfig: boolean }}
 * Default true until upstream says otherwise (OpenAI-compat gateways usually support tools).
 */
function parseSupportsTools(proxy) {
    const raw = proxy.supports_tools ?? proxy.supportsTools ?? proxy["Supports Tools"];
    if (raw === undefined || raw === null || raw === "") {
        return { value: true, fromConfig: false };
    }
    if (typeof raw === "boolean") {
        return { value: raw, fromConfig: true };
    }
    if (typeof raw === "number") {
        return { value: raw === 1, fromConfig: true };
    }
    const s = String(raw).trim().toLowerCase();
    return {
        value: s === "1" || s === "true" || s === "yes",
        fromConfig: true,
    };
}
/**
 * Optional supports_thinking / supportsThinking. Default true (show thinking menu)
 * until upstream capabilities.reasoning says otherwise.
 * @returns {{ value: boolean, fromConfig: boolean }}
 */
function parseSupportsThinking(proxy) {
    const raw =
        proxy.supports_thinking ??
        proxy.supportsThinking ??
        proxy["Supports Thinking"];
    if (raw === undefined || raw === null || raw === "") {
        return { value: true, fromConfig: false };
    }
    if (typeof raw === "boolean") {
        return { value: raw, fromConfig: true };
    }
    if (typeof raw === "number") {
        return { value: raw === 1, fromConfig: true };
    }
    const s = String(raw).trim().toLowerCase();
    if (s === "0" || s === "false" || s === "no" || s === "off" || s === "none") {
        return { value: false, fromConfig: true };
    }
    return { value: true, fromConfig: true };
}
/**
 * Modes: 0=off, 1=vision-proxy text describe, 2=native OpenAI image_url
 * Omitted → fromConfig=false (may auto-set to 2/0 from upstream modalities).
 * @returns {{ value: number, fromConfig: boolean }}
 */
function parseSupportsImages(proxy) {
    const raw = proxy.supports_images ?? proxy.supportsImages ?? proxy["Supports Images"];
    if (raw === undefined || raw === null || raw === "") {
        return { value: 0, fromConfig: false };
    }
    if (typeof raw === "boolean") {
        // Backward compat: true -> legacy describe path (1)
        return { value: raw ? 1 : 0, fromConfig: true };
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
        const n = Math.floor(raw);
        if (n <= 0) {
            return { value: 0, fromConfig: true };
        }
        if (n === 1) {
            return { value: 1, fromConfig: true };
        }
        return { value: 2, fromConfig: true };
    }
    const s = String(raw).trim().toLowerCase();
    if (s === "0" || s === "false" || s === "no" || s === "off" || s === "none") {
        return { value: 0, fromConfig: true };
    }
    if (s === "2" || s === "native" || s === "image_url" || s === "multimodal") {
        return { value: 2, fromConfig: true };
    }
    if (s === "1" || s === "true" || s === "yes" || s === "describe" || s === "proxy") {
        return { value: 1, fromConfig: true };
    }
    const n = Number(s);
    if (Number.isFinite(n)) {
        if (n <= 0) {
            return { value: 0, fromConfig: true };
        }
        if (n === 1) {
            return { value: 1, fromConfig: true };
        }
        return { value: 2, fromConfig: true };
    }
    return { value: 0, fromConfig: true };
}
/**
 * @returns {{ value: number, fromConfig: boolean }}
 * fromConfig=false → may be replaced by upstream /v1/models limit.context
 */
function parseContextWindowSize(proxy) {
    const raw = proxy.context_window_size ??
        proxy.contextWindowSize ??
        proxy["Context Window Size"];
    if (raw === undefined || raw === null || raw === "") {
        return { value: exports.DEFAULT_CONTEXT_WINDOW_TOKENS, fromConfig: false };
    }
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        return { value: Math.floor(raw), fromConfig: true };
    }
    const text = String(raw).trim().toUpperCase();
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([KMG])?$/);
    if (!match) {
        const n = Number(text);
        if (Number.isFinite(n) && n > 0) {
            return { value: Math.floor(n), fromConfig: true };
        }
        return { value: exports.DEFAULT_CONTEXT_WINDOW_TOKENS, fromConfig: false };
    }
    const value = Number(match[1]);
    const unit = match[2];
    if (!unit) {
        const n = value >= 1000 ? Math.floor(value) : Math.floor(value * 1000);
        return { value: n, fromConfig: true };
    }
    const mult = unit === "K" ? 1000 : unit === "M" ? 1000 * 1000 : 1000 * 1000 * 1000;
    return { value: Math.floor(value * mult), fromConfig: true };
}
/**
 * @returns {{ value: number|undefined, fromConfig: boolean }}
 * fromConfig=false → may be replaced by upstream /v1/models limit.output
 * Explicit 0 / negative → unlimited, but fromConfig=true (do not auto-fill)
 */
function parseMaxOutputTokens(proxy) {
    const raw = proxy.max_output_tokens ??
        proxy.maxOutputTokens ??
        proxy["Max Output Tokens"];
    if (raw === undefined || raw === null || raw === "") {
        return { value: exports.DEFAULT_MAX_OUTPUT_TOKENS, fromConfig: false };
    }
    const n = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || n <= 0) {
        return { value: exports.DEFAULT_MAX_OUTPUT_TOKENS, fromConfig: true };
    }
    return { value: Math.floor(n), fromConfig: true };
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
        return { type: "vscode-lm", protocol: null, baseUrl: null, apiKey: null, modelId: null, customHeaders: null, timeoutMs: null };
    }
    // type=endpoint
    const protocol = parseStringField(raw, "protocol", "openai-chat").toLowerCase();
    const baseUrl = parseStringField(raw, "base_url") || parseStringField(raw, "baseUrl") || "";
    const apiKey = parseStringField(raw, "api_key") || parseStringField(raw, "apiKey") || "";
    const modelId = parseStringField(raw, "model_id") || parseStringField(raw, "modelId") || "";
    let customHeaders = parseCustomHeaders(raw);
    const timeoutMs = parseTimeoutMs(raw);
    if (!baseUrl) {
        return null;
    }
    return { type: "endpoint", protocol, baseUrl, apiKey, modelId, customHeaders, timeoutMs };
}

/**
 * Parse optional custom_headers / headers object from a proxy or vision_proxy entry.
 * @returns {Record<string,string>|null}
 */
function parseCustomHeaders(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const src = raw.custom_headers ?? raw.customHeaders ?? raw.headers;
    if (!src || typeof src !== "object" || Array.isArray(src)) {
        return null;
    }
    const customHeaders = {};
    for (const [k, v] of Object.entries(src)) {
        if (typeof v === "string" && k) {
            customHeaders[k] = v;
        }
    }
    return Object.keys(customHeaders).length > 0 ? customHeaders : null;
}

/**
 * Optional fixed OpenCode session string on a proxy entry
 * (`opencode_session` / `openCodeSession`). Empty = use conversation segment.
 */
function parseOpenCodeSessionOverride(proxy) {
    const raw =
        proxy.opencode_session ??
        proxy.openCodeSession ??
        proxy["opencode-session"];
    if (raw === undefined || raw === null || raw === "") {
        return "";
    }
    return String(raw).trim();
}

function parseTimeoutMs(raw) {
    const v = raw.timeout_ms ?? raw.timeoutMs ?? raw.timeout;
    if (v === undefined || v === null || v === "") {
        return undefined;
    }
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isFinite(n) || n <= 0) {
        return undefined;
    }
    return Math.floor(n);
}

function parseStringField(obj, key, fallback) {
    const v = obj[key];
    if (v && typeof v === "string") {
        return v.trim() || (fallback ?? "");
    }
    return fallback ?? "";
}
