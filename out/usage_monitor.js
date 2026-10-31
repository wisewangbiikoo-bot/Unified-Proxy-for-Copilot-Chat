"use strict";
/**
 * OpenCode Go quota status bar + local token totals.
 * Refresh policy (silent):
 *   1) reload/activate → fetch once, counter = 0
 *   2) every 5 min → if any OpenCode Go API forwards in the window, fetch once & reset counter
 *   No focus / idle / every-N / statusbar-click refreshes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startUsageMonitor = startUsageMonitor;
exports.recordLocalTokenUsage = recordLocalTokenUsage;
exports.getLocalTokenUsage = getLocalTokenUsage;
exports.notifyChatUsage = notifyChatUsage;
exports.setActiveChatModel = setActiveChatModel;
exports.getLastActiveChat = getLastActiveChat;
exports.getLastQuotaSnapshot = getLastQuotaSnapshot;
exports.refreshUsageQuota = refreshUsageQuota;

function getLastQuotaSnapshot() {
    return lastQuotaSnapshot;
}

/** @param {string} [reason] */
function refreshUsageQuota(reason) {
    return refreshQuota(reason || "external", { silent: true });
}

const vscode = require("vscode");
const fs = require("fs");
const opencode_headers_1 = require("./opencode_headers");
const proxy_config_loader_1 = require("./proxy_config_loader");
const logger_1 = require("./logger");
const no_proxy_1 = require("./no_proxy");

const CONFIG_SECTION = "unified-proxy-copilot";
const LOCAL_USAGE_KEY = "unified-proxy-copilot.localTokenUsage";
/** Fixed window: if any OC Go forwards occurred, refresh once at end of window. */
const QUOTA_WINDOW_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

/** @type {vscode.ExtensionContext|null} */
let extContext = null;
/** @type {vscode.StatusBarItem|null} */
let statusBar = null;
/** @type {NodeJS.Timeout|null} */
let windowTimer = null;
/** OpenCode Go API forwards counted in the current 5-minute window. */
let ocForwardsInWindow = 0;
/** @type {{ at: number, endpoints: Array<{ label: string, baseUrl: string, usage: any, error?: string }> }|null} */
let lastQuotaSnapshot = null;
/**
 * Last chat model that went through Unified Proxy.
 * Copilot does not expose model-picker selection — Auto/builtin never call us.
 * Status bar (auto) only while lastActiveChat.isOpenCode === true.
 * @type {{ proxyKey: string, baseUrl: string, isOpenCode: boolean }|null}
 */
let lastActiveChat = null;
/** Last time an OpenCode Go request hit our provider (ms). */
let lastOpenCodeActivityAt = 0;
/** @type {NodeJS.Timeout|null} */
let hideAfterIdleTimer = null;
/**
 * Copilot Auto never notifies us. Soft-hide only after long OC idle so bar does not
 * vanish while still on an OpenCode model between messages.
 */
const HIDE_AFTER_OC_IDLE_MS = 30 * 60 * 1000;

function getLastActiveChat() {
    return lastActiveChat;
}

function clearHideAfterIdleTimer() {
    if (hideAfterIdleTimer) {
        clearTimeout(hideAfterIdleTimer);
        hideAfterIdleTimer = null;
    }
}

/** Mark session as not-on-OpenCode and hide usage bar (auto mode). */
function markNotOnOpenCode(reason) {
    clearHideAfterIdleTimer();
    if (lastActiveChat?.isOpenCode) {
        lastActiveChat = {
            proxyKey: lastActiveChat.proxyKey || "",
            baseUrl: lastActiveChat.baseUrl || "",
            isOpenCode: false,
        };
    }
    else if (!lastActiveChat) {
        lastActiveChat = { proxyKey: "", baseUrl: "", isOpenCode: false };
    }
    updateStatusBarVisibility(false, false);
    logger_1.logger.info(`Usage status bar hide (${reason || "not-opencode"})`);
}

function scheduleHideAfterOpenCodeIdle() {
    clearHideAfterIdleTimer();
    hideAfterIdleTimer = setTimeout(() => {
        hideAfterIdleTimer = null;
        // Still no OC activity → treat as left OpenCode (e.g. switched to Copilot Auto)
        if (
            lastActiveChat?.isOpenCode &&
            Date.now() - lastOpenCodeActivityAt >= HIDE_AFTER_OC_IDLE_MS - 500
        ) {
            markNotOnOpenCode("opencode-idle");
        }
    }, HIDE_AFTER_OC_IDLE_MS);
}

/**
 * Remember which proxy/model the user is chatting with (only when our provider runs).
 * @param {string} proxyKey  proxy_configs.json key (= Copilot model id)
 * @param {string} [baseUrl]
 */
