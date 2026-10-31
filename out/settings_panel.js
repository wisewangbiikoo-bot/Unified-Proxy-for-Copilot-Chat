"use strict";
/**
 * Unified Proxy 设置 Webview — 当前模型 / 供应商 / 模型发现 / 辅助模型
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSettingsPanel = openSettingsPanel;
exports.registerSettingsCommands = registerSettingsCommands;

const vscode = require("vscode");
const fs = require("fs");
const proxy_config_loader_1 = require("./proxy_config_loader");
const account_manager_1 = require("./account_manager");
const config_v2_1 = require("./config_v2");
const upstream_model_limits_1 = require("./upstream_model_limits");
const logger_1 = require("./logger");

/** @type {vscode.WebviewPanel|null} */
let panel = null;
/** @type {(() => void)|null} */
let onSaved = null;

const THINKING_TO_CONFIG = {
    none: "停用",
    low: "轻量",
    high: "标准",
    max: "深度",
};

function registerSettingsCommands(context, hooks) {
    onSaved = hooks?.onSaved || null;
    context.subscriptions.push(
        vscode.commands.registerCommand("unified-proxy-copilot.openProxySettings", () =>
            openSettingsPanel(context),
        ),
    );
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {{ proxyKey?: string }} [opts]
 */
function openSettingsPanel(context, opts = {}) {
    if (panel) {
        panel.reveal(vscode.ViewColumn.Active);
        void postState(panel.webview, opts.proxyKey);
        return panel;
    }
    panel = vscode.window.createWebviewPanel(
        "unifiedProxySettings",
        "Unified Proxy 设置",
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        },
    );
    panel.webview.html = getHtml();
    panel.onDidDispose(() => {
        panel = null;
    });
    panel.webview.onDidReceiveMessage(async (msg) => {
        try {
            await handleMessage(msg, opts);
        }
        catch (e) {
            logger_1.logger.warn("Settings panel message failed", e);
            panel?.webview.postMessage({
                type: "toast",
                ok: false,
                error: e?.message || String(e),
            });
        }
    });
    return panel;
}

