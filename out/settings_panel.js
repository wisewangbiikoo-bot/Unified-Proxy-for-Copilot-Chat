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
/** @type {vscode.ExtensionContext|null} */
let extContext = null;
/**
 * Only set when user picks「当前模型」dropdown — otherwise follow 自动分配「当前选用」.
 * @type {string|null}
 */
let settingsModelOverride = null;

const THINKING_TO_CONFIG = {
    none: "停用",
    low: "轻量",
    high: "标准",
    max: "深度",
};

/** globalState: last refreshed /models list per provider (survives panel close). */
const CATALOG_CACHE_KEY = "unified-proxy.modelCatalogCache";

/**
 * @returns {{ byProvider: Record<string, { at: number, items: object[] }>, lastProviderId: string }}
 */
function loadCatalogCache() {
    const raw = extContext?.globalState.get(CATALOG_CACHE_KEY);
    if (!raw || typeof raw !== "object") {
        return { byProvider: {}, lastProviderId: "" };
    }
    const byProvider =
        raw.byProvider && typeof raw.byProvider === "object" ? raw.byProvider : {};
    return {
        byProvider,
        lastProviderId: String(raw.lastProviderId || ""),
    };
}

function saveCatalogCache(cache) {
    if (!extContext) {
        return;
    }
    void extContext.globalState.update(CATALOG_CACHE_KEY, {
        byProvider: cache.byProvider || {},
        lastProviderId: String(cache.lastProviderId || ""),
    });
}

function serializeCatalogItems(items) {
    return (items || []).map((it) => ({
        id: it.id,
        name: it.name,
        entryId: it.entryId || "",
        hasMeta: Boolean(it.hasMeta),
        context: it.context ?? null,
        output: it.output ?? null,
        costInput: it.costInput ?? null,
        costOutput: it.costOutput ?? null,
        vision: it.vision,
        tools: it.tools,
        thinking: it.thinking,
    }));
}

function rememberCatalog(providerId, items) {
    const id = String(providerId || "").trim();
    if (!id) {
        return;
    }
    const cache = loadCatalogCache();
    cache.byProvider[id] = {
        at: Date.now(),
        items: serializeCatalogItems(items),
    };
    cache.lastProviderId = id;
    saveCatalogCache(cache);
}

function forgetCatalogProvider(providerId) {
    const id = String(providerId || "").trim();
    if (!id) {
        return;
    }
    const cache = loadCatalogCache();
    if (cache.byProvider[id]) {
        delete cache.byProvider[id];
        if (cache.lastProviderId === id) {
            cache.lastProviderId = Object.keys(cache.byProvider)[0] || "";
        }
        saveCatalogCache(cache);
    }
}

function registerSettingsCommands(context, hooks) {
    extContext = context;
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
    if (context) {
        extContext = context;
    }
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
            settingsModelOverride = id;
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
            forgetCatalogProvider(String(msg.providerId || ""));
            onSaved?.();
            await postState(panel.webview, opts.proxyKey);
        }
        return;
    }
    if (type === "setLastCatalogProvider") {
        const id = String(msg.providerId || "").trim();
        if (id) {
            const cache = loadCatalogCache();
            cache.lastProviderId = id;
            saveCatalogCache(cache);
        }
        return;
    }
    if (type === "setAutoAssignCurrent") {
        const id = String(msg.modelId || "").trim();
        if (!id) {
            return;
        }
        try {
            require("./auto_assign").setCurrentAutoAssignTargetId(id, "settings-current");
        }
        catch (e) {
            panel.webview.postMessage({
                type: "toast",
                ok: false,
                error: e?.message || String(e),
            });
            return;
        }
        settingsModelOverride = null; // follow auto-assign again
        opts.proxyKey = id;
        try {
            require("./usage_monitor").syncActiveToAutoAssign({ refresh: true });
        }
        catch {
            /* optional */
        }
        panel.webview.postMessage({
            type: "toast",
            ok: true,
            info: "自动分配当前项已切换（聊天立刻生效）",
        });
        await postState(panel.webview, id);
        return;
    }
    if (type === "refreshCatalog") {
        const result = await refreshCatalog(String(msg.providerId || ""));
        if (result.ok) {
            rememberCatalog(result.providerId, result.items || []);
        }
        panel.webview.postMessage({
            type: "catalog",
            ok: result.ok,
            error: result.error,
            providerId: result.providerId,
            items: result.items || [],
            cachedAt: result.ok ? Date.now() : null,
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
            const cur = String(msg.payload?.currentId || "").trim();
            settingsModelOverride = null;
            if (cur) {
                opts.proxyKey = cur;
            }
            try {
                require("./usage_monitor").syncActiveToAutoAssign({ refresh: true });
            }
            catch {
                /* optional */
            }
            await postState(panel.webview, cur || opts.proxyKey);
        }
        return;
    }
}

