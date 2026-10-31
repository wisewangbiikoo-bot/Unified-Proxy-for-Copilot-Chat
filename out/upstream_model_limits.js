"use strict";
/**
 * Fetch OpenAI-compatible GET {base_url}/models and extract per-model
 * meta: limits + vision/tools/reasoning (OpenCode Go schema).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseModelLimits = parseModelLimits;
exports.parseModelMeta = parseModelMeta;
exports.fetchUpstreamModelLimits = fetchUpstreamModelLimits;
exports.fetchUpstreamModelCatalog = fetchUpstreamModelCatalog;
exports.clearUpstreamLimitsCache = clearUpstreamLimitsCache;
exports.buildListHeaders = buildListHeaders;

const no_proxy_1 = require("./no_proxy");
const opencode_headers_1 = require("./opencode_headers");

function logInfo(msg) {
    try {
        require("./logger").logger.info(msg);
    }
    catch {
        // vscode host unavailable (CLI smoke tests)
    }
}
function logWarn(msg) {
    try {
        require("./logger").logger.warn(msg);
    }
    catch {
        // ignore
    }
}

/** @type {Map<string, { at: number, byId: Map<string, object>, list: Array<{id:string,name:string,meta:object|null}> }>} */
const catalogCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

function clearUpstreamLimitsCache() {
    catalogCache.clear();
}

function positiveInt(v) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) {
        return undefined;
    }
    return Math.floor(n);
}

function isImageModality(s) {
    const t = String(s || "").toLowerCase();
    return t === "image" || t.startsWith("image/");
}

/** OpenCode-style cost.price (USD per 1M tokens); allow 0. */
function positiveMoney(v) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n < 0) {
        return undefined;
    }
    return n;
}

/**
 * @returns {{ costInput?: number, costOutput?: number }}
 */
function parseModelCost(entry) {
    const cost = entry?.cost;
    if (!cost || typeof cost !== "object") {
        return {};
    }
    const text = cost.text && typeof cost.text === "object" ? cost.text : cost;
    const rawIn = text.input ?? cost.input ?? cost.prompt;
    const rawOut = text.output ?? cost.output ?? cost.completion;
    const costInput = positiveMoney(
        typeof rawIn === "number" ? rawIn : rawIn?.price ?? rawIn?.amount,
    );
    const costOutput = positiveMoney(
        typeof rawOut === "number" ? rawOut : rawOut?.price ?? rawOut?.amount,
    );
    return { costInput, costOutput };
}

/**
 * Pull context/output from a single /v1/models data entry.
 * @returns {{ context?: number, output?: number } | null}
 */
function parseModelLimits(entry) {
    const meta = parseModelMeta(entry);
    if (!meta || (meta.context === undefined && meta.output === undefined)) {
        return null;
    }
    return { context: meta.context, output: meta.output };
}

/**
 * Full meta used for auto-fill (limits + capabilities).
 * Undefined capability fields mean "upstream did not say" → keep local defaults.
 *
 * @returns {{
 *   context?: number,
 *   output?: number,
 *   costInput?: number,
 *   costOutput?: number,
 *   supportsNativeVision?: boolean,
 *   supportsTools?: boolean,
 *   supportsThinking?: boolean,
 * } | null}
 */
function parseModelMeta(entry) {
    if (!entry || typeof entry !== "object") {
        return null;
    }
    let context;
    let output;
    const lim = entry.limit;
    if (lim && typeof lim === "object") {
        context = positiveInt(lim.context ?? lim.max_context ?? lim.input);
        output = positiveInt(lim.output ?? lim.max_output ?? lim.completion);
    }
    if (context === undefined) {
        context = positiveInt(
            entry.context_window ??
                entry.context_window_size ??
                entry.max_model_len ??
                entry.max_input_tokens ??
                entry.context_length ??
                entry.n_ctx,
        );
    }
    if (output === undefined) {
        output = positiveInt(
            entry.max_output_tokens ??
                entry.max_completion_tokens ??
                entry.max_tokens ??
                entry.max_output,
        );
    }

    const { costInput, costOutput } = parseModelCost(entry);

    /** @type {boolean|undefined} */
    let supportsNativeVision;
    const mods = entry.modalities;
    if (mods && typeof mods === "object") {
        const input = mods.input;
        if (Array.isArray(input)) {
            supportsNativeVision = input.some(isImageModality);
        }
    }

    /** @type {boolean|undefined} */
    let supportsTools;
    /** @type {boolean|undefined} */
    let supportsThinking;
    const caps = entry.capabilities;
    if (caps && typeof caps === "object") {
        const tools = caps.tools;
        if (typeof tools === "boolean") {
            supportsTools = tools;
        }
        else if (tools && typeof tools === "object" && typeof tools.supported === "boolean") {
            supportsTools = tools.supported;
        }
        const reasoning = caps.reasoning;
        if (typeof reasoning === "boolean") {
            supportsThinking = reasoning;
        }
        else if (reasoning && typeof reasoning === "object" && typeof reasoning.supported === "boolean") {
            supportsThinking = reasoning.supported;
        }
        // Some catalogs use top-level capability booleans
        if (supportsTools === undefined && typeof caps.tool_calling === "boolean") {
            supportsTools = caps.tool_calling;
        }
        if (supportsThinking === undefined && typeof caps.thinking === "boolean") {
            supportsThinking = caps.thinking;
        }
    }

    if (
        context === undefined &&
        output === undefined &&
        costInput === undefined &&
        costOutput === undefined &&
        supportsNativeVision === undefined &&
        supportsTools === undefined &&
        supportsThinking === undefined
    ) {
        return null;
    }
    return {
        context,
        output,
        costInput,
        costOutput,
        supportsNativeVision,
        supportsTools,
        supportsThinking,
    };
}