async function handleMessage(msg, opts) {
    if (!panel) {
        return;
    }
    const type = msg?.type;
    if (type === "ready" || type === "reload") {
        await postState(panel.webview, opts.proxyKey);
        return;
    }
    if (type === "selectCurrentModel") {
        const id = String(msg.proxyKey || "").trim();
        if (id) {
            opts.proxyKey = id;
            await postState(panel.webview, id);
        }
        return;
    }
    if (type === "upgradeToV2") {
        const r = proxy_config_loader_1.upgradeConfigToV2();
        panel.webview.postMessage({
            type: "toast",
            ok: r.ok,
            error: r.error || "",
            info: r.ok ? `已升级为 2.0${r.bak ? `；备份 ${r.bak}` : ""}` : "",
        });
        if (r.ok) {
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "switchAccount") {
        const proxyKey =
            String(msg.proxyKey || "").trim() ||
            resolveCurrentProxyKey(opts.proxyKey);
        const lookup = proxy_config_loader_1.getAccountLookupKey(proxyKey);
        const accountId = String(msg.accountId || "").trim();
        const ok =
            Boolean(lookup) &&
            Boolean(accountId) &&
            account_manager_1.setActiveAccountId(lookup, accountId, "settings-panel-instant");
        panel.webview.postMessage({
            type: "accountSwitched",
            ok,
            error: ok ? "" : "切换失败：账号无效或配置未找到",
        });
        if (ok) {
            await postState(panel.webview, proxyKey);
        }
        return;
    }
    if (type === "saveCurrent") {
        const result = await saveCurrentSettings(msg.payload || {});
        panel.webview.postMessage({
            type: "saved",
            ok: result.ok,
            error: result.error,
        });
        if (result.ok) {
            onSaved?.();
            void vscode.window.showInformationMessage(
                `设置已保存：${result.name || result.proxyKey}`,
            );
            await postState(panel.webview, result.proxyKey);
        }
        return;
    }
    if (type === "addProvider") {
        const result = await addProvider(msg.payload || {});
        panel.webview.postMessage({ type: "toast", ok: result.ok, error: result.error, info: result.info });
        if (result.ok) {
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "updateProvider") {
        const result = await updateProvider(msg.payload || {});
        panel.webview.postMessage({ type: "toast", ok: result.ok, error: result.error, info: result.info });
        if (result.ok) {
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "deleteProvider") {
        const result = await deleteProvider(String(msg.providerId || ""));
        panel.webview.postMessage({ type: "toast", ok: result.ok, error: result.error, info: result.info });
        if (result.ok) {
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "refreshCatalog") {
        const result = await refreshCatalog(String(msg.providerId || ""));
        panel.webview.postMessage({
            type: "catalog",
            ok: result.ok,
            error: result.error,
            providerId: result.providerId,
            items: result.items || [],
        });
        if (result.ok) {
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "toggleModel") {
        const result = await toggleModel(msg.payload || {});
        panel.webview.postMessage({
            type: "toast",
            ok: result.ok,
            error: result.error,
            info: result.info,
        });
        if (result.ok) {
            panel.webview.postMessage({
                type: "modelToggled",
                providerId: String(msg.payload?.providerId || ""),
                modelId: String(msg.payload?.modelId || ""),
                enabled: Boolean(msg.payload?.enabled),
            });
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "setAux") {
        const result = await setAux(msg.payload || {});
        panel.webview.postMessage({ type: "toast", ok: result.ok, error: result.error, info: result.info });
        if (result.ok) {
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "saveAutoAssign") {
        const result = await saveAutoAssign(msg.payload || {});
        panel.webview.postMessage({ type: "toast", ok: result.ok, error: result.error, info: result.info });
        if (result.ok) {
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
}

/**
 * Resolve which model entry the settings「当前模型」edits.
 * Prefer last chat model; never fall back to virtual「自动分配」id.
 * If auto-assign was last used, resolve to its current target for editing params.
 */
function resolveCurrentProxyKey(hint) {
    const auto_assign_1 = require("./auto_assign");
    const candidates = [];
    try {
        const usage_monitor_1 = require("./usage_monitor");
        const last = usage_monitor_1.getLastActiveChat?.();
        if (last?.proxyKey) {
            candidates.push(proxy_config_loader_1.parseModelRef(last.proxyKey).proxyKey);
        }
    }
    catch {
        /* optional */
    }
    if (hint) {
        candidates.push(proxy_config_loader_1.parseModelRef(hint).proxyKey);
    }
    for (const raw of candidates) {
        if (!raw) {
            continue;
        }
        if (auto_assign_1.isAutoAssignModelId(raw)) {
            const { ok, cfg } = proxy_config_loader_1.readConfigFile();
            if (ok && cfg) {
                const target = auto_assign_1.getCurrentAutoAssignTargetId(cfg);
                if (target) {
                    return target;
                }
            }
            continue;
        }
        return raw;
    }
    // Skip virtual auto-assign which is unshifted to models[0]
    const models = proxy_config_loader_1.loadModelsFromConfig().filter(
        (m) => m?.id && !auto_assign_1.isAutoAssignModelId(m.id),
    );
    return models[0]?.id || "";
}

function thinkingValueFromProxy(proxy) {
    try {
        return require("./proxy_config_parse").parseThinkingMode(proxy || {}) || "high";
    }
    catch {
        return "high";
    }
}

function formatNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) {
        return String(n ?? "—");
    }
    return v.toLocaleString();
}

function formatLimitTipReset(raw) {
    const s = String(raw || "").trim();
    if (!s) {
        return "";
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
        return s;
    }
    const hm = d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    return `在 ${hm} 重置 ${d.getMonth() + 1}月${d.getDate()}日`;
}

async function buildModelLimitTip(proxyKey, proxy) {
    const lines = [];
    if (!proxy?.base_url || !proxy?.model_id) {
        lines.push("上游 limit：缺少 base_url / api_key / model_id");
        return lines.join("\n");
    }
    try {
        const account_manager_1 = require("./account_manager");
        const lookup = proxy_config_loader_1.getAccountLookupKey(proxyKey);
        const resolved = account_manager_1.resolveApiKeyForProxy(lookup, proxy);
        const headers = upstream_model_limits_1.buildListHeaders(
            proxy.base_url,
            proxy.custom_headers || proxy.customHeaders,
            proxy.opencode_session || proxy.openCodeSession || "",
        );
        const catalog = await upstream_model_limits_1.fetchUpstreamModelLimits(
            proxy.base_url,
            resolved.apiKey || proxy.api_key || "",
            headers,
        );
        const meta = catalog.get(String(proxy.model_id));
        if (meta) {
            lines.push("上游 limit（GET /models）");
            if (meta.context) {
                lines.push(`  context: ${formatNum(meta.context)}`);
            }
            if (meta.output) {
                lines.push(`  output: ${formatNum(meta.output)}`);
            }
            if (meta.supportsNativeVision !== undefined) {
                lines.push(`  vision: ${meta.supportsNativeVision ? "native" : "no"}`);
            }
            if (meta.supportsTools !== undefined) {
                lines.push(`  tools: ${meta.supportsTools}`);
            }
            if (meta.supportsThinking !== undefined) {
                lines.push(`  thinking: ${meta.supportsThinking}`);
            }
        }
        else {
            lines.push("上游 limit：目录中无此 model_id");
        }
    }
    catch (e) {
        lines.push(`上游 limit：查询失败（${e?.message || e}）`);
    }
    try {
        const usage_monitor_1 = require("./usage_monitor");
        const snap = usage_monitor_1.getLastQuotaSnapshot?.();
        const ep = snap?.endpoints?.[0];
        if (ep?.usage) {
            lines.push("OpenCode Go 用量");
            const acct = ep.openCodeAccountLabel || ep.openCodeAccountId || "";
            if (acct) {
                lines.push(`  账号: ${acct}`);
            }
            for (const [key, label] of [
                ["monthly", "月"],
                ["weekly", "周"],
                ["rolling", "5h"],
            ]) {
                const win = ep.usage[key];
                if (!win) {
                    continue;
                }
                const p = Number(win.percent);
                const pct = Number.isFinite(p) ? `${p}%` : "?%";
                const reset = win.resetsAt ? ` · ${formatLimitTipReset(win.resetsAt)}` : "";
                lines.push(`  ${label}: ${pct} 已使用${reset}`);
            }
        }
        else if (ep?.error) {
            lines.push(`OpenCode Go 用量：${ep.error}`);
        }
    }
    catch {
        /* optional */
    }
    return lines.join("\n");
}

async function postState(webview, proxyKeyHint) {
    const { ok, cfg, path, error } = proxy_config_loader_1.readConfigFile();
    const schemaVersion = ok && cfg ? config_v2_1.getSchemaVersion(cfg) : 1;
    const isV2 = schemaVersion >= 2;
    const modelEntryId = resolveCurrentProxyKey(proxyKeyHint);

    let currentForm = null;
    if (ok && cfg) {
        currentForm = await buildCurrentForm(cfg, modelEntryId);
    }

    const providers = [];
    const enabledModels = [];
    let aux = { vision: { ref: null }, web_extract: { ref: null } };
    let autoAssign = config_v2_1.defaultAutoAssign();
    if (ok && cfg && isV2) {
        for (const p of cfg.providers || []) {
            providers.push({
                id: p.id,
                name: p.name || p.id,
                baseUrl: p.base_url || "",
                apiKeyMasked: account_manager_1.maskApiKey(p.api_key || ""),
            });
        }
        for (const m of cfg.models || []) {
            if (!m.enabled) {
                continue;
            }
            const prov = config_v2_1.findProvider(cfg, m.provider_id);
            enabledModels.push({
                id: m.id,
                name: m.name || m.model_id,
                providerId: m.provider_id,
                providerName: prov?.name || m.provider_id,
                modelId: m.model_id,
                paramSource: m.param_source || "auto",
            });
        }
        aux = {
            vision: { ref: cfg.aux?.vision?.ref ?? null },
            web_extract: { ref: cfg.aux?.web_extract?.ref ?? null },
        };
        try {
            const auto_assign_1 = require("./auto_assign");
            const parsed = auto_assign_1.parseAutoAssign(cfg);
            autoAssign = {
                mode: parsed.mode,
                rotate_minutes: parsed.rotateMinutes,
                rotate_every_n_requests: parsed.rotateEveryN,
                model_ids: parsed.modelIds,
                current: auto_assign_1.getCurrentAutoAssignTargetId(cfg),
            };
        }
        catch {
            autoAssign = cfg.auto_assign || autoAssign;
        }
    }

    webview.postMessage({
        type: "state",
        configPath: path,
        schemaVersion,
        isV2,
        readError: ok ? "" : error || "read failed",
        canUpgrade: ok && !isV2,
        current: currentForm,
        providers,
        enabledModels,
        aux,
        autoAssign,
    });
}

async function buildCurrentForm(cfg, modelEntryId) {
    const isV2 = config_v2_1.isV2Config(cfg);
    const auto_assign_1 = require("./auto_assign");
    let proxy = null;
    let proxyKey = modelEntryId;
    let lookupKey = modelEntryId;
    let viaAutoAssign = false;

    // Virtual auto-assign → edit the currently routed real model
    if (isV2 && auto_assign_1.isAutoAssignModelId(modelEntryId)) {
        const target = auto_assign_1.getCurrentAutoAssignTargetId(cfg);
        if (target) {
            proxyKey = target;
            viaAutoAssign = true;
        }
    }

    if (isV2) {
        const model = config_v2_1.findModel(cfg, proxyKey);
        const provider = model ? config_v2_1.findProvider(cfg, model.provider_id) : null;
        if (model && provider) {
            proxy = config_v2_1.modelToProxyShape(model, provider);
            lookupKey = provider.id;
        }
    }
    else {
        proxy = cfg.proxies?.[proxyKey] || null;
        lookupKey = proxyKey;
    }

    const parsed = account_manager_1.parseAccountsFromProxy(proxy || {}, lookupKey);
    const active = account_manager_1.getActiveAccount(lookupKey);
    const thinking = thinkingValueFromProxy(proxy);
    const contextRaw = proxy?.context_window_size ?? "";
    const tempRaw = proxy?.temperature;
    const maxOut = proxy?.max_output_tokens ?? "";
    const limitTip = await buildModelLimitTip(proxyKey, proxy);
    const displayName = proxy?.name
        ? viaAutoAssign
            ? `自动分配 → ${proxy.name}`
            : proxy.name
        : proxyKey || "(未选中模型)";

    return {
        proxyKey,
        providerId: lookupKey,
        name: displayName,
        baseUrl: proxy?.base_url || "",
        modelId: proxy?.model_id || "",
        hasProxy: Boolean(proxy),
        viaAutoAssign,
        accountId: active?.id || parsed.accounts[0]?.id || "",
        accounts: parsed.accounts.map((a) => ({
            id: a.id,
            name: a.name,
            key: account_manager_1.maskApiKey(a.api_key),
        })),
        accountMode: parsed.mode,
        rotateMinutes: parsed.rotateMinutes,
        rotateEveryNRequests: parsed.rotateEveryNRequests,
        thinking,
        contextWindow: contextRaw === "" || contextRaw === undefined ? "" : String(contextRaw),
        temperature:
            tempRaw === "" || tempRaw === undefined || tempRaw === null
                ? ""
                : String(tempRaw),
        maxOutputTokens: maxOut === "" || maxOut === undefined ? "" : String(maxOut),
        limitTip,
    };
}

async function saveCurrentSettings(payload) {
    const proxyKey = String(payload.proxyKey || "").trim();
    if (!proxyKey) {
        return { ok: false, error: "当前没有可设置的模型" };
    }
    const { ok, cfg, error } = proxy_config_loader_1.readConfigFile();
    if (!ok || !cfg) {
        return { ok: false, error: error || "读配置失败" };
    }

    if (config_v2_1.isV2Config(cfg)) {
        return saveCurrentV2(cfg, proxyKey, payload);
    }
    return saveCurrentV1(cfg, proxyKey, payload);
}

function saveCurrentV1(cfg, proxyKey, payload) {
    const proxy = cfg.proxies?.[proxyKey];
    if (!proxy || typeof proxy !== "object") {
        return { ok: false, error: `配置中无此模型: ${proxyKey}` };
    }
    applyThinkingAndParamsToProxy(proxy, payload);
    applyAccountSwitchToProxy(proxy, payload);
    proxy_config_loader_1.writeConfigFile(cfg);
    finalizeAccountAfterSave(proxyKey, payload);
    return { ok: true, proxyKey, name: proxy.name || proxyKey };
}

function saveCurrentV2(cfg, modelEntryId, payload) {
    const model = config_v2_1.findModel(cfg, modelEntryId);
    const provider = model ? config_v2_1.findProvider(cfg, model.provider_id) : null;
    if (!model || !provider) {
        return { ok: false, error: `配置中无此模型: ${modelEntryId}` };
    }
    const thinking = String(payload.thinking || "high");
    const edits = {
        thinking_mode: THINKING_TO_CONFIG[thinking] || "标准",
    };
    if (payload.contextWindow !== undefined) {
        const raw = String(payload.contextWindow).trim();
        if (raw === "" || raw === "0") {
            edits.context_window_size = 0;
        }
        else {
            const n = Number(raw.replace(/,/g, ""));
            edits.context_window_size = Number.isFinite(n) && n > 0 ? Math.floor(n) : raw;
        }
    }
    if (payload.maxOutputTokens !== undefined) {
        const raw = String(payload.maxOutputTokens).trim();
        if (raw === "" || raw === "0") {
            edits.max_output_tokens = 0;
        }
        else {
            const m = Number(raw.replace(/,/g, ""));
            if (Number.isFinite(m) && m > 0) {
                edits.max_output_tokens = Math.floor(m);
            }
        }
    }
    if (payload.temperature !== undefined) {
        const raw = String(payload.temperature).trim();
        if (raw === "" || raw === "0") {
            edits.temperature = null;
        }
        else {
            const t = Number(raw);
            if (Number.isFinite(t) && t > 0) {
                edits.temperature = Math.min(2, Math.max(0.01, t));
            }
        }
    }
    config_v2_1.applyUserParams(model, edits);
    // v2: rotation lives in auto_assign, not on provider
    proxy_config_loader_1.writeConfigFile(cfg);
    return { ok: true, proxyKey: modelEntryId, name: model.name || model.model_id };
}

function applyThinkingAndParamsToProxy(proxy, payload) {
    const thinking = String(payload.thinking || "high");
    proxy.thinking_mode = THINKING_TO_CONFIG[thinking] || "标准";
    if (payload.contextWindow !== undefined) {
        const raw = String(payload.contextWindow).trim();
        if (raw === "" || raw === "0") {
            proxy.context_window_size = 0;
        }
        else {
            const n = Number(raw.replace(/,/g, ""));
            proxy.context_window_size = Number.isFinite(n) && n > 0 ? Math.floor(n) : raw;
        }
    }
    if (payload.maxOutputTokens !== undefined) {
        const raw = String(payload.maxOutputTokens).trim();
        if (raw === "" || raw === "0") {
            proxy.max_output_tokens = 0;
        }
        else {
            const m = Number(raw.replace(/,/g, ""));
            if (Number.isFinite(m) && m > 0) {
                proxy.max_output_tokens = Math.floor(m);
            }
        }
    }
    if (payload.temperature !== undefined) {
        const raw = String(payload.temperature).trim();
        if (raw === "" || raw === "0") {
            delete proxy.temperature;
            delete proxy.Temperature;
        }
        else {
            const t = Number(raw);
            if (Number.isFinite(t) && t > 0) {
                proxy.temperature = Math.min(2, Math.max(0.01, t));
            }
        }
    }
}

function applyAccountSwitchToProxy(proxy, payload) {
    let accountMode = String(payload.accountMode || "manual").trim().toLowerCase();
    if (accountMode === "rotate_requests" || accountMode === "requests") {
        accountMode = "rotate_requests";
    }
    else if (accountMode === "rotate" || accountMode === "time") {
        accountMode = "rotate";
    }
    else {
        accountMode = "manual";
    }
    proxy.account_switch = {
        mode: accountMode,
        rotate_minutes: Math.max(1, Math.min(1440, Math.floor(Number(payload.rotateMinutes) || 5))),
        rotate_every_n_requests: Math.max(
            1,
            Math.min(500, Math.floor(Number(payload.rotateEveryNRequests) || 10)),
        ),
    };
}

function finalizeAccountAfterSave(lookupKey, payload) {
    const accountMode = String(payload.accountMode || "manual").trim().toLowerCase();
    if (accountMode === "manual" || accountMode === "") {
        const accountId = String(payload.accountId || "").trim();
        if (accountId) {
            account_manager_1.setActiveAccountId(lookupKey, accountId, "settings-panel");
        }
    }
    try {
        account_manager_1.rescheduleAllRotators();
    }
    catch {
        /* */
    }
}

async function requireV2() {
    const { ok, cfg, error } = proxy_config_loader_1.readConfigFile();
    if (!ok || !cfg) {
        return { ok: false, error: error || "读配置失败" };
    }
    if (!config_v2_1.isV2Config(cfg)) {
        return { ok: false, error: "请先点击「升级为 2.0」" };
    }
    return { ok: true, cfg };
}

async function addProvider(payload) {
    const gate = await requireV2();
    if (!gate.ok) {
        return gate;
    }
    const cfg = gate.cfg;
    const name = String(payload.name || "").trim() || "Provider";
    const baseUrl = String(payload.baseUrl || payload.base_url || "").trim();
    const apiKey = String(payload.apiKey || payload.api_key || "").trim();
    if (!baseUrl) {
        return { ok: false, error: "base_url 不能为空" };
    }
    const id = config_v2_1.ensureUniqueProviderId(
        cfg.providers,
        config_v2_1.slugifyId(payload.id || name),
    );
    cfg.providers.push({
        id,
        name,
        base_url: baseUrl,
        api_key: apiKey,
    });
    proxy_config_loader_1.writeConfigFile(cfg);
    return { ok: true, info: `已添加供应商 ${name}` };
}

async function updateProvider(payload) {
    const gate = await requireV2();
    if (!gate.ok) {
        return gate;
    }
    const cfg = gate.cfg;
    const id = String(payload.id || "").trim();
    const provider = config_v2_1.findProvider(cfg, id);
    if (!provider) {
        return { ok: false, error: "供应商不存在" };
    }
    if (payload.name !== undefined) {
        provider.name = String(payload.name || provider.name);
    }
    if (payload.baseUrl !== undefined || payload.base_url !== undefined) {
        const u = String(payload.baseUrl || payload.base_url || "").trim();
        if (u) {
            provider.base_url = u;
        }
    }
    if (payload.apiKey !== undefined || payload.api_key !== undefined) {
        const k = String(payload.apiKey ?? payload.api_key ?? "");
        if (k.trim()) {
            provider.api_key = k.trim();
        }
    }
    proxy_config_loader_1.writeConfigFile(cfg);
    return { ok: true, info: `已更新供应商 ${provider.name}` };
}

async function deleteProvider(providerId) {
    const gate = await requireV2();
    if (!gate.ok) {
        return gate;
    }
    const cfg = gate.cfg;
    const id = String(providerId || "").trim();
    if (!id) {
        return { ok: false, error: "缺少 providerId" };
    }
    cfg.providers = (cfg.providers || []).filter((p) => p.id !== id);
    cfg.models = (cfg.models || []).filter((m) => m.provider_id !== id);
    if (cfg.aux?.vision?.ref) {
        const m = config_v2_1.findModel(cfg, cfg.aux.vision.ref);
        if (!m || m.provider_id === id) {
            cfg.aux.vision.ref = null;
        }
    }
    if (cfg.aux?.web_extract?.ref) {
        const m = config_v2_1.findModel(cfg, cfg.aux.web_extract.ref);
        if (!m || m.provider_id === id) {
            cfg.aux.web_extract.ref = null;
        }
    }
    proxy_config_loader_1.writeConfigFile(cfg);
    return { ok: true, info: `已删除供应商 ${id}` };
}

async function refreshCatalog(providerId) {
    const gate = await requireV2();
    if (!gate.ok) {
        return { ...gate, items: [] };
    }
    const cfg = gate.cfg;
    const id = String(providerId || "").trim();
    const provider = config_v2_1.findProvider(cfg, id);
    if (!provider?.base_url) {
        return { ok: false, error: "供应商不存在", items: [], providerId: id };
    }
    const resolved = account_manager_1.resolveApiKeyForProxy(provider.id, provider);
    const headers = upstream_model_limits_1.buildListHeaders(
        provider.base_url,
        provider.custom_headers,
        provider.opencode_session || "",
    );
    const list = await upstream_model_limits_1.fetchUpstreamModelCatalog(
        provider.base_url,
        resolved.apiKey || provider.api_key || "",
        headers,
    );
    const enabledIds = new Set(
        (cfg.models || [])
            .filter((m) => m.provider_id === id && m.enabled)
            .map((m) => m.model_id),
    );
    const items = list.map((x) => {
        const meta = x.meta || null;
        return {
            id: x.id,
            name: x.name,
            enabled: enabledIds.has(x.id),
            entryId: config_v2_1.makeModelId(id, x.id),
            hasMeta: Boolean(meta),
            context: meta?.context || null,
            output: meta?.output || null,
            vision: meta?.supportsNativeVision,
            tools: meta?.supportsTools,
            thinking: meta?.supportsThinking,
        };
    });
    return { ok: true, providerId: id, items };
}

async function toggleModel(payload) {
    const gate = await requireV2();
    if (!gate.ok) {
        return gate;
    }
    const cfg = gate.cfg;
    const providerId = String(payload.providerId || "").trim();
    const modelId = String(payload.modelId || "").trim();
    const enabled = Boolean(payload.enabled);
    if (!providerId || !modelId) {
        return { ok: false, error: "缺少 providerId / modelId" };
    }
    const provider = config_v2_1.findProvider(cfg, providerId);
    if (!provider) {
        return { ok: false, error: "供应商不存在" };
    }
    const entryId = config_v2_1.makeModelId(providerId, modelId);
    let model = config_v2_1.findModel(cfg, entryId);
    if (!model && enabled) {
        // Fetch meta for auto params
        let meta = null;
        try {
            const resolved = account_manager_1.resolveApiKeyForProxy(provider.id, provider);
            const headers = upstream_model_limits_1.buildListHeaders(
                provider.base_url,
                provider.custom_headers,
                provider.opencode_session || "",
            );
            const catalog = await upstream_model_limits_1.fetchUpstreamModelLimits(
                provider.base_url,
                resolved.apiKey || provider.api_key || "",
                headers,
            );
            meta = catalog.get(modelId) || null;
        }
        catch {
            meta = null;
        }
        const displayName = String(payload.name || modelId);
        model = {
            id: entryId,
            provider_id: providerId,
            model_id: modelId,
            enabled: true,
            name: displayName,
            params: config_v2_1.paramsFromMeta(meta),
            param_source: "auto",
        };
        cfg.models.push(model);
    }
    else if (model) {
        model.enabled = enabled;
        if (enabled && model.param_source !== "user") {
            try {
                const resolved = account_manager_1.resolveApiKeyForProxy(provider.id, provider);
                const headers = upstream_model_limits_1.buildListHeaders(
                    provider.base_url,
                    provider.custom_headers,
                    provider.opencode_session || "",
                );
                const catalog = await upstream_model_limits_1.fetchUpstreamModelLimits(
                    provider.base_url,
                    resolved.apiKey || provider.api_key || "",
                    headers,
                );
                const meta = catalog.get(modelId);
                if (meta) {
                    model.params = config_v2_1.paramsFromMeta(meta);
                    model.param_source = "auto";
                }
            }
            catch {
                /* keep */
            }
        }
    }
    else {
        return { ok: true, info: "已关闭（未入库）" };
    }
    proxy_config_loader_1.writeConfigFile(cfg);
    return {
        ok: true,
        info: enabled ? `已启用 ${model.name || modelId}` : `已禁用 ${model.name || modelId}`,
    };
}

async function setAux(payload) {
    const gate = await requireV2();
    if (!gate.ok) {
        return gate;
    }
    const cfg = gate.cfg;
    if (!cfg.aux) {
        cfg.aux = { vision: { ref: null }, web_extract: { ref: null } };
    }
    const kind = String(payload.kind || "").trim();
    if (payload.resetAll) {
        cfg.aux.vision = { ref: null };
        cfg.aux.web_extract = { ref: null };
        proxy_config_loader_1.writeConfigFile(cfg);
        return { ok: true, info: "辅助模型已全部重置为主模型" };
    }
    let ref = payload.ref;
    if (ref === "" || ref === undefined) {
        ref = null;
    }
    if (kind === "vision") {
        cfg.aux.vision = { ref };
    }
    else if (kind === "web_extract") {
        cfg.aux.web_extract = { ref };
    }
    else {
        return { ok: false, error: "未知辅助类型" };
    }
    proxy_config_loader_1.writeConfigFile(cfg);
    return { ok: true, info: "辅助模型已更新" };
}

async function saveAutoAssign(payload) {
    const gate = await requireV2();
    if (!gate.ok) {
        return gate;
    }
    const cfg = gate.cfg;
    let mode = String(payload.mode || "manual").trim().toLowerCase();
    if (mode === "rotate_requests" || mode === "requests") {
        mode = "rotate_requests";
    }
    else if (mode === "rotate" || mode === "time" || mode === "auto") {
        mode = "rotate";
    }
    else {
        mode = "manual";
    }
    const modelIds = Array.isArray(payload.modelIds)
        ? payload.modelIds.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
    cfg.auto_assign = {
        mode,
        rotate_minutes: Math.max(
            1,
            Math.min(1440, Math.floor(Number(payload.rotateMinutes) || 5)),
        ),
        rotate_every_n_requests: Math.max(
            1,
            Math.min(500, Math.floor(Number(payload.rotateEveryN) || 10)),
        ),
        model_ids: modelIds,
    };
    proxy_config_loader_1.writeConfigFile(cfg);
    if (payload.currentId) {
        try {
            require("./auto_assign").setCurrentAutoAssignTargetId(
                String(payload.currentId),
                "settings",
            );
        }
        catch {
            /* */
        }
    }
    return {
        ok: true,
        info: modelIds.length
            ? `自动分配已保存（${modelIds.length} 个模型）`
            : "自动分配池已清空（Copilot 不显示「自动分配」）",
    };
}

function getHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0; padding: 12px 16px 28px; line-height: 1.4;
  }
  h1 { font-size: 1.15rem; font-weight: 600; margin: 0 0 8px; }
  h2 { font-size: 0.95rem; font-weight: 600; margin: 0 0 8px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 0.88em; margin: 0 0 10px; }
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .tab {
    border: 1px solid var(--vscode-widget-border, #555);
    background: transparent; color: inherit; border-radius: 6px;
    padding: 5px 12px; cursor: pointer; font: inherit;
  }
  .tab.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }
  .panel { display: none; }
  .panel.active { display: block; }
  .card {
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  .row {
    display: grid; grid-template-columns: minmax(110px, 140px) 1fr; gap: 6px 12px;
    align-items: center; margin-bottom: 8px;
  }
  .lbl { display: inline-flex; align-items: center; gap: 6px; }
  .help {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; border-radius: 50%;
    border: 1.5px solid var(--vscode-descriptionForeground);
    color: var(--vscode-descriptionForeground);
    font-size: 10px; font-weight: 700;
  }
  select, input, textarea {
    width: 100%; box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px; padding: 5px 8px; font: inherit;
  }
  select:disabled, input:disabled { opacity: 0.55; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.88em; word-break: break-all; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  button { font: inherit; border-radius: 4px; border: 1px solid transparent; padding: 6px 12px; cursor: pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.linkish {
    background: transparent; color: var(--vscode-textLink-foreground);
    border: none; padding: 2px 6px;
  }
  .status { margin-top: 8px; min-height: 1.2em; color: var(--vscode-descriptionForeground); }
  .status.err { color: var(--vscode-errorForeground); }
  .status.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .hidden { display: none !important; }
  .model-title { font-weight: 600; }
  .list-row {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 0; border-bottom: 1px solid var(--vscode-widget-border, #333);
  }
  .list-row.catalog-row {
    padding: 3px 0; gap: 8px; align-items: center;
  }
  .list-row:last-child { border-bottom: none; }
  .list-main { min-width: 0; flex: 1; }
  .cat-line1 {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px;
    line-height: 1.25;
  }
  .cat-name { font-weight: 600; font-size: 0.9em; }
  .cat-limit {
    font-size: 0.75em; color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .cat-id {
    font-size: 0.72em; opacity: 0.65; line-height: 1.2; margin-top: 1px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .tag {
    display: inline-block; font-size: 0.75em; opacity: 0.75;
    border: 1px solid var(--vscode-widget-border, #555); border-radius: 999px;
    padding: 0 6px; margin-left: 6px;
  }
  .switch {
    width: 40px; height: 22px; border-radius: 999px; border: none; cursor: pointer;
    background: var(--vscode-input-background); position: relative; flex-shrink: 0;
  }
  .switch.sm { width: 34px; height: 18px; }
  .switch.on { background: var(--vscode-testing-iconPassed, #3fb950); }
  .switch::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
    border-radius: 50%; background: #fff; transition: left .15s;
  }
  .switch.sm::after { width: 14px; height: 14px; top: 2px; left: 2px; }
  .switch.on::after { left: 20px; }
  .switch.sm.on::after { left: 18px; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .toolbar input { flex: 1; }
  .banner {
    border: 1px solid var(--vscode-inputValidation-warningBorder, #cca700);
    background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground, #664) 40%, transparent);
    border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;
  }
  .aux-actions { display: flex; gap: 8px; flex-shrink: 0; }
</style>
</head>
<body>
  <h1>Unified Proxy 设置</h1>
  <div class="sub mono" id="configPath"></div>
  <div id="upgradeBanner" class="banner hidden">
    当前为 v1 配置。可继续编辑「当前模型」；供应商发现与辅助模型需
    <button class="primary" id="btnUpgrade">升级为 2.0</button>
    （会自动备份原文件）
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="current">当前模型</button>
    <button class="tab" data-tab="providers" id="tabProviders">供应商</button>
    <button class="tab" data-tab="models" id="tabModels">模型</button>
    <button class="tab" data-tab="auto" id="tabAuto">自动分配</button>
    <button class="tab" data-tab="aux" id="tabAux">辅助模型</button>
  </div>
  <div class="status" id="status"></div>

  <div class="panel active" id="panel-current">
    <div class="card">
      <h2>当前模型</h2>
      <div class="sub">编辑哪一个已启用模型的参数（与 Copilot 下拉选择独立；发过聊天后会优先跟上次对话模型）。</div>
      <div class="row">
        <label>选择模型</label>
        <select id="currentModelSelect"></select>
      </div>
      <div class="model-title" id="modelName">—</div>
      <div class="mono sub" id="modelMeta"></div>
      <pre class="sub" id="modelLimitTip" style="white-space:pre-wrap;margin:8px 0 0"></pre>
      <input type="hidden" id="proxyKey" />
      <input type="hidden" id="providerId" />
    </div>
    <div class="card" id="accountCard">
      <h2>账号切换</h2>
      <div class="row">
        <label class="lbl" for="accountMode">切换方式</label>
        <select id="accountMode">
          <option value="manual">手动选择</option>
          <option value="rotate">自动轮换 · 按时间</option>
          <option value="rotate_requests">自动轮换 · 按请求次数</option>
        </select>
      </div>
      <div class="row" id="accountRow">
        <label class="lbl" for="account">当前账号</label>
        <select id="account"></select>
      </div>
      <div class="row hidden" id="rotateMinRow">
        <label class="lbl" for="rotateMinutes">轮换间隔(分)</label>
        <input id="rotateMinutes" type="number" min="1" max="1440" step="1" />
      </div>
      <div class="row hidden" id="rotateReqRow">
        <label class="lbl" for="rotateEveryN">每 N 次请求</label>
        <input id="rotateEveryN" type="number" min="1" max="500" step="1" />
      </div>
    </div>
    <div class="card">
      <h2>模型参数</h2>
      <div class="row">
        <label class="lbl" for="thinking">思考模式</label>
        <select id="thinking">
          <option value="none">停用</option>
          <option value="low">轻量</option>
          <option value="high">标准</option>
          <option value="max">深度</option>
        </select>
      </div>
      <div class="row">
        <label class="lbl" for="context">上下文大小</label>
        <input id="context" placeholder="0 = 自动" />
      </div>
      <div class="row">
        <label class="lbl" for="maxOut">最大输出</label>
        <input id="maxOut" placeholder="0 = 自动" />
      </div>
      <div class="row">
        <label class="lbl" for="temperature">温度</label>
        <input id="temperature" type="number" min="0" max="2" step="0.1" placeholder="0 = 自动" />
      </div>
      <div class="actions">
        <button class="primary" id="save">保存</button>
        <button class="secondary" id="reload">重新加载</button>
      </div>
    </div>
  </div>

  <div class="panel" id="panel-providers">
    <div class="card">
      <h2 id="provFormTitle">添加供应商</h2>
      <input type="hidden" id="provEditId" value="" />
      <div class="row"><label>名称</label><input id="provName" placeholder="OpenCode Go" /></div>
      <div class="row"><label>Base URL</label><input id="provUrl" placeholder="https://opencode.ai/zen/go/v1" /></div>
      <div class="row"><label>API Key</label><input id="provKey" type="password" placeholder="新建必填；修改时留空则不改 Key" /></div>
      <div class="actions">
        <button class="primary" id="btnAddProv">添加</button>
        <button class="secondary hidden" id="btnCancelProvEdit">取消修改</button>
      </div>
    </div>
    <div class="card">
      <h2>已添加</h2>
      <div id="providerList"></div>
    </div>
  </div>

  <div class="panel" id="panel-models">
    <div class="card">
      <h2>模型发现</h2>
      <div class="row">
        <label>供应商</label>
        <select id="catalogProvider"></select>
      </div>
      <div class="toolbar">
        <input id="modelSearch" placeholder="搜索模型…" />
        <button class="secondary" id="btnRefreshCatalog">刷新</button>
      </div>
      <div class="sub">打开开关即加入 Copilot 列表；参数由 /models limit 自动填充，可在「当前模型」里改。</div>
      <div id="catalogList"></div>
    </div>
  </div>

  <div class="panel" id="panel-auto">
    <div class="card">
      <h2>自动分配</h2>
      <div class="sub">从已启用模型中勾选进入轮换池。Copilot 模型列表会出现「自动分配」；聊天时按下方策略选用池内某一模型（不同供应商 / 不同 API Key 均可混入）。</div>
      <div class="row">
        <label>切换方式</label>
        <select id="autoMode">
          <option value="manual">手动（固定当前项，可在下方选当前）</option>
          <option value="rotate">按时间轮换</option>
          <option value="rotate_requests">按请求次数轮换</option>
        </select>
      </div>
      <div class="row" id="autoMinRow">
        <label>轮换间隔(分)</label>
        <input id="autoMinutes" type="number" min="1" max="1440" step="1" value="5" />
      </div>
      <div class="row hidden" id="autoReqRow">
        <label>每 N 次请求</label>
        <input id="autoEveryN" type="number" min="1" max="500" step="1" value="10" />
      </div>
      <div class="row">
        <label>当前选用</label>
        <select id="autoCurrent"></select>
      </div>
      <h2 style="margin-top:14px">池内模型</h2>
      <div id="autoPoolList"></div>
      <div class="actions">
        <button class="primary" id="btnSaveAuto">保存自动分配</button>
      </div>
    </div>
  </div>

  <div class="panel" id="panel-aux">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <h2 style="margin:0">辅助模型</h2>
        <button class="linkish" id="btnResetAux">全部重置为主模型</button>
      </div>
      <div class="sub">辅助任务默认使用主模型。你可以为任意任务指定专用模型。</div>
      <div class="list-row">
        <div class="list-main">
          <div>视觉 <span class="tag">图片分析</span></div>
          <div class="sub" id="auxVisionLabel">自动 · 使用主模型</div>
        </div>
        <div class="aux-actions">
          <button class="linkish" data-aux-clear="vision">设为主模型</button>
          <button class="linkish" data-aux-change="vision">更改</button>
        </div>
      </div>
      <div class="list-row">
        <div class="list-main">
          <div>网页提取 <span class="tag">页面总结</span></div>
          <div class="sub" id="auxWebLabel">自动 · 使用主模型</div>
        </div>
        <div class="aux-actions">
          <button class="linkish" data-aux-clear="web_extract">设为主模型</button>
          <button class="linkish" data-aux-change="web_extract">更改</button>
        </div>
      </div>
      <div class="row" id="auxPickRow" style="margin-top:12px">
        <label>选择模型</label>
        <select id="auxPick"></select>
      </div>
      <div class="actions">
        <button class="primary" id="btnApplyAux">应用所选</button>
      </div>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let state = { isV2: false, enabledModels: [], providers: [], aux: {}, autoAssign: {}, catalog: [] };
  let auxEditKind = 'vision';

  function setStatus(text, kind) {
    const el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function syncAccountModeUi() {
    const mode = $('accountMode').value;
    const auto = mode === 'rotate' || mode === 'rotate_requests';
    $('account').disabled = auto;
    $('rotateMinRow').classList.toggle('hidden', mode !== 'rotate');
    $('rotateReqRow').classList.toggle('hidden', mode !== 'rotate_requests');
  }
  function syncAutoModeUi() {
    const mode = $('autoMode').value;
    $('autoMinRow').classList.toggle('hidden', mode !== 'rotate');
    $('autoReqRow').classList.toggle('hidden', mode !== 'rotate_requests');
  }
  function setV2Ui(isV2) {
    $('upgradeBanner').classList.toggle('hidden', isV2);
    ['tabProviders','tabModels','tabAuto','tabAux'].forEach(id => {
      $(id).disabled = !isV2;
      $(id).style.opacity = isV2 ? '1' : '0.45';
    });
    // v2: no per-provider accounts card
    if (isV2) $('accountCard').classList.add('hidden');
  }
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  }
  function auxLabel(ref) {
    if (!ref) return '自动 · 使用主模型';
    const m = (state.enabledModels || []).find(x => x.id === ref);
    if (!m) return ref;
    return (m.providerName || m.providerId) + ' · ' + (m.name || m.modelId);
  }
  function clearProvEdit() {
    $('provEditId').value = '';
    $('provFormTitle').textContent = '添加供应商';
    $('btnAddProv').textContent = '添加';
    $('btnCancelProvEdit').classList.add('hidden');
    $('provName').value = '';
    $('provUrl').value = '';
    $('provKey').value = '';
    $('provKey').placeholder = '新建必填；修改时留空则不改 Key';
  }
  function beginProvEdit(p) {
    $('provEditId').value = p.id || '';
    $('provFormTitle').textContent = '修改供应商';
    $('btnAddProv').textContent = '保存修改';
    $('btnCancelProvEdit').classList.remove('hidden');
    $('provName').value = p.name || '';
    $('provUrl').value = p.baseUrl || '';
    $('provKey').value = '';
    $('provKey').placeholder = '当前 ' + (p.apiKeyMasked || '***') + ' · 留空不改';
    $('provName').focus();
    setStatus('正在修改：' + (p.name || p.id));
  }
  function renderProviders() {
    const box = $('providerList');
    const list = state.providers || [];
    if (!list.length) {
      box.innerHTML = '<div class="sub">尚无供应商，请先添加。</div>';
      return;
    }
    box.innerHTML = list.map(p =>
      '<div class="list-row">' +
        '<div class="list-main"><div class="model-title">' + esc(p.name) + '</div>' +
        '<div class="mono sub">' + esc(p.baseUrl) + ' · key ' + esc(p.apiKeyMasked) + '</div></div>' +
        '<div class="aux-actions">' +
          '<button class="linkish" data-edit-prov="' + esc(p.id) + '">修改</button>' +
          '<button class="linkish" data-del-prov="' + esc(p.id) + '">删除</button>' +
        '</div></div>'
    ).join('');
  }
  function renderAutoPool() {
    const aa = state.autoAssign || {};
    const selected = new Set(aa.model_ids || []);
    $('autoMode').value = aa.mode || 'manual';
    $('autoMinutes').value = aa.rotate_minutes != null ? aa.rotate_minutes : 5;
    $('autoEveryN').value = aa.rotate_every_n_requests != null ? aa.rotate_every_n_requests : 10;
    syncAutoModeUi();
    const models = state.enabledModels || [];
    $('autoPoolList').innerHTML = models.length
      ? models.map(m =>
          '<label class="list-row" style="cursor:pointer">' +
            '<div class="list-main"><div>' + esc(m.name) + '</div>' +
            '<div class="mono sub">' + esc(m.providerName) + ' · ' + esc(m.modelId) + '</div></div>' +
            '<input type="checkbox" data-auto-id="' + esc(m.id) + '"' +
            (selected.has(m.id) ? ' checked' : '') + ' /></label>'
        ).join('')
      : '<div class="sub">请先在「模型」页启用至少一个模型。</div>';
    const poolModels = models.filter(m => selected.has(m.id));
    $('autoCurrent').innerHTML = poolModels.length
      ? poolModels.map(m =>
          '<option value="' + esc(m.id) + '"' +
          (m.id === aa.current ? ' selected' : '') + '>' + esc(m.name) + '</option>'
        ).join('')
      : '<option value="">（池为空）</option>';
  }
  function fillCatalogProviderSelect() {
    const sel = $('catalogProvider');
    const cur = sel.value;
    sel.innerHTML = (state.providers || []).map(p =>
      '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'
    ).join('');
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  function syncCatalogEnabledFlags() {
    const providerId = ($('catalogProvider') && $('catalogProvider').value) || '';
    const enabledSet = new Set(
      (state.enabledModels || [])
        .filter(m => m.providerId === providerId)
        .map(m => m.modelId)
    );
    for (const it of state.catalog || []) {
      it.enabled = enabledSet.has(it.id);
    }
  }
  function fmtTok(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    if (v >= 1000000) {
      const m = v / 1000000;
      return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\\.0$/, '')) + 'M';
    }
    if (v >= 1000) return Math.round(v / 1000) + 'K';
    return String(Math.floor(v));
  }
  function formatCatalogLimit(it) {
    const parts = [];
    const ctx = fmtTok(it.context);
    const out = fmtTok(it.output);
    if (ctx) parts.push('ctx ' + ctx);
    if (out) parts.push('out ' + out);
    if (it.vision === true) parts.push('视觉');
    else if (it.vision === false) parts.push('无视觉');
    if (it.tools === true) parts.push('工具');
    else if (it.tools === false) parts.push('无工具');
    if (it.thinking === true) parts.push('思考');
    else if (it.thinking === false) parts.push('无思考');
    return parts.length ? parts.join(' · ') : 'limit —';
  }
  function renderCatalog() {
    syncCatalogEnabledFlags();
    const q = ($('modelSearch').value || '').trim().toLowerCase();
    const items = (state.catalog || []).filter(it =>
      !q || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q) ||
      formatCatalogLimit(it).toLowerCase().includes(q)
    );
    const box = $('catalogList');
    if (!items.length) {
      box.innerHTML = '<div class="sub">点「刷新」从上游拉取模型列表。</div>';
      return;
    }
    box.innerHTML = items.map(it =>
      '<div class="list-row catalog-row">' +
        '<div class="list-main">' +
          '<div class="cat-line1"><span class="cat-name">' + esc(it.name) + '</span>' +
          '<span class="cat-limit">' + esc(formatCatalogLimit(it)) + '</span></div>' +
          '<div class="cat-id">' + esc(it.id) + '</div></div>' +
        '<button type="button" class="switch sm' + (it.enabled ? ' on' : '') + '" data-toggle="' + esc(it.id) +
        '" data-name="' + esc(it.name) + '" title="' + (it.enabled ? '点击禁用' : '点击启用') + '"></button></div>'
    ).join('');
  }
  function fillAuxPick() {
    const sel = $('auxPick');
    sel.innerHTML = '<option value="">自动 · 使用主模型</option>' +
      (state.enabledModels || []).map(m =>
        '<option value="' + esc(m.id) + '">' + esc(m.providerName + ' · ' + m.name) + '</option>'
      ).join('');
  }
  function applyState(msg) {
    state.isV2 = Boolean(msg.isV2);
    state.providers = msg.providers || [];
    state.enabledModels = msg.enabledModels || [];
    state.aux = msg.aux || {};
    state.autoAssign = msg.autoAssign || {};
    $('configPath').textContent = 'schema v' + (msg.schemaVersion || 1) + ' · ' + (msg.configPath || '');
    setV2Ui(state.isV2);
    if (msg.readError) setStatus('读配置失败：' + msg.readError, 'err');

    const form = msg.current || {};
    $('proxyKey').value = form.proxyKey || '';
    $('providerId').value = form.providerId || '';
    $('modelName').textContent = form.name || '—';
    $('modelMeta').textContent = (form.baseUrl || '') + (form.modelId ? '  ·  ' + form.modelId : '');
    $('modelLimitTip').textContent = form.limitTip || '';
    const sel = $('currentModelSelect');
    if (sel) {
      const list = state.enabledModels || [];
      sel.innerHTML = list.length
        ? list.map(m =>
            '<option value="' + esc(m.id) + '"' +
            (m.id === form.proxyKey ? ' selected' : '') + '>' +
            esc(m.name) + ' (' + esc(m.providerName) + ')</option>'
          ).join('')
        : '<option value="">（无已启用模型）</option>';
      if (form.proxyKey) sel.value = form.proxyKey;
    }

    const accounts = form.accounts || [];
    if (!state.isV2 && accounts.length > 1) {
      $('accountCard').classList.remove('hidden');
      $('account').innerHTML = accounts.map(a =>
        '<option value="' + esc(a.id) + '"' + (a.id === form.accountId ? ' selected' : '') + '>' +
        esc(a.name) + '  (' + esc(a.key) + ')</option>'
      ).join('');
      $('accountMode').value = form.accountMode || 'manual';
      $('rotateMinutes').value = form.rotateMinutes != null ? form.rotateMinutes : 5;
      $('rotateEveryN').value = form.rotateEveryNRequests != null ? form.rotateEveryNRequests : 10;
      syncAccountModeUi();
    } else if (!state.isV2) {
      $('accountCard').classList.add('hidden');
    }
    $('thinking').value = form.thinking || 'high';
    $('context').value = form.contextWindow === '' || form.contextWindow == null ? '0' : form.contextWindow;
    $('maxOut').value = form.maxOutputTokens === '' || form.maxOutputTokens == null ? '0' : form.maxOutputTokens;
    $('temperature').value = form.temperature === '' || form.temperature == null ? '0' : form.temperature;

    renderProviders();
    fillCatalogProviderSelect();
    renderAutoPool();
    if ((state.catalog || []).length) {
      renderCatalog();
    }
    $('auxVisionLabel').textContent = auxLabel(state.aux.vision && state.aux.vision.ref);
    $('auxWebLabel').textContent = auxLabel(state.aux.web_extract && state.aux.web_extract.ref);
    fillAuxPick();
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      showTab(t.dataset.tab);
    });
  });
  $('currentModelSelect')?.addEventListener('change', () => {
    const id = $('currentModelSelect').value || '';
    if (!id) return;
    vscode.postMessage({ type: 'selectCurrentModel', proxyKey: id });
  });
  $('accountMode').addEventListener('change', syncAccountModeUi);
  $('autoMode').addEventListener('change', syncAutoModeUi);
  $('btnSaveAuto').addEventListener('click', () => {
    const modelIds = [...document.querySelectorAll('#autoPoolList input[data-auto-id]:checked')]
      .map(el => el.getAttribute('data-auto-id'));
    vscode.postMessage({
      type: 'saveAutoAssign',
      payload: {
        mode: $('autoMode').value,
        rotateMinutes: $('autoMinutes').value,
        rotateEveryN: $('autoEveryN').value,
        modelIds,
        currentId: $('autoCurrent').value || '',
      }
    });
  });
  $('account').addEventListener('change', () => {
    const id = $('account').value || '';
    if (!id || $('account').disabled) return;
    setStatus('正在切换账号…');
    vscode.postMessage({ type: 'switchAccount', proxyKey: $('proxyKey').value, accountId: id });
  });
  $('save').addEventListener('click', () => {
    setStatus('保存中…');
    vscode.postMessage({
      type: 'saveCurrent',
      payload: {
        proxyKey: $('proxyKey').value,
        accountId: $('account').value || '',
        accountMode: $('accountMode').value,
        rotateMinutes: $('rotateMinutes').value,
        rotateEveryNRequests: $('rotateEveryN').value,
        thinking: $('thinking').value,
        contextWindow: $('context').value,
        temperature: $('temperature').value,
        maxOutputTokens: $('maxOut').value,
      }
    });
  });
  $('reload').addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
  $('btnUpgrade').addEventListener('click', () => vscode.postMessage({ type: 'upgradeToV2' }));
  $('btnCancelProvEdit').addEventListener('click', () => {
    clearProvEdit();
    setStatus('');
  });
  $('btnAddProv').addEventListener('click', () => {
    const editId = ($('provEditId').value || '').trim();
    const payload = {
      name: $('provName').value,
      baseUrl: $('provUrl').value,
      apiKey: $('provKey').value,
    };
    if (editId) {
      payload.id = editId;
      vscode.postMessage({ type: 'updateProvider', payload });
    } else {
      if (!(payload.apiKey || '').trim()) {
        setStatus('添加供应商时 API Key 不能为空', 'err');
        return;
      }
      vscode.postMessage({ type: 'addProvider', payload });
    }
  });
  $('providerList').addEventListener('click', (ev) => {
    const editBtn = ev.target.closest('[data-edit-prov]');
    if (editBtn) {
      const id = editBtn.getAttribute('data-edit-prov');
      const p = (state.providers || []).find(x => x.id === id);
      if (p) beginProvEdit(p);
      return;
    }
    const btn = ev.target.closest('[data-del-prov]');
    if (!btn) return;
    if (!confirm('删除该供应商及其下模型？')) return;
    vscode.postMessage({ type: 'deleteProvider', providerId: btn.getAttribute('data-del-prov') });
  });
  $('btnRefreshCatalog').addEventListener('click', () => {
    setStatus('刷新模型目录…');
    vscode.postMessage({ type: 'refreshCatalog', providerId: $('catalogProvider').value });
  });
  $('modelSearch').addEventListener('input', renderCatalog);
  $('catalogList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-toggle]');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const modelId = btn.getAttribute('data-toggle');
    const name = btn.getAttribute('data-name') || modelId;
    const enabled = !btn.classList.contains('on');
    // Optimistic UI — postState will reconcile
    btn.classList.toggle('on', enabled);
    btn.title = enabled ? '点击禁用' : '点击启用';
    const hit = (state.catalog || []).find(x => x.id === modelId);
    if (hit) hit.enabled = enabled;
    setStatus(enabled ? ('正在启用 ' + name + '…') : ('正在禁用 ' + name + '…'));
    vscode.postMessage({
      type: 'toggleModel',
      payload: {
        providerId: $('catalogProvider').value,
        modelId,
        name,
        enabled
      }
    });
  });
  document.querySelectorAll('[data-aux-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'setAux', payload: { kind: btn.getAttribute('data-aux-clear'), ref: null } });
    });
  });
  document.querySelectorAll('[data-aux-change]').forEach(btn => {
    btn.addEventListener('click', () => {
      auxEditKind = btn.getAttribute('data-aux-change');
      const cur = auxEditKind === 'vision'
        ? (state.aux.vision && state.aux.vision.ref)
        : (state.aux.web_extract && state.aux.web_extract.ref);
      $('auxPick').value = cur || '';
      setStatus('已选中「' + (auxEditKind === 'vision' ? '视觉' : '网页提取') + '」，选模型后点应用');
    });
  });
  $('btnApplyAux').addEventListener('click', () => {
    const ref = $('auxPick').value || null;
    vscode.postMessage({ type: 'setAux', payload: { kind: auxEditKind, ref } });
  });
  $('btnResetAux').addEventListener('click', () => {
    vscode.postMessage({ type: 'setAux', payload: { resetAll: true } });
  });

  window.addEventListener('message', (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'state') applyState(msg);
    if (msg.type === 'saved') setStatus(msg.ok ? '已保存' : ('保存失败：' + (msg.error || '')), msg.ok ? 'ok' : 'err');
    if (msg.type === 'accountSwitched') {
      setStatus(msg.ok ? '账号已切换' : ('切换失败：' + (msg.error || '')), msg.ok ? 'ok' : 'err');
    }
    if (msg.type === 'toast') {
      setStatus(msg.ok ? (msg.info || '完成') : (msg.error || '失败'), msg.ok ? 'ok' : 'err');
      if (msg.ok && ($('provEditId').value || '').trim()) {
        clearProvEdit();
      }
    }
    if (msg.type === 'catalog') {
      if (!msg.ok) {
        setStatus(msg.error || '刷新失败', 'err');
        return;
      }
      state.catalog = msg.items || [];
      renderCatalog();
      setStatus('已刷新 ' + state.catalog.length + ' 个模型', 'ok');
    }
    if (msg.type === 'modelToggled') {
      const hit = (state.catalog || []).find(x => x.id === msg.modelId);
      if (hit) {
        hit.enabled = Boolean(msg.enabled);
        renderCatalog();
      }
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
