"use strict";
/**
 * OpenCode Go requires a stable per-conversation `x-opencode-session` header
 * for routing / prompt-cache affinity (MissingSessionID otherwise).
 * See https://opencode.ai/docs/go/#where-can-i-use-it
 *
 * DeepSeek V4 for Copilot Chat tracks the same need in Vizards#264; this
 * extension implements it for multi-backend proxy_configs.json routing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENCODE_CLIENT_NAME = void 0;
exports.DEFAULT_OPENCODE_SESSION = void 0;
exports.isOpenCodeGoEndpoint = isOpenCodeGoEndpoint;
exports.sanitizeOpenCodeSessionId = sanitizeOpenCodeSessionId;
exports.hasHeaderIgnoreCase = hasHeaderIgnoreCase;
exports.resolveOpenCodeSessionMode = resolveOpenCodeSessionMode;
exports.resolveConfiguredSessionValue = resolveConfiguredSessionValue;
exports.buildUpstreamHeaders = buildUpstreamHeaders;
exports.enrichVisionProxyWithOpenCodeHeaders = enrichVisionProxyWithOpenCodeHeaders;

/** Identifies this client to OpenCode Go (alongside User-Agent). */
exports.OPENCODE_CLIENT_NAME = "unified-proxy-copilot";
/** Same default as local_openai_forward.py — any opaque affinity token works. */
exports.DEFAULT_OPENCODE_SESSION = "local-openai-forward-affinity-v1";

const OPENCODE_HOST_RE = /(^|\.)opencode\.ai$/i;
const OPENCODE_PATH_RE = /\/zen\/go(\/|$)/i;

function tryRequireVscode() {
    try {
        return require("vscode");
    }
    catch {
        return null;
    }
}

function isOpenCodeGoEndpoint(baseUrl) {
    if (!baseUrl || typeof baseUrl !== "string") {
        return false;
    }
    try {
        const u = new URL(baseUrl);
        if (OPENCODE_HOST_RE.test(u.hostname)) {
            return true;
        }
        if (OPENCODE_PATH_RE.test(u.pathname)) {
            return true;
        }
    }
    catch {
        const lower = baseUrl.toLowerCase();
        return lower.includes("opencode.ai") || lower.includes("/zen/go");
    }
    return false;
}

/** Opaque session token: alphanumeric + _-., max 128 chars (OpenCode / Prism convention). */
function sanitizeOpenCodeSessionId(raw) {
    const s = String(raw ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
    if (!s) {
        return exports.DEFAULT_OPENCODE_SESSION;
    }
    return s.slice(0, 128);
}

function hasHeaderIgnoreCase(headers, name) {
    if (!headers) {
        return false;
    }
    const target = name.toLowerCase();
    return Object.keys(headers).some((k) => k.toLowerCase() === target);
}

/**
 * @returns {'auto'|'always'|'off'}
 */
function resolveOpenCodeSessionMode() {
    try {
        const vscode = tryRequireVscode();
        const cfg = vscode?.workspace?.getConfiguration?.("unified-proxy-copilot");
        const raw = String(cfg?.get?.("openCodeSession") ?? "auto").trim().toLowerCase();
        if (raw === "always" || raw === "on" || raw === "true" || raw === "1") {
            return "always";
        }
        if (raw === "off" || raw === "never" || raw === "false" || raw === "0") {
            return "off";
        }
    }
    catch {
        // vscode may be unavailable in unit-like contexts
    }
    return "auto";
}

function readExtensionVersion() {
    try {
        const vscode = tryRequireVscode();
        const ext = vscode?.extensions?.getExtension?.("biikoo.unified-proxy-copilot");
        const ver = ext?.packageJSON?.version;
        if (ver) {
            return String(ver);
        }
    }
    catch {
        // ignore
    }
    return "1.3.2";
}

/**
 * Resolve opaque session value.
 * Priority: proxy `opencode_session` > setting `openCodeSessionId` > default.
 */
function resolveConfiguredSessionValue(sessionOverride) {
    if (typeof sessionOverride === "string" && sessionOverride.trim()) {
        return sessionOverride.trim();
    }
    try {
        const vscode = tryRequireVscode();
        const cfg = vscode?.workspace?.getConfiguration?.("unified-proxy-copilot");
        const fromSetting = String(cfg?.get?.("openCodeSessionId") ?? "").trim();
        if (fromSetting) {
            return fromSetting;
        }
    }
    catch {
        // ignore
    }
    return exports.DEFAULT_OPENCODE_SESSION;
}

/**
 * Merge custom_headers with OpenCode Go affinity headers when needed.
 * Caller-provided custom_headers always win on name collision.
 *
 * @param {object} options
 * @param {string} [options.baseUrl]
 * @param {Record<string,string>|null|undefined} [options.customHeaders]
 * @param {string} [options.sessionOverride] fixed session from proxy config
 * @param {'auto'|'always'|'off'} [options.mode]
 * @returns {Record<string,string>}
 */
function buildUpstreamHeaders(options = {}) {
    const {
        baseUrl = "",
        customHeaders = null,
        sessionOverride = "",
        mode = resolveOpenCodeSessionMode(),
    } = options;

    const headers = {};
    if (customHeaders && typeof customHeaders === "object") {
        for (const [k, v] of Object.entries(customHeaders)) {
            if (typeof v === "string" && v.length > 0) {
                headers[k] = v;
            }
        }
    }

    const shouldInject =
        mode === "always" ||
        (mode === "auto" && isOpenCodeGoEndpoint(baseUrl));

    if (!shouldInject) {
        return headers;
    }

    if (!hasHeaderIgnoreCase(headers, "x-opencode-session")) {
        headers["x-opencode-session"] = sanitizeOpenCodeSessionId(
            resolveConfiguredSessionValue(sessionOverride),
        );
    }

    if (!hasHeaderIgnoreCase(headers, "x-opencode-client")) {
        headers["x-opencode-client"] = exports.OPENCODE_CLIENT_NAME;
    }

    if (!hasHeaderIgnoreCase(headers, "User-Agent")) {
        headers["User-Agent"] = `${exports.OPENCODE_CLIENT_NAME}/${readExtensionVersion()}`;
    }

    return headers;
}

/**
 * Clone vision_proxy config and inject OpenCode headers when the vision
 * endpoint is OpenCode Go (same MissingSessionID risk as chat).
 */
function enrichVisionProxyWithOpenCodeHeaders(visionProxy, sessionOverride) {
    if (!visionProxy || visionProxy.type !== "endpoint" || !visionProxy.baseUrl) {
        return visionProxy;
    }
    const merged = buildUpstreamHeaders({
        baseUrl: visionProxy.baseUrl,
        customHeaders: visionProxy.customHeaders,
        sessionOverride,
    });
    if (Object.keys(merged).length === 0) {
        return visionProxy;
    }
    return {
        ...visionProxy,
        customHeaders: merged,
    };
}
