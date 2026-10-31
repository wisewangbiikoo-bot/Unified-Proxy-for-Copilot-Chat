"use strict";
/**
 * Global auto-assign pool — Copilot model「自动分配」.
 * Cycles across user-selected enabled model ids (not provider-level accounts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTO_ASSIGN_MODEL_ID = void 0;
exports.AUTO_ASSIGN_MODEL_ID = "unified-proxy-auto-assign";
exports.AUTO_ASSIGN_DISPLAY_NAME = "自动分配";
exports.isAutoAssignModelId = isAutoAssignModelId;
exports.parseAutoAssign = parseAutoAssign;
exports.getCurrentAutoAssignTargetId = getCurrentAutoAssignTargetId;
exports.setCurrentAutoAssignTargetId = setCurrentAutoAssignTargetId;
exports.advanceAutoAssign = advanceAutoAssign;
exports.notifyAutoAssignChatRequest = notifyAutoAssignChatRequest;
exports.rescheduleAutoAssignRotator = rescheduleAutoAssignRotator;
exports.initAutoAssign = initAutoAssign;
exports.buildAutoAssignChatModel = buildAutoAssignChatModel;

const vscode = require("vscode");
const logger_1 = require("./logger");
const config_v2_1 = require("./config_v2");
const proxy_config_loader_1 = require("./proxy_config_loader");

const ACTIVE_KEY = "unified-proxy-copilot.autoAssignActiveModelId";
const AUTO_ASSIGN_MODEL_ID = exports.AUTO_ASSIGN_MODEL_ID;

/** @type {vscode.ExtensionContext|null} */
let extContext = null;
/** @type {NodeJS.Timeout|null} */
let rotateTimer = null;
/** @type {number} */
let requestCount = 0;
/** @type {(() => void)|null} */
let onChanged = null;

function isAutoAssignModelId(id) {
    return String(id || "").trim() === AUTO_ASSIGN_MODEL_ID;
}

/**
 * @param {object} cfg
 */
function parseAutoAssign(cfg) {
    const raw = cfg?.auto_assign || cfg?.autoAssign || {};
    let mode = String(raw.mode || "manual").trim().toLowerCase();
    if (
        mode === "rotate_requests" ||
        mode === "requests" ||
        mode === "request" ||
        mode === "by_request"
    ) {
        mode = "rotate_requests";
    }
    else if (mode === "auto" || mode === "rotate" || mode === "time") {
        mode = "rotate";
    }
    else {
        mode = "manual";
    }
    let rotateMinutes = Number(raw.rotate_minutes ?? raw.rotateMinutes ?? 5);
    if (!Number.isFinite(rotateMinutes) || rotateMinutes <= 0) {
        rotateMinutes = 5;
    }
    rotateMinutes = Math.max(1, Math.min(1440, Math.floor(rotateMinutes)));
    let rotateEveryN = Number(
        raw.rotate_every_n_requests ?? raw.rotateEveryNRequests ?? 10,
    );
    if (!Number.isFinite(rotateEveryN) || rotateEveryN <= 0) {
        rotateEveryN = 10;
    }
    rotateEveryN = Math.max(1, Math.min(500, Math.floor(rotateEveryN)));
    const modelIds = Array.isArray(raw.model_ids || raw.modelIds)
        ? (raw.model_ids || raw.modelIds).map((x) => String(x || "").trim()).filter(Boolean)
        : [];
    return { mode, rotateMinutes, rotateEveryN, modelIds };
}

/**
 * Only ids that exist and are enabled.
 * @param {object} cfg
 */
function resolvePool(cfg) {
    const { modelIds } = parseAutoAssign(cfg);
    const enabled = new Set(
        (cfg.models || []).filter((m) => m?.enabled).map((m) => m.id),
    );
    return modelIds.filter((id) => enabled.has(id));
}

function getCurrentAutoAssignTargetId(cfg) {
    const pool = resolvePool(cfg);
    if (!pool.length) {
        return null;
    }
    let cur = "";
    if (extContext) {
        cur = String(extContext.globalState.get(ACTIVE_KEY) || "").trim();
    }
    if (cur && pool.includes(cur)) {
        return cur;
    }
    return pool[0];
}

function setCurrentAutoAssignTargetId(modelEntryId, reason) {
    if (!extContext) {
        return false;
    }
    const id = String(modelEntryId || "").trim();
    if (!id) {
        return false;
    }
    void extContext.globalState.update(ACTIVE_KEY, id);
    logger_1.logger.info(`Auto-assign → ${id} [${reason || "manual"}]`);
    onChanged?.();
    return true;
}