function cacheKey(baseUrl, apiKey) {
    return `${String(baseUrl || "").replace(/\/$/, "")}\n${String(apiKey || "").slice(0, 24)}`;
}

/**
 * @param {string} baseUrl  e.g. https://opencode.ai/zen/go/v1
 * @param {string} apiKey
 * @param {Record<string, string>|null|undefined} extraHeaders
 * @returns {Promise<Map<string, object>>}
 */
/**
 * Full catalog for discovery UI (id + display name + meta).
 * @returns {Promise<Array<{ id: string, name: string, meta: object|null }>>}
 */
async function fetchUpstreamModelCatalog(baseUrl, apiKey, extraHeaders) {
    const packed = await fetchUpstreamCatalogPacked(baseUrl, apiKey, extraHeaders);
    return packed.list || [];
}

async function fetchUpstreamModelLimits(baseUrl, apiKey, extraHeaders) {
    const packed = await fetchUpstreamCatalogPacked(baseUrl, apiKey, extraHeaders);
    return packed.byId;
}

/**
 * @returns {Promise<{ byId: Map<string, object>, list: Array<{id:string,name:string,meta:object|null}> }>}
 */
async function fetchUpstreamCatalogPacked(baseUrl, apiKey, extraHeaders) {
    const key = cacheKey(baseUrl, apiKey);
    const hit = catalogCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
        return { byId: hit.byId, list: hit.list || [] };
    }

    (0, no_proxy_1.applyNoProxyBypass)();
    const root = String(baseUrl || "").replace(/\/$/, "");
    const url = `${root}/models`;
    const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey || ""}`,
        ...(extraHeaders && typeof extraHeaders === "object" ? extraHeaders : {}),
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch(url, { method: "GET", headers, signal: ac.signal });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`HTTP ${resp.status} ${text.slice(0, 200)}`);
        }
        const body = await resp.json();
        const rawList = Array.isArray(body?.data)
            ? body.data
            : Array.isArray(body)
              ? body
              : [];
        /** @type {Map<string, object>} */
        const byId = new Map();
        /** @type {Array<{id:string,name:string,meta:object|null}>} */
        const list = [];
        for (const entry of rawList) {
            const id = entry?.id;
            if (!id || typeof id !== "string") {
                continue;
            }
            const meta = parseModelMeta(entry);
            if (meta) {
                byId.set(id, meta);
            }
            const name = String(
                entry.name || entry.display_name || entry.displayName || id,
            ).trim() || id;
            list.push({ id, name, meta: meta || null });
        }
        catalogCache.set(key, { at: Date.now(), byId, list });
        logInfo(`Upstream /models meta: ${byId.size} models from ${root}`);
        return { byId, list };
    }
    catch (e) {
        logWarn(`Failed to fetch upstream model meta from ${url}: ${e?.message || e}`);
        const empty = new Map();
        const emptyList = [];
        catalogCache.set(key, {
            at: Date.now() - CACHE_TTL_MS + 30000,
            byId: empty,
            list: emptyList,
        });
        return { byId: empty, list: emptyList };
    }
    finally {
        clearTimeout(timer);
    }
}

function buildListHeaders(baseUrl, customHeaders, sessionOverride) {
    return (0, opencode_headers_1.buildUpstreamHeaders)({
        baseUrl,
        customHeaders,
        sessionOverride: sessionOverride || "",
    });
}