function setActiveChatModel(proxyKey, baseUrl) {
    const key = String(proxyKey || "").trim();
    if (!key) {
        return;
    }
    let url = String(baseUrl || "").trim();
    if (!url) {
        try {
            const pc = (0, proxy_config_loader_1.getProxyConfig)(key);
            url = String(pc?.baseUrl || "").trim();
        }
        catch {
            url = "";
        }
    }
    const isOpenCode = (0, opencode_headers_1.isOpenCodeGoEndpoint)(url);
    const prev = lastActiveChat;
    lastActiveChat = { proxyKey: key, baseUrl: url, isOpenCode };
    if (!isOpenCode) {
        markNotOnOpenCode("unified-proxy-non-opencode");
        return;
    }
    lastOpenCodeActivityAt = Date.now();
    scheduleHideAfterOpenCodeIdle();
    logger_1.logger.info(
        `setActiveChatModel OC key=${key} url=${url} prevOc=${Boolean(prev?.isOpenCode)}`,
    );
    // Show bar immediately (don't wait for usage fetch)
    if (statusBar && getShowMode() !== "off") {
        statusBar.text = formatStatusBarLabel(lastQuotaSnapshot?.endpoints?.[0]?.usage, false);
        statusBar.show();
    }
    else if (!statusBar) {
        logger_1.logger.warn("setActiveChatModel: statusBar is null (monitor not started?)");
    }
    // Quota refresh is window-based only (not on every model switch).
}

function getShowMode() {
    const raw = String(
        vscode.workspace.getConfiguration(CONFIG_SECTION).get("showUsageStatusBar") ?? "auto",
    )
        .trim()
        .toLowerCase();
    if (raw === "always" || raw === "on" || raw === "true") {
        return "always";
    }
    if (raw === "off" || raw === "never" || raw === "false") {
        return "off";
    }
    return "auto";
}


/**
 * Prefer last OC chat model; else first multi-account OC; else first OC in config.
 * (Cursor Agent may never call our LM provider — still need a quota target.)
 * @returns {{ key: string, proxy: object }|null}
 */
function pickUsageProxyTarget(cfg) {
    const account_manager_1 = require("./account_manager");
    const config_v2_1 = require("./config_v2");
    const entries = (0, config_v2_1.listProviderEntries)(cfg).filter(([, proxy]) =>
        (0, opencode_headers_1.isOpenCodeGoEndpoint)(proxy?.base_url),
    );
    if (!entries.length) {
        return null;
    }
    if (lastActiveChat?.isOpenCode && lastActiveChat.proxyKey) {
        const rawId = lastActiveChat.proxyKey;
        let key = rawId;
        try {
            key = proxy_config_loader_1.parseModelRef(rawId).proxyKey || rawId;
        }
        catch {
            key = rawId;
        }
        const lookup = proxy_config_loader_1.getAccountLookupKey
            ? proxy_config_loader_1.getAccountLookupKey(key, cfg)
            : key;
        let hit = entries.find(([k]) => k === lookup || k === key);
        if (!hit) {
            hit = entries.find(([k, p]) => k === rawId || p?.name === rawId || p?.name === key);
        }
        if (hit) {
            return { key: hit[0], proxy: hit[1] };
        }
    }
    for (const [key, proxy] of entries) {
        const { accounts } = account_manager_1.parseAccountsFromProxy(proxy, key);
        if (accounts.length > 1) {
            return { key, proxy };
        }
    }
    return { key: entries[0][0], proxy: entries[0][1] };
}

/**
 * OpenCode Go endpoint for status/usage.
 * @returns {Array<{ label: string, proxyKey: string, localAlias: string, accountId: string, baseUrl: string, apiKey: string, openCodeSession: string, customHeaders: object|null }>}
 */
function collectOpenCodeEndpoints() {
    // Explicitly on a non-OC model → no usage fetch
    if (lastActiveChat && !lastActiveChat.isOpenCode) {
        return [];
    }
    const path = (0, proxy_config_loader_1.getProxyConfigPath)();
    if (!fs.existsSync(path)) {
        return [];
    }
    let cfg;
    try {
        cfg = JSON.parse(fs.readFileSync(path, "utf-8"));
    }
    catch {
        return [];
    }
    const account_manager_1 = require("./account_manager");
    const target = pickUsageProxyTarget(cfg);
    if (!target) {
        return [];
    }
    const { key, proxy } = target;
    const baseUrl = proxy?.base_url;
    if (!baseUrl || !(0, opencode_headers_1.isOpenCodeGoEndpoint)(baseUrl)) {
        return [];
    }
    const resolved = account_manager_1.resolveApiKeyForProxy(key, proxy);
    const apiKey = resolved.apiKey;
    if (!apiKey) {
        return [];
    }
    const localAlias = resolved.account?.autoNamed
        ? ""
        : String(resolved.account?.name || "").trim();
    return [
        {
            label: proxy.name || key,
            proxyKey: key,
            localAlias,
            accountId: resolved.account?.id || "default",
            baseUrl: String(baseUrl).replace(/\/$/, ""),
            apiKey: String(apiKey),
            openCodeSession: String(proxy.opencode_session || proxy.openCodeSession || ""),
            customHeaders: proxy.custom_headers || proxy.customHeaders || null,
        },
    ];
}