function advanceAutoAssign(reason) {
    const { ok, cfg } = proxy_config_loader_1.readConfigFile();
    if (!ok || !cfg || !(0, config_v2_1.isV2Config)(cfg)) {
        return;
    }
    const parsed = parseAutoAssign(cfg);
    const pool = resolvePool(cfg);
    if (pool.length < 2) {
        return;
    }
    if (parsed.mode !== "rotate" && parsed.mode !== "rotate_requests") {
        return;
    }
    const cur = getCurrentAutoAssignTargetId(cfg);
    const idx = Math.max(0, pool.indexOf(cur || ""));
    const next = pool[(idx + 1) % pool.length];
    setCurrentAutoAssignTargetId(next, reason || "rotate");
    requestCount = 0;
    const model = (0, config_v2_1.findModel)(cfg, next);
    void vscode.window.setStatusBarMessage(
        `Unified Proxy 自动分配 → ${model?.name || next}`,
        4000,
    );
}

function notifyAutoAssignChatRequest() {
    const { ok, cfg } = proxy_config_loader_1.readConfigFile();
    if (!ok || !cfg || !(0, config_v2_1.isV2Config)(cfg)) {
        return;
    }
    const parsed = parseAutoAssign(cfg);
    const pool = resolvePool(cfg);
    if (parsed.mode !== "rotate_requests" || pool.length < 2) {
        return;
    }
    requestCount += 1;
    if (requestCount >= parsed.rotateEveryN) {
        advanceAutoAssign("rotate_requests");
    }
}

function rescheduleAutoAssignRotator() {
    if (rotateTimer) {
        clearInterval(rotateTimer);
        rotateTimer = null;
    }
    const { ok, cfg } = proxy_config_loader_1.readConfigFile();
    if (!ok || !cfg || !(0, config_v2_1.isV2Config)(cfg)) {
        return;
    }
    const parsed = parseAutoAssign(cfg);
    const pool = resolvePool(cfg);
    if (parsed.mode !== "rotate" || pool.length < 2) {
        return;
    }
    const ms = parsed.rotateMinutes * 60 * 1000;
    rotateTimer = setInterval(() => advanceAutoAssign("rotate-timer"), ms);
    logger_1.logger.info(
        `Auto-assign time rotate every ${parsed.rotateMinutes}m, pool=${pool.length}`,
    );
}

function initAutoAssign(context, hooks) {
    extContext = context;
    onChanged = hooks?.onChanged || null;
    context.subscriptions.push({
        dispose: () => {
            if (rotateTimer) {
                clearInterval(rotateTimer);
                rotateTimer = null;
            }
        },
    });
    rescheduleAutoAssignRotator();
}

/**
 * Virtual Copilot model entry (same shape as loadModelsFromConfig items).
 * @param {object} cfg
 * @returns {object|null}
 */
function buildAutoAssignChatModel(cfg) {
    const pool = resolvePool(cfg);
    if (!pool.length) {
        return null;
    }
    const targetId = getCurrentAutoAssignTargetId(cfg) || pool[0];
    const target = (0, config_v2_1.findModel)(cfg, targetId);
    const provider = target
        ? (0, config_v2_1.findProvider)(cfg, target.provider_id)
        : null;
    let maxIn = 128000;
    let maxOut = 0;
    let toolCalling = true;
    let imageInput = false;
    let thinking = true;
    if (target && provider) {
        try {
            const proxy = (0, config_v2_1.modelToProxyShape)(target, provider);
            const parsed = require("./proxy_config_parse").parseProxyEntry(proxy);
            maxIn = parsed.contextWindowTokens;
            maxOut = parsed.maxOutputTokens ?? 0;
            toolCalling = Boolean(parsed.supportsTools);
            imageInput = parsed.supportsImages > 0;
            thinking = Boolean(parsed.supportsThinking);
        }
        catch {
            /* defaults */
        }
    }
    const names = pool
        .map((id) => (0, config_v2_1.findModel)(cfg, id)?.name || id)
        .slice(0, 4);
    const more = pool.length > 4 ? ` 等${pool.length}个` : "";
    return {
        id: AUTO_ASSIGN_MODEL_ID,
        name: exports.AUTO_ASSIGN_DISPLAY_NAME,
        family: "unified-proxy",
        version: "auto",
        detail: `自动分配池：${names.join(" · ")}${more}`,
        maxInputTokens: maxIn,
        maxOutputTokens: maxOut,
        capabilities: {
            toolCalling,
            imageInput,
            thinking,
        },
        requiresThinkingParam: false,
        _proxyKey: AUTO_ASSIGN_MODEL_ID,
        _accountId: "",
        _providerId: "",
        _isAutoAssign: true,
        _proxyConfig: {
            baseUrl: provider?.base_url || "",
            apiKey: provider?.api_key || "",
            modelId: target?.model_id || "",
            supportsImages: imageInput ? 2 : 0,
            supportsImagesFromConfig: false,
            supportsTools: toolCalling,
            supportsToolsFromConfig: false,
            supportsThinking: thinking,
            supportsThinkingFromConfig: false,
            visionProxy: null,
            contextWindowTokens: maxIn,
            contextWindowFromConfig: false,
            maxOutputTokens: maxOut || undefined,
            maxOutputFromConfig: false,
            temperature: undefined,
            thinkingMode: "high",
            customHeaders: null,
            openCodeSession: "",
        },
    };
}