/**
 * Resolve which model entry the settings「当前模型」edits.
 * Prefer 自动分配「当前选用」when the pool is configured — matches Copilot「自动分配」.
 * Explicit「当前模型」dropdown override wins until auto-assign current changes.
 */
function resolveCurrentProxyKey(hint) {
    const auto_assign_1 = require("./auto_assign");
    const { ok, cfg } = proxy_config_loader_1.readConfigFile();

    if (settingsModelOverride) {
        const ov = proxy_config_loader_1.parseModelRef(settingsModelOverride).proxyKey;
        if (ov && !auto_assign_1.isAutoAssignModelId(ov)) {
            return ov;
        }
        if (ov && auto_assign_1.isAutoAssignModelId(ov) && ok && cfg) {
            return auto_assign_1.getCurrentAutoAssignTargetId(cfg) || "";
        }
    }

    // Default: follow auto-assign current (what Copilot「自动分配」actually hits)
    if (ok && cfg && config_v2_1.isV2Config(cfg)) {
        const target = auto_assign_1.getCurrentAutoAssignTargetId(cfg);
        if (target) {
            return target;
        }
    }

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
        const packAux = (entry) => {
            if (!entry || typeof entry !== "object") {
                return {
                    configured: false,
                    baseUrl: "",
                    modelId: "",
                    apiKeyMasked: "",
                    hasKey: false,
                    ref: null,
                };
            }
            const baseUrl = String(entry.base_url || entry.baseUrl || "").trim();
            const modelId = String(entry.model_id || entry.modelId || "").trim();
            const key = String(entry.api_key || entry.apiKey || "").trim();
            const ref = entry.ref ? String(entry.ref) : null;
            return {
                configured: config_v2_1.isAuxConfigured(entry),
                baseUrl,
                modelId,
                apiKeyMasked: key ? account_manager_1.maskApiKey(key) : "",
                hasKey: Boolean(key),
                ref,
            };
        };
        aux = {
            vision: packAux(cfg.aux?.vision),
            web_extract: packAux(cfg.aux?.web_extract),
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

    const catalogCache = loadCatalogCache();
    // Drop cache entries for deleted providers
    if (isV2) {
        const alive = new Set(providers.map((p) => p.id));
        let pruned = false;
        for (const pid of Object.keys(catalogCache.byProvider)) {
            if (!alive.has(pid)) {
                delete catalogCache.byProvider[pid];
                pruned = true;
            }
        }
        if (pruned) {
            if (!alive.has(catalogCache.lastProviderId)) {
                catalogCache.lastProviderId = providers[0]?.id || "";
            }
            saveCatalogCache(catalogCache);
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
        catalogCache: catalogCache.byProvider,
        lastCatalogProviderId: catalogCache.lastProviderId,
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
            costInput: meta?.costInput ?? null,
            costOutput: meta?.costOutput ?? null,
            vision: meta?.supportsNativeVision,
            tools: meta?.supportsTools,
            thinking: meta?.supportsThinking,
        };
    });
    return { ok: true, providerId: id, items };
}