/** Prefer configured accounts[].name (e.g. email); else OpenCode subscriber short id. */
function resolveAccountDisplayLabel(ep, idn) {
    const alias = String(ep?.localAlias || "").trim();
    if (alias) {
        return alias;
    }
    return String(idn?.shortLabel || "").trim();
}

function usageUrl(baseUrl) {
    // base is .../v1 → .../v1/usage
    return `${String(baseUrl).replace(/\/$/, "")}/usage`;
}

/** @type {Map<string, { at: number, subscriberUserId?: string, product?: string, shortLabel?: string, error?: string }>} */
const identityCache = new Map();
const IDENTITY_TTL_MS = 30 * 60 * 1000;

/** Short OpenCode account label from subscriberUserId (not model/proxy name). */
function shortOpenCodeAccountId(subscriberUserId) {
    const id = String(subscriberUserId || "").trim();
    if (!id) {
        return "";
    }
    // user_01M30WW6EEX88J38HZ2N35E4PN → user_…35E4PN
    if (id.length <= 14) {
        return id;
    }
    return `${id.slice(0, 5)}…${id.slice(-6)}`;
}

/**
 * Console dashboard percent: Math.round(used/limit*100).
 * /zen/go/v1/usage uses Math.floor — can show 0% while console shows 1%.
 * @see https://github.com/anomalyco/opencode/issues/53701
 */
function meterToWindow(meter) {
    if (!meter || typeof meter !== "object") {
        return null;
    }
    const used = Number(meter.usedMicroCents ?? meter.used_micro_cents);
    const limit = Number(meter.limitMicroCents ?? meter.limit_micro_cents);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
        return null;
    }
    const percent = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
    return {
        status: percent >= 100 ? "rate-limited" : "ok",
        percent,
        resetsAt: meter.resetsAt || meter.resets_at || "",
        usedMicroCents: used,
        limitMicroCents: limit,
    };
}

/** Build usage windows from go/status access.meters (same source as console UI). */
function usageFromStatusMeters(body) {
    const m = body?.access?.meters || body?.meters || {};
    const rolling = meterToWindow(m.fiveHour || m.five_hour || m.rolling);
    const weekly = meterToWindow(m.week || m.weekly);
    const monthly = meterToWindow(m.month || m.monthly);
    if (!rolling && !weekly && !monthly) {
        return null;
    }
    return { rolling, weekly, monthly };
}

/**
 * OpenCode Go identity + precise usage via Console API (Bearer oc_sk_).
 * Prefer go/status meters (dashboard rounding) over /zen/go/v1/usage (floored).
 * @param {string} apiKey
 * @param {{ bypassCache?: boolean }} [opts]
 * @returns {Promise<{ subscriberUserId?: string, product?: string, shortLabel: string, usage?: object, error?: string }>}
 */
async function fetchGoAccountIdentity(apiKey, opts = {}) {
    const cacheKey = String(apiKey || "").slice(0, 48);
    const hit = identityCache.get(cacheKey);
    // Usage must be fresh — only reuse cache for identity-only callers
    if (!opts.bypassCache && hit && Date.now() - hit.at < IDENTITY_TTL_MS && hit.usage) {
        return hit;
    }
    (0, no_proxy_1.applyNoProxyBypass)();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch("https://opencode.ai/console/api/go/status", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
            },
            signal: ac.signal,
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            const err = {
                at: Date.now(),
                shortLabel: "",
                error: `HTTP ${resp.status} ${text.slice(0, 80)}`,
            };
            identityCache.set(cacheKey, err);
            return err;
        }
        const body = await resp.json();
        const subscriberUserId = body?.subscriberUserId || body?.subscriber_user_id || "";
        const product = body?.product || body?.renewalProduct || "go";
        const shortLabel = shortOpenCodeAccountId(subscriberUserId) || product;
        const out = {
            at: Date.now(),
            subscriberUserId,
            product,
            shortLabel,
            usage: usageFromStatusMeters(body) || undefined,
        };
        identityCache.set(cacheKey, out);
        return out;
    }
    catch (e) {
        const err = {
            at: Date.now(),
            shortLabel: "",
            error: e?.message || String(e),
        };
        identityCache.set(cacheKey, err);
        return err;
    }
    finally {
        clearTimeout(timer);
    }
}

/**
 * Fallback: floored percents from /zen/go/v1/usage (may disagree with console by ~1%).
 * @returns {Promise<{ usage?: any, error?: string }>}
 */
async function fetchGoUsage(endpoint) {
    (0, no_proxy_1.applyNoProxyBypass)();
    const headers = (0, opencode_headers_1.buildUpstreamHeaders)({
        baseUrl: endpoint.baseUrl,
        customHeaders: endpoint.customHeaders,
        sessionOverride: endpoint.openCodeSession,
    });
    headers.Authorization = `Bearer ${endpoint.apiKey}`;
    headers.Accept = "application/json";
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
        const resp = await fetch(usageUrl(endpoint.baseUrl), {
            method: "GET",
            headers,
            signal: ac.signal,
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return { error: `HTTP ${resp.status} ${text.slice(0, 120)}` };
        }
        const body = await resp.json();
        return { usage: body?.usage || body };
    }
    catch (e) {
        return { error: e?.message || String(e) };
    }
    finally {
        clearTimeout(timer);
    }
}

function pct(window) {
    if (!window || typeof window !== "object") {
        return null;
    }
    const n = Number(window.percent);
    return Number.isFinite(n) ? n : null;
}

/** OpenCode returns ISO UTC (often with ms); show local wall-clock, not “our math”. */
function formatResetsAt(raw) {
    const s = String(raw || "").trim();
    if (!s) {
        return "";
    }
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
        return s;
    }
    return d.toLocaleString();
}

/** Copilot-style: 「在 08:00 重置 11月1日」 */
function formatResetsAtShort(raw) {
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

/** Segments in hover progress bar (was 10 ≈ 1/3 panel; 30 fills most of the hover). */
const USAGE_BAR_SEGMENTS = 30;

/**
 * Progress bar for Markdown hover.
 * Same glyph for filled + empty (only color differs) so heights match.
 */
function usageBarHtml(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const n = USAGE_BAR_SEGMENTS;
    const filled = Math.round((p / 100) * n);
    const empty = n - filled;
    const cell = "█";
    const solid = filled
        ? `<span style="color:var(--vscode-foreground);">${cell.repeat(filled)}</span>`
        : "";
    const ghost = empty
        ? `<span style="color:var(--vscode-disabledForeground);">${cell.repeat(empty)}</span>`
        : "";
    return `<span style="display:inline-block;">${solid}${ghost}</span>`;
}

/** Status bar: custom hub→backends icon (contributes.icons). */
const STATUS_ICON = "$(unified-proxy)";
const STATUS_ICON_ERR = "$(warning)";

/** Compact bar text: icon + monthly% (Stable has no hover-fetch API). */
function formatStatusBarLabel(usage, hasError) {
    if (hasError) {
        return STATUS_ICON_ERR;
    }
    const m = pct(usage?.monthly);
    if (m === null) {
        return `${STATUS_ICON} …`;
    }
    return `${STATUS_ICON} ${m}%`;
}

function formatStatusA11y(usage, openCodeAccountLabel) {
    if (!usage || typeof usage !== "object") {
        return openCodeAccountLabel
            ? `Unified Proxy OpenCode Go · ${openCodeAccountLabel}`
            : "Unified Proxy OpenCode Go";
    }
    const parts = [];
    const m = pct(usage.monthly);
    const w = pct(usage.weekly);
    const r = pct(usage.rolling);
    if (m !== null) {
        parts.push(`月${m}%`);
    }
    if (w !== null) {
        parts.push(`周${w}%`);
    }
    if (r !== null) {
        parts.push(`5h${r}%`);
    }
    const body = parts.length ? parts.join(" · ") : "";
    const acct = openCodeAccountLabel ? ` · ${openCodeAccountLabel}` : "";
    return `Unified Proxy Go ${body}${acct}`.replace(/\s+/g, " ").trim();
}

/** @deprecated kept for log lines */
function formatStatusText(usage, openCodeAccountLabel) {
    return formatStatusA11y(usage, openCodeAccountLabel);
}

/**
 * Copilot-like hover panel (Markdown + safe HTML). Third-party extensions cannot
 * attach a real webview to status-bar hover — this is the closest public API.
 * @returns {vscode.MarkdownString}
 */
function buildHoverMarkdown(snapshot) {
    const md = new vscode.MarkdownString(undefined, true);
    md.supportHtml = true;
    md.isTrusted = {
        enabledCommands: [
            "unified-proxy-copilot.openSettings",
            "unified-proxy-copilot.refreshUsage",
            "unified-proxy-copilot.showUsage",
        ],
    };

    const ep = snapshot?.endpoints?.[0];
    if (!ep) {
        md.appendMarkdown(
            "## Unified Proxy\n\n" +
                "未解析到 OpenCode Go 用量。\n\n" +
                `[打开设置](command:unified-proxy-copilot.openSettings) · ` +
                `[刷新](command:unified-proxy-copilot.refreshUsage)\n`,
        );
        return md;
    }

    const title = ep.openCodeProduct
        ? `OpenCode ${String(ep.openCodeProduct).toUpperCase()}`
        : "OpenCode Go";
    const account =
        ep.openCodeAccountLabel || ep.openCodeAccountId || ep.localAlias || "—";

    // ## is larger than ### (hover HTML cannot set font-size — sanitizer strips it)
    md.appendMarkdown(`## ${title}\n\n`);
    if (snapshot?.at) {
        const t = new Date(snapshot.at);
        const clock = t.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        md.appendMarkdown(`**更新于 ${clock}**\n\n`);
    }
    md.appendMarkdown(
        `**账号** \`${account}\` &nbsp; ` +
            `[设置](command:unified-proxy-copilot.openSettings) · ` +
            `[刷新](command:unified-proxy-copilot.refreshUsage)\n\n`,
    );

    if (ep.error && !ep.usage) {
        md.appendMarkdown(`$(warning) 用量拉取失败：${ep.error}\n\n`);
    }
    else {
        const u = ep.usage || {};
        const rows = [
            { key: "monthly", label: "月额度" },
            { key: "weekly", label: "周额度" },
            { key: "rolling", label: "5 小时" },
        ];
        for (const row of rows) {
            const win = u[row.key];
            if (!win) {
                continue;
            }
            const p = pct(win);
            const used = p === null ? "?" : String(p);
            const reset = win.resetsAt ? formatResetsAtShort(win.resetsAt) : "";
            md.appendMarkdown(`### ${row.label} &nbsp; ${used}% 已使用\n\n`);
            if (p !== null) {
                md.appendMarkdown(`${usageBarHtml(p)}\n\n`);
            }
            if (reset) {
                md.appendMarkdown(`${reset}\n\n`);
            }
        }
    }

    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`**模型** \`${ep.label || ep.proxyKey || "?"}\`\n`);
    return md;
}