async function fetchModelMeta(provider, modelId) {
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
        return catalog.get(modelId) || null;
    }
    catch {
        return null;
    }
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
    // Write enabled immediately — do not block UI on upstream /models.
    const fillMetaLater = (needFill) => {
        if (!needFill) {
            return;
        }
        void (async () => {
            const meta = await fetchModelMeta(provider, modelId);
            if (!meta) {
                return;
            }
            const latest = proxy_config_loader_1.readConfigFile();
            if (!latest.ok || !latest.cfg) {
                return;
            }
            const m2 = config_v2_1.findModel(latest.cfg, entryId);
            if (m2 && m2.enabled && m2.param_source !== "user") {
                m2.params = config_v2_1.paramsFromMeta(meta);
                m2.param_source = "auto";
                proxy_config_loader_1.writeConfigFile(latest.cfg);
                onSaved?.();
            }
        })();
    };
    if (!model && enabled) {
        const displayName = String(payload.name || modelId);
        model = {
            id: entryId,
            provider_id: providerId,
            model_id: modelId,
            enabled: true,
            name: displayName,
            params: config_v2_1.paramsFromMeta(null),
            param_source: "auto",
        };
        cfg.models.push(model);
        proxy_config_loader_1.writeConfigFile(cfg);
        fillMetaLater(true);
        return { ok: true, info: `已启用 ${model.name || modelId}` };
    }
    if (model) {
        model.enabled = enabled;
        proxy_config_loader_1.writeConfigFile(cfg);
        fillMetaLater(enabled && model.param_source !== "user");
        return {
            ok: true,
            info: enabled ? `已启用 ${model.name || modelId}` : `已禁用 ${model.name || modelId}`,
        };
    }
    return { ok: true, info: "已关闭（未入库）" };
}

function emptyAuxEndpoint() {
    return { base_url: "", api_key: "", model_id: "" };
}