/** Plain-text fallback (logs / older callers). */
function formatTooltip(snapshot) {
    const lines = ["Unified Proxy — OpenCode Go usage"];
    if (!snapshot?.endpoints?.length) {
        lines.push("No OpenCode Go endpoints in proxy_configs.json");
        return lines.join("\n");
    }
    for (const ep of snapshot.endpoints) {
        lines.push("");
        lines.push(`${ep.label} (${ep.baseUrl})`);
        lines.push(
            `  OpenCode account: ${ep.openCodeAccountId || ep.openCodeAccountLabel || "?"}`,
        );
        if (ep.error) {
            lines.push(`  error: ${ep.error}`);
            continue;
        }
        const u = ep.usage || {};
        for (const name of ["rolling", "weekly", "monthly"]) {
            const win = u[name];
            if (!win) {
                continue;
            }
            const p = pct(win);
            const reset = win.resetsAt ? ` 重置 ${formatResetsAt(win.resetsAt)}` : "";
            lines.push(`  ${name}: ${p ?? "?"}%${reset}`);
        }
    }
    if (snapshot.at) {
        lines.push("");
        lines.push(`Updated: ${new Date(snapshot.at).toLocaleString()}`);
    }
    return lines.join("\n");
}

function applyStatusBarIcon(usage, openCodeAccountLabel, snapshot, hasError) {
    if (!statusBar) {
        return;
    }
    const nextLabel = formatStatusBarLabel(usage, hasError);
    const prevLabel = String(statusBar.text || "");
    const labelChanged = prevLabel !== nextLabel;
    // Silent fetch: no spinner. Only rewrite bar text when monthly% (or error) changed.
    if (labelChanged) {
        statusBar.text = nextLabel;
        logger_1.logger.info(
            `Status bar label ${prevLabel || "(empty)"} → ${nextLabel}`,
        );
    }
    statusBar.accessibilityInformation = {
        label: formatStatusA11y(usage, openCodeAccountLabel),
    };
    const tip = snapshot
        ? buildHoverMarkdown(snapshot)
        : "Unified Proxy — OpenCode Go 月额度；点击打开设置";
    statusBar.tooltip = tip;
    // hide/show only when visible text changes (refresh hover bubble without flicker otherwise)
    if (labelChanged) {
        statusBar.hide();
        statusBar.show();
    }
}

function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function emptyLocalUsage() {
    return {
        day: todayKey(),
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        byModel: {},
    };
}

function getLocalTokenUsage() {
    if (!extContext) {
        return emptyLocalUsage();
    }
    const raw = extContext.globalState.get(LOCAL_USAGE_KEY);
    if (!raw || typeof raw !== "object") {
        return emptyLocalUsage();
    }
    if (raw.day !== todayKey()) {
        return emptyLocalUsage();
    }
    return {
        day: raw.day,
        prompt_tokens: Number(raw.prompt_tokens) || 0,
        completion_tokens: Number(raw.completion_tokens) || 0,
        total_tokens: Number(raw.total_tokens) || 0,
        byModel: raw.byModel && typeof raw.byModel === "object" ? raw.byModel : {},
    };
}

function recordLocalTokenUsage(usage, modelId) {
    if (!extContext || !usage) {
        return;
    }
    const cur = getLocalTokenUsage();
    const prompt = Number(usage.prompt_tokens) || 0;
    const completion = Number(usage.completion_tokens) || 0;
    const total =
        Number(usage.total_tokens) || prompt + completion;
    cur.prompt_tokens += prompt;
    cur.completion_tokens += completion;
    cur.total_tokens += total;
    const mid = String(modelId || "unknown");
    if (!cur.byModel[mid]) {
        cur.byModel[mid] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    }
    cur.byModel[mid].prompt_tokens += prompt;
    cur.byModel[mid].completion_tokens += completion;
    cur.byModel[mid].total_tokens += total;
    void extContext.globalState.update(LOCAL_USAGE_KEY, cur);
}

/** True if proxy_configs has any OpenCode Go endpoint (for Cursor Agent / startup). */
function configHasOpenCodeGo() {
    try {
        const path = (0, proxy_config_loader_1.getProxyConfigPath)();
        if (!fs.existsSync(path)) {
            return false;
        }
        const cfg = JSON.parse(fs.readFileSync(path, "utf-8"));
        const config_v2_1 = require("./config_v2");
        return (0, config_v2_1.listProviderEntries)(cfg).some(([, p]) =>
            (0, opencode_headers_1.isOpenCodeGoEndpoint)(p?.base_url),
        );
    }
    catch {
        return false;
    }
}

function updateStatusBarVisibility(_hasOpenCode, _hasError) {
    if (!statusBar) {
        return;
    }
    const mode = getShowMode();
    if (mode === "off") {
        statusBar.hide();
        return;
    }
    if (mode === "always") {
        statusBar.show();
        return;
    }
    // auto:
    // - explicitly on a non-OC model (via our provider) → hide
    // - on OC chat → show
    // - no chat signal yet (Cursor Agent often never calls LM provider) but config has OC → show
    if (lastActiveChat && !lastActiveChat.isOpenCode) {
        statusBar.hide();
        return;
    }
    if (lastActiveChat?.isOpenCode || configHasOpenCodeGo()) {
        statusBar.show();
    }
    else {
        statusBar.hide();
    }
}

/**
 * @param {string} reason
 * @param {{ silent?: boolean }} [opts] silent=true: no spinner / flash (default for all auto refreshes)
 */