async function setAux(payload) {
    const gate = await requireV2();
    if (!gate.ok) {
        return gate;
    }
    const cfg = gate.cfg;
    if (!cfg.aux) {
        cfg.aux = { vision: emptyAuxEndpoint(), web_extract: emptyAuxEndpoint() };
    }
    const kind = String(payload.kind || "").trim();
    if (payload.resetAll) {
        cfg.aux.vision = emptyAuxEndpoint();
        cfg.aux.web_extract = emptyAuxEndpoint();
        proxy_config_loader_1.writeConfigFile(cfg);
        return { ok: true, info: "辅助模型已全部重置为主模型" };
    }
    if (kind !== "vision" && kind !== "web_extract") {
        return { ok: false, error: "未知辅助类型" };
    }
    if (payload.clear) {
        cfg.aux[kind] = emptyAuxEndpoint();
        proxy_config_loader_1.writeConfigFile(cfg);
        return { ok: true, info: kind === "vision" ? "视觉已改回主模型" : "网页提取已改回主模型" };
    }
    const baseUrl = String(payload.baseUrl ?? payload.base_url ?? "").trim();
    const modelId = String(payload.modelId ?? payload.model_id ?? "").trim();
    const apiKeyNew = String(payload.apiKey ?? payload.api_key ?? "");
    if (!baseUrl || !modelId) {
        return { ok: false, error: "请填写 Base URL 和模型名" };
    }
    const prev = cfg.aux[kind] && typeof cfg.aux[kind] === "object" ? cfg.aux[kind] : {};
    const prevKey = String(prev.api_key || prev.apiKey || "").trim();
    const apiKey = apiKeyNew.trim() ? apiKeyNew.trim() : prevKey;
    if (!apiKey) {
        return { ok: false, error: "请填写 API Key" };
    }
    cfg.aux[kind] = {
        base_url: baseUrl.replace(/\/$/, ""),
        model_id: modelId,
        api_key: apiKey,
    };
    proxy_config_loader_1.writeConfigFile(cfg);
    return {
        ok: true,
        info: kind === "vision" ? "视觉辅助模型已保存" : "网页提取辅助模型已保存",
    };
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
    width: 100%; box-sizing: border-box;
  }
  .list-row.catalog-row {
    padding: 3px 0; gap: 8px; align-items: center;
  }
  .list-row:last-child { border-bottom: none; }
  .list-main { flex: 1 1 auto; min-width: 0; }
  .list-main .sub { margin: 0; }
  /* Grid — label+flex was clipping pool text to 0 width in webview */
  #autoPoolList { width: 100%; }
  #autoPoolList .pool-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 20px;
    align-items: center;
    column-gap: 12px;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 0;
    border-bottom: 1px solid var(--vscode-widget-border, #333);
    cursor: pointer;
  }
  #autoPoolList .pool-row:last-child { border-bottom: none; }
  #autoPoolList .pool-text { min-width: 0; display: block; }
  #autoPoolList .pool-name {
    display: block;
    color: var(--vscode-foreground);
    font-weight: 600;
    line-height: 1.35;
    white-space: normal;
    word-break: normal;
    overflow-wrap: anywhere;
  }
  #autoPoolList .pool-meta {
    display: block;
    margin-top: 2px;
    font-size: 0.8em;
    line-height: 1.3;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #autoPoolList .pool-row input[type="checkbox"] {
    width: 16px; height: 16px; margin: 0; justify-self: end;
  }
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
  /* div[role=switch] — avoid <button>:active theme flash (looks like double toggle) */
  .switch {
    width: 40px; height: 22px; border-radius: 999px; border: none; cursor: pointer;
    background: var(--vscode-input-background); position: relative; flex-shrink: 0;
    padding: 0; margin: 0; display: inline-block; box-sizing: border-box;
    -webkit-tap-highlight-color: transparent; user-select: none;
    outline: none; box-shadow: none;
  }
  .switch.sm { width: 26px; height: 14px; }
  .switch.on { background: var(--vscode-testing-iconPassed, #3fb950); }
  .switch:active, .switch:focus, .switch:focus-visible {
    background: var(--vscode-input-background);
    outline: none; box-shadow: none;
  }
  .switch.on:active, .switch.on:focus, .switch.on:focus-visible {
    background: var(--vscode-testing-iconPassed, #3fb950);
  }
  .switch::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
    border-radius: 50%; background: #fff; transition: left .12s;
    pointer-events: none;
  }
  .switch.sm::after { width: 10px; height: 10px; top: 2px; left: 2px; }
  .switch.on::after { left: 20px; }
  .switch.sm.on::after { left: 14px; }
  .switch.busy { opacity: 0.65; pointer-events: none; }
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
      <div class="sub">有自动分配池时，默认显示「自动分配 → 当前选用」对应的模型（与 Copilot 选「自动分配」一致）。也可在下方改选其它模型只改参数。</div>
      <div class="sub" id="autoAssignHint" style="margin-top:6px"></div>
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
      <div class="sub">从已启用模型中勾选进入轮换池，改完后必须点「保存自动分配」才会生效。Copilot 里选模型「自动分配」后，按下方策略使用池内模型（可混不同供应商 / API Key）。</div>
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
      <div class="sub">「当前选用」一改就立刻决定 Copilot「自动分配」打向谁（手动模式）；改池勾选仍需点下方保存。</div>
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
      <div class="sub">主对话仍走供应商列表。这里为「视觉 / 网页提取」单独填一个 OpenAI 兼容接口（Base URL + 模型名 + API Key）。留空或点清除 = 用主模型。</div>
    </div>
    <div class="card">
      <h2>视觉 <span class="tag">图片分析</span></h2>
      <div class="sub" id="auxVisionStatus">自动 · 使用主模型</div>
      <div class="row"><label>Base URL</label><input id="auxVisionUrl" placeholder="https://api.example.com/v1" /></div>
      <div class="row"><label>模型名</label><input id="auxVisionModel" placeholder="gpt-4o-mini" /></div>
      <div class="row"><label>API Key</label><input id="auxVisionKey" type="password" placeholder="必填；已保存时留空则不改" /></div>
      <div class="actions">
        <button class="primary" id="btnSaveAuxVision">保存视觉</button>
        <button class="secondary" id="btnClearAuxVision">清除（用主模型）</button>
      </div>
    </div>
    <div class="card">
      <h2>网页提取 <span class="tag">页面总结</span></h2>
      <div class="sub" id="auxWebStatus">自动 · 使用主模型</div>
      <div class="row"><label>Base URL</label><input id="auxWebUrl" placeholder="https://api.example.com/v1" /></div>
      <div class="row"><label>模型名</label><input id="auxWebModel" placeholder="gpt-4o-mini" /></div>
      <div class="row"><label>API Key</label><input id="auxWebKey" type="password" placeholder="必填；已保存时留空则不改" /></div>
      <div class="actions">
        <button class="primary" id="btnSaveAuxWeb">保存网页提取</button>
        <button class="secondary" id="btnClearAuxWeb">清除（用主模型）</button>
      </div>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let state = {
    isV2: false, enabledModels: [], providers: [], aux: {}, autoAssign: {},
    catalog: [], catalogCache: {}, catalogProviderId: ''
  };
  const pendingToggles = new Set(); // modelId currently saving — ignore duplicate pointer events
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
  function auxStatusText(entry) {
    if (!entry || !entry.configured) return '自动 · 使用主模型';
    if (entry.baseUrl && entry.modelId) {
      return entry.modelId + ' @ ' + entry.baseUrl +
        (entry.apiKeyMasked ? ' · key ' + entry.apiKeyMasked : '');
    }
    if (entry.ref) return '旧引用 · ' + entry.ref;
    return '已配置';
  }
  function fillAuxForms() {
    const v = state.aux.vision || {};
    const w = state.aux.web_extract || {};
    $('auxVisionStatus').textContent = auxStatusText(v);
    $('auxWebStatus').textContent = auxStatusText(w);
    $('auxVisionUrl').value = v.baseUrl || '';
    $('auxVisionModel').value = v.modelId || '';
    $('auxVisionKey').value = '';
    $('auxVisionKey').placeholder = v.hasKey
      ? ('当前 ' + (v.apiKeyMasked || '***') + ' · 留空不改')
      : '必填';
    $('auxWebUrl').value = w.baseUrl || '';
    $('auxWebModel').value = w.modelId || '';
    $('auxWebKey').value = '';
    $('auxWebKey').placeholder = w.hasKey
      ? ('当前 ' + (w.apiKeyMasked || '***') + ' · 留空不改')
      : '必填';
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
  function checkedAutoModelIds() {
    return [...document.querySelectorAll('#autoPoolList input[data-auto-id]:checked')]
      .map(el => el.getAttribute('data-auto-id'))
      .filter(Boolean);
  }
  function fillAutoCurrentSelect(preferId) {
    const aa = state.autoAssign || {};
    const models = state.enabledModels || [];
    const byId = new Map(models.map(m => [m.id, m]));
    const ids = checkedAutoModelIds();
    const prefer = preferId || $('autoCurrent').value || aa.current || '';
    $('autoCurrent').innerHTML = ids.length
      ? ids.map(id => {
          const m = byId.get(id);
          const label = m ? (m.name || m.modelId || id) : id;
          return '<option value="' + esc(id) + '"' +
            (id === prefer ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('')
      : '<option value="">（池为空 · 勾选后点保存）</option>';
    if (prefer && ids.includes(prefer)) $('autoCurrent').value = prefer;
  }
  function updateAutoAssignHint() {
    const el = $('autoAssignHint');
    if (!el) return;
    const aa = state.autoAssign || {};
    const ids = aa.model_ids || [];
    if (!ids.length) {
      el.textContent = '';
      return;
    }
    const cur = aa.current || ids[0];
    const m = (state.enabledModels || []).find(x => x.id === cur);
    const label = m ? (m.name || m.modelId) : cur;
    el.innerHTML = '当前应对齐：<strong>' + esc(label) +
      '</strong>（自动分配 · 手动当前项）。到「自动分配」改「当前选用」会同步到本页。';
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
          '<label class="pool-row">' +
            '<span class="pool-text">' +
              '<span class="pool-name">' + esc(m.name || m.modelId || m.id) + '</span>' +
              '<span class="pool-meta" title="' + esc((m.providerName || '') + ' · ' + (m.modelId || m.id)) + '">' +
                esc(m.providerName || '') + ' · ' + esc(m.modelId || m.id) +
              '</span></span>' +
            '<input type="checkbox" data-auto-id="' + esc(m.id) + '"' +
            (selected.has(m.id) ? ' checked' : '') + ' />' +
          '</label>'
        ).join('')
      : '<div class="sub">请先在「模型」页启用至少一个模型。</div>';
    fillAutoCurrentSelect(aa.current);
  }
  function fillCatalogProviderSelect(preferredId) {
    const sel = $('catalogProvider');
    const cur = preferredId || sel.value;
    sel.innerHTML = (state.providers || []).map(p =>
      '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'
    ).join('');
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
  }
  function formatCacheTime(at) {
    const n = Number(at);
    if (!Number.isFinite(n) || n <= 0) return '';
    try { return new Date(n).toLocaleString(); } catch (_) { return ''; }
  }
  function loadCatalogForProvider(providerId, announce) {
    const pid = String(providerId || '');
    state.catalogProviderId = pid;
    const packed = state.catalogCache && state.catalogCache[pid];
    if (packed && Array.isArray(packed.items) && packed.items.length) {
      state.catalog = packed.items.map(x => Object.assign({}, x));
      syncCatalogEnabledFlags();
      renderCatalog();
      if (announce) {
        const when = formatCacheTime(packed.at);
        setStatus(
          '已加载上次列表' + (when ? ' · ' + when : '') +
          ' · ' + state.catalog.length + ' 个（点刷新可更新）',
          'ok'
        );
      }
      return true;
    }
    state.catalog = [];
    renderCatalog();
    return false;
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
  function fmtPrice(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return '';
    if (v === 0) return '0';
    if (v >= 100) return String(Math.round(v));
    if (v >= 1) return (Math.round(v * 100) / 100).toString();
    // keep meaningful digits for small $/1M prices
    const s = v.toFixed(4).replace(/0+$/, '').replace(/\\.$/, '');
    return s || '0';
  }
  function formatCatalogLimit(it) {
    const parts = [];
    const ctx = fmtTok(it.context);
    const out = fmtTok(it.output);
    if (ctx) parts.push('ctx ' + ctx);
    if (out) parts.push('out ' + out);
    const pin = fmtPrice(it.costInput);
    const pout = fmtPrice(it.costOutput);
    if (pin || pout) {
      parts.push('$' + (pin || '—') + '/$' + (pout || '—'));
    }
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
        '<div role="switch" class="switch sm' + (it.enabled ? ' on' : '') +
        (pendingToggles.has(it.id) ? ' busy' : '') +
        '" aria-checked="' + (it.enabled ? 'true' : 'false') +
        '" tabindex="0" data-toggle="' + esc(it.id) +
        '" data-name="' + esc(it.name) + '" title="' + (it.enabled ? '点击禁用' : '点击启用') + '"></div></div>'
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
    if (msg.catalogCache && typeof msg.catalogCache === 'object') {
      state.catalogCache = msg.catalogCache;
    }
    fillCatalogProviderSelect(msg.lastCatalogProviderId || state.catalogProviderId);
    renderAutoPool();
    updateAutoAssignHint();
    const pid = ($('catalogProvider') && $('catalogProvider').value) || '';
    const hadLocal = (state.catalog || []).length > 0 && state.catalogProviderId === pid;
    if (hadLocal) {
      syncCatalogEnabledFlags();
      renderCatalog();
    } else {
      loadCatalogForProvider(pid, true);
    }
    fillAuxForms();
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
  $('autoPoolList').addEventListener('change', (ev) => {
    if (!ev.target || !ev.target.matches || !ev.target.matches('input[data-auto-id]')) return;
    fillAutoCurrentSelect();
    setStatus('池已改动，请点「保存自动分配」后生效');
  });
  $('autoCurrent').addEventListener('change', () => {
    const id = $('autoCurrent').value || '';
    if (!id) return;
    setStatus('正在切换自动分配当前项…');
    vscode.postMessage({ type: 'setAutoAssignCurrent', modelId: id });
  });
  $('btnSaveAuto').addEventListener('click', () => {
    const modelIds = checkedAutoModelIds();
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
  $('catalogProvider').addEventListener('change', () => {
    const pid = $('catalogProvider').value;
    vscode.postMessage({ type: 'setLastCatalogProvider', providerId: pid });
    loadCatalogForProvider(pid, true);
  });
  $('btnRefreshCatalog').addEventListener('click', () => {
    setStatus('刷新模型目录…');
    vscode.postMessage({ type: 'refreshCatalog', providerId: $('catalogProvider').value });
  });
  $('modelSearch').addEventListener('input', renderCatalog);
  let pointerDownToggle = null;
  function applyCatalogToggle(btn) {
    if (!btn || btn.classList.contains('busy')) return;
    const modelId = btn.getAttribute('data-toggle');
    if (!modelId || pendingToggles.has(modelId)) return;
    const name = btn.getAttribute('data-name') || modelId;
    const enabled = !btn.classList.contains('on');
    pendingToggles.add(modelId);
    btn.classList.add('busy');
    btn.classList.toggle('on', enabled);
    btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
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
  }
  // pointerdown+pointerup on same switch only (once). No click — avoids :active flash + click double feel.
  $('catalogList').addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    pointerDownToggle = ev.target.closest('[data-toggle]');
  });
  $('catalogList').addEventListener('pointerup', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    const btn = ev.target.closest('[data-toggle]');
    const started = pointerDownToggle;
    pointerDownToggle = null;
    if (!btn || btn !== started) return;
    ev.preventDefault();
    ev.stopPropagation();
    applyCatalogToggle(btn);
  });
  $('catalogList').addEventListener('pointercancel', () => { pointerDownToggle = null; });
  $('catalogList').addEventListener('keydown', (ev) => {
    const btn = ev.target.closest && ev.target.closest('[data-toggle]');
    if (!btn) return;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    applyCatalogToggle(btn);
  });
  $('catalogList').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-toggle]')) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  });
  function saveAuxKind(kind) {
    const isVision = kind === 'vision';
    vscode.postMessage({
      type: 'setAux',
      payload: {
        kind,
        baseUrl: $(isVision ? 'auxVisionUrl' : 'auxWebUrl').value,
        modelId: $(isVision ? 'auxVisionModel' : 'auxWebModel').value,
        apiKey: $(isVision ? 'auxVisionKey' : 'auxWebKey').value,
      }
    });
  }
  $('btnSaveAuxVision').addEventListener('click', () => saveAuxKind('vision'));
  $('btnSaveAuxWeb').addEventListener('click', () => saveAuxKind('web_extract'));
  $('btnClearAuxVision').addEventListener('click', () => {
    vscode.postMessage({ type: 'setAux', payload: { kind: 'vision', clear: true } });
  });
  $('btnClearAuxWeb').addEventListener('click', () => {
    vscode.postMessage({ type: 'setAux', payload: { kind: 'web_extract', clear: true } });
  });
  $('btnResetAux').addEventListener('click', () => {
    vscode.postMessage({ type: 'setAux', payload: { resetAll: true } });
  });

  window.addEventListener('message', (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'state') {
      pendingToggles.clear();
      applyState(msg);
    }
    if (msg.type === 'saved') setStatus(msg.ok ? '已保存' : ('保存失败：' + (msg.error || '')), msg.ok ? 'ok' : 'err');
    if (msg.type === 'accountSwitched') {
      setStatus(msg.ok ? '账号已切换' : ('切换失败：' + (msg.error || '')), msg.ok ? 'ok' : 'err');
    }
    if (msg.type === 'toast') {
      setStatus(msg.ok ? (msg.info || '完成') : (msg.error || '失败'), msg.ok ? 'ok' : 'err');
      if (msg.ok && ($('provEditId').value || '').trim()) {
        clearProvEdit();
      }
      if (!msg.ok && pendingToggles.size) {
        pendingToggles.clear();
        if ((state.catalog || []).length) renderCatalog();
      }
    }
    if (msg.type === 'catalog') {
      if (!msg.ok) {
        setStatus(msg.error || '刷新失败', 'err');
        return;
      }
      const pid = msg.providerId || $('catalogProvider').value;
      state.catalog = msg.items || [];
      state.catalogProviderId = pid;
      if (!state.catalogCache) state.catalogCache = {};
      state.catalogCache[pid] = { at: msg.cachedAt || Date.now(), items: state.catalog.map(x => Object.assign({}, x)) };
      syncCatalogEnabledFlags();
      renderCatalog();
      setStatus('已刷新 ' + state.catalog.length + ' 个模型（已记住）', 'ok');
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