async function refreshQuota(reason, opts = {}) {
    const silent = opts.silent !== false; // default silent
    // After a non-OpenCode chat → hide. Otherwise show OC quota (startup / OC chat).
    if (lastActiveChat && !lastActiveChat.isOpenCode) {
        lastQuotaSnapshot = { at: Date.now(), endpoints: [] };
        updateStatusBarVisibility(false, false);
        logger_1.logger.info(
            `Usage refresh (${reason}): skip (active chat not OpenCode Go)`,
        );
        return lastQuotaSnapshot;
    }

    const endpoints = collectOpenCodeEndpoints();
    if (!endpoints.length) {
        lastQuotaSnapshot = { at: Date.now(), endpoints: [] };
        applyStatusBarIcon(null, "", lastQuotaSnapshot, true);
        // Still show while on OpenCode — do not hide just because usage fetch failed
        updateStatusBarVisibility(true, true);
        logger_1.logger.warn(
            `Usage refresh (${reason}): no endpoints (proxyKey=${lastActiveChat?.proxyKey || "?"})`,
        );
        return lastQuotaSnapshot;
    }

    const results = [];
    for (const ep of endpoints) {
        // Prefer go/status meters (console rounding). Fallback to floored /v1/usage.
        const idn = await fetchGoAccountIdentity(ep.apiKey, { bypassCache: true });
        let usage = idn.usage || null;
        let error = idn.error || "";
        let usageSource = usage ? "go/status-meters" : "";
        if (!usage) {
            const r = await fetchGoUsage(ep);
            usage = r.usage || null;
            error = r.error || error;
            usageSource = usage ? "v1/usage-floored" : "";
        }
        const openCodeAccountLabel = resolveAccountDisplayLabel(ep, idn);
        results.push({
            label: ep.label,
            proxyKey: ep.proxyKey,
            localAlias: ep.localAlias || "",
            accountId: ep.accountId,
            openCodeAccountId: idn.subscriberUserId || "",
            openCodeAccountLabel,
            openCodeProduct: idn.product || "",
            identityError: idn.error || "",
            usageSource,
            baseUrl: ep.baseUrl,
            usage,
            error: usage ? "" : error,
        });
        if (!usage && error) {
            logger_1.logger.warn(
                `Go usage fetch failed for ${ep.label}/${openCodeAccountLabel || "?"}: ${error}`,
            );
        }
        if (idn.error && !idn.subscriberUserId) {
            logger_1.logger.warn(
                `Go identity fetch failed for ${ep.label}: ${idn.error}`,
            );
        }
    }
    lastQuotaSnapshot = { at: Date.now(), endpoints: results };
    const primary = results.find((x) => x.usage && !x.error) || results[0];
    applyStatusBarIcon(
        primary?.usage,
        primary?.openCodeAccountLabel,
        lastQuotaSnapshot,
        Boolean(primary?.error && !primary?.usage),
    );
    updateStatusBarVisibility(true, Boolean(primary?.error));
    ocForwardsInWindow = 0;
    logger_1.logger.info(
        `Usage refresh (${reason}${silent ? ",silent" : ""}): ${results.length} endpoint(s), primary=${formatStatusText(primary?.usage, primary?.openCodeAccountLabel)} oc=${primary?.openCodeAccountId || "?"}`,
    );
    return lastQuotaSnapshot;
}

/** Every 5 minutes: refresh once only if OC Go forwards happened in the window. */
function scheduleQuotaWindow() {
    if (windowTimer) {
        clearInterval(windowTimer);
        windowTimer = null;
    }
    if (getShowMode() === "off") {
        return;
    }
    windowTimer = setInterval(() => {
        if (ocForwardsInWindow <= 0) {
            logger_1.logger.info(
                "Usage window tick: no OpenCode Go forwards — skip refresh",
            );
            return;
        }
        const n = ocForwardsInWindow;
        logger_1.logger.info(
            `Usage window tick: ${n} OpenCode Go forward(s) — silent refresh`,
        );
        void refreshQuota(`window-5m(${n})`, { silent: true });
    }, QUOTA_WINDOW_MS);
}

/**
 * Called after each upstream chat completion that reported usage (one API forward).
 * Only counts OpenCode Go forwards for the 5-minute window; does not refresh here.
 */
function notifyChatUsage(proxyKey, baseUrl) {
    if (proxyKey) {
        setActiveChatModel(proxyKey, baseUrl);
        lastOpenCodeActivityAt = Date.now();
        scheduleHideAfterOpenCodeIdle();
        try {
            const account_manager_1 = require("./account_manager");
            const { proxyKey: pk } = require("./proxy_config_loader").parseModelRef(proxyKey);
            account_manager_1.notifyAccountChatRequest(pk || proxyKey);
        }
        catch {
            /* optional */
        }
        try {
            const auto_assign_1 = require("./auto_assign");
            if (auto_assign_1.isAutoAssignModelId(proxyKey)) {
                auto_assign_1.notifyAutoAssignChatRequest();
            }
        }
        catch {
            /* optional */
        }
    }
    if (getShowMode() === "off") {
        return;
    }
    if (lastActiveChat && !lastActiveChat.isOpenCode) {
        updateStatusBarVisibility(false, false);
        return;
    }
    // Count only when active chat is OpenCode Go (setActiveChatModel just updated this)
    if (lastActiveChat?.isOpenCode) {
        ocForwardsInWindow += 1;
    }
}

async function showUsageDetail() {
    // Use last snapshot only — no forced refresh (policy: reload + 5m window only)
    const local = getLocalTokenUsage();
    const lines = [];
    lines.push("=== OpenCode Go quota ===");
    if (!lastQuotaSnapshot?.endpoints?.length) {
        lines.push("(no OpenCode Go base_url in proxy_configs.json)");
    }
    else {
        for (const ep of lastQuotaSnapshot.endpoints) {
            lines.push(`\n${ep.label}`);
            lines.push(`  ${ep.baseUrl}`);
            lines.push(
                `  OpenCode account: ${ep.openCodeAccountId || ep.openCodeAccountLabel || "?"}`,
            );
            if (ep.openCodeProduct) {
                lines.push(`  product: ${ep.openCodeProduct}`);
            }
            if (ep.localAlias) {
                lines.push(`  local alias: ${ep.localAlias}`);
            }
            if (ep.identityError) {
                lines.push(`  identity error: ${ep.identityError}`);
            }
            if (ep.error) {
                lines.push(`  ERROR: ${ep.error}`);
                continue;
            }
            const u = ep.usage || {};
            for (const name of ["rolling (5h)", "weekly", "monthly"]) {
                const key = name.startsWith("rolling") ? "rolling" : name;
                const win = u[key];
                if (!win) {
                    continue;
                }
                lines.push(
                    `  ${name}: ${pct(win) ?? "?"}%  status=${win.status || "?"}  重置=${formatResetsAt(win.resetsAt) || "?"}`,
                );
            }
        }
        if (lastQuotaSnapshot.at) {
            lines.push(`\nQuota fetched: ${new Date(lastQuotaSnapshot.at).toLocaleString()}`);
        }
    }
    lines.push("\n=== Local tokens today (this VS Code) ===");
    lines.push(`  day: ${local.day}`);
    lines.push(
        `  prompt=${local.prompt_tokens}  completion=${local.completion_tokens}  total=${local.total_tokens}`,
    );
    const models = Object.entries(local.byModel || {});
    if (models.length) {
        lines.push("  by model:");
        for (const [id, v] of models.sort((a, b) => (b[1].total_tokens || 0) - (a[1].total_tokens || 0))) {
            lines.push(
                `    ${id}: p=${v.prompt_tokens || 0} c=${v.completion_tokens || 0} t=${v.total_tokens || 0}`,
            );
        }
    }
    lines.push("\n(Quota % from GET /v1/usage; local totals from chat streams only.)");
    lines.push("(This document is a snapshot — re-run Show Usage or Refresh Usage to update.)");
    const doc = await vscode.workspace.openTextDocument({
        content: lines.join("\n"),
        language: "plaintext",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
}

/**
 * @param {vscode.ExtensionContext} context
 */
function startUsageMonitor(context) {
    extContext = context;
    // Right + low priority → sits near Copilot / notifications (higher = more left).
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1);
    statusBar.command = "unified-proxy-copilot.openSettingsFromStatusBar";
    statusBar.name = "Unified Proxy";
    statusBar.text = `${STATUS_ICON} …`;
    statusBar.tooltip = buildHoverMarkdown(null);
    context.subscriptions.push(statusBar);

    context.subscriptions.push(
        vscode.commands.registerCommand("unified-proxy-copilot.showUsage", () => showUsageDetail()),
        vscode.commands.registerCommand("unified-proxy-copilot.refreshUsage", async () => {
            // Kept for manual debug; still silent (no spinner).
            await refreshQuota("manual", { silent: true });
        }),
        vscode.commands.registerCommand(
            "unified-proxy-copilot.openSettingsFromStatusBar",
            async () => {
                const settings_panel_1 = require("./settings_panel");
                settings_panel_1.openSettingsPanel(extContext, {
                    proxyKey: lastActiveChat?.proxyKey,
                });
            },
        ),
        vscode.commands.registerCommand("unified-proxy-copilot.usageStatusMenu", async () => {
            const settings_panel_1 = require("./settings_panel");
            settings_panel_1.openSettingsPanel(extContext, {
                proxyKey: lastActiveChat?.proxyKey,
            });
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(`${CONFIG_SECTION}.showUsageStatusBar`)) {
                scheduleQuotaWindow();
                updateStatusBarVisibility(
                    getShowMode() === "always" ||
                        (getShowMode() === "auto" && Boolean(lastActiveChat?.isOpenCode)),
                    false,
                );
            }
        }),
    );

    context.subscriptions.push({
        dispose: () => {
            if (windowTimer) {
                clearInterval(windowTimer);
                windowTimer = null;
            }
        },
    });

    scheduleQuotaWindow();
    context.subscriptions.push({
        dispose: () => clearHideAfterIdleTimer(),
    });

    // Reload/activate: one silent fetch, counter cleared inside refreshQuota.
    ocForwardsInWindow = 0;
    void refreshQuota("activate", { silent: true }).then(() => {
        logger_1.logger.info(
            `Usage monitor ready; statusBar=${statusBar ? "ok" : "null"} mode=${getShowMode()} window=5m`,
        );
    });

    return {
        refresh: () => refreshQuota("external", { silent: true }),
        onConfigReloaded: () => {
            ocForwardsInWindow = 0;
            scheduleQuotaWindow();
            void refreshQuota("reload-config", { silent: true });
        },
    };
}
