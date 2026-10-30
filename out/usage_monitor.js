"use strict";
/**
 * OpenCode Go quota status bar + local token totals.
 * Quota: GET {base}/usage (e.g. https://opencode.ai/zen/go/v1/usage)
 * Local totals: accumulated from chat stream usage (globalState only).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startUsageMonitor = startUsageMonitor;
exports.recordLocalTokenUsage = recordLocalTokenUsage;
exports.getLocalTokenUsage = getLocalTokenUsage;
exports.notifyChatUsage = notifyChatUsage;

const vscode = require("vscode");
const fs = require("fs");
const opencode_headers_1 = require("./opencode_headers");
const proxy_config_loader_1 = require("./proxy_config_loader");
const logger_1 = require("./logger");
const no_proxy_1 = require("./no_proxy");

const CONFIG_SECTION = "unified-proxy-copilot";
const LOCAL_USAGE_KEY = "unified-proxy-copilot.localTokenUsage";
/** 0 = disable time-based poll (preferred; refresh is request-driven). */
const DEFAULT_POLL_MINUTES = 0;
/** After a burst of tool/API rounds goes quiet, treat as end of a "big" turn. */
const IDLE_REFRESH_MS = 1200;
const FETCH_TIMEOUT_MS = 15000;

/** @type {vscode.ExtensionContext|null} */
let extContext = null;
/** @type {vscode.StatusBarItem|null} */
let statusBar = null;
/** @type {NodeJS.Timeout|null} */
let pollTimer = null;
/** @type {NodeJS.Timeout|null} */
let chatRefreshTimer = null;
/** API chat completions with usage since last successful quota refresh. */
let forwardsSinceRefresh = 0;
/** @type {{ at: number, endpoints: Array<{ label: string, baseUrl: string, usage: any, error?: string }> }|null} */
let lastQuotaSnapshot = null;

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

/** @returns {number} ms, or 0 to disable interval poll */
function getPollMs() {
    const n = Number(
        vscode.workspace.getConfiguration(CONFIG_SECTION).get("usagePollMinutes") ??
            DEFAULT_POLL_MINUTES,
    );
    if (!Number.isFinite(n) || n <= 0) {
        return 0;
    }
    return Math.max(1, Math.min(180, Math.floor(n))) * 60 * 1000;
}

/** Refresh immediately once this many chat API usage events accumulate. */
function getRefreshEveryN() {
    const n = Number(
        vscode.workspace.getConfiguration(CONFIG_SECTION).get("usageRefreshEveryNRequests") ?? 3,
    );
    if (!Number.isFinite(n) || n <= 0) {
        return 3;
    }
    return Math.max(1, Math.min(50, Math.floor(n)));
}

/**
 * Unique OpenCode Go endpoints from proxy_configs.json (dedupe by api_key + origin).
 * @returns {Array<{ label: string, baseUrl: string, apiKey: string, openCodeSession: string, customHeaders: object|null }>}
 */
function collectOpenCodeEndpoints() {
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
    const seen = new Set();
    const out = [];
    for (const [key, proxy] of Object.entries(cfg.proxies || {})) {
        const baseUrl = proxy?.base_url;
        const apiKey = proxy?.api_key;
        if (!baseUrl || !apiKey) {
            continue;
        }
        if (!(0, opencode_headers_1.isOpenCodeGoEndpoint)(baseUrl)) {
            continue;
        }
        const dedupe = `${String(apiKey).slice(0, 40)}|${String(baseUrl).replace(/\/$/, "")}`;
        if (seen.has(dedupe)) {
            continue;
        }
        seen.add(dedupe);
        out.push({
            label: proxy.name || key,
            baseUrl: String(baseUrl).replace(/\/$/, ""),
            apiKey: String(apiKey),
            openCodeSession: String(proxy.opencode_session || proxy.openCodeSession || ""),
            customHeaders: proxy.custom_headers || proxy.customHeaders || null,
        });
    }
    return out;
}

function usageUrl(baseUrl) {
    // base is .../v1 → .../v1/usage
    return `${String(baseUrl).replace(/\/$/, "")}/usage`;
}

/**
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

function formatStatusText(usage) {
    if (!usage || typeof usage !== "object") {
        return "$(pulse) Go ?";
    }
    const m = pct(usage.monthly);
    const w = pct(usage.weekly);
    const r = pct(usage.rolling);
    const parts = [];
    if (m !== null) {
        parts.push(`月${m}%`);
    }
    if (w !== null) {
        parts.push(`周${w}%`);
    }
    if (r !== null) {
        parts.push(`5h${r}%`);
    }
    return parts.length ? `$(dashboard) Go ${parts.join(" · ")}` : "$(dashboard) Go";
}

function formatTooltip(snapshot) {
    const lines = ["Unified Proxy — OpenCode Go usage"];
    if (!snapshot?.endpoints?.length) {
        lines.push("No OpenCode Go endpoints in proxy_configs.json");
        return lines.join("\n");
    }
    for (const ep of snapshot.endpoints) {
        lines.push("");
        lines.push(`${ep.label} (${ep.baseUrl})`);
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
            const reset = win.resetsAt ? ` reset ${win.resetsAt}` : "";
            const st = win.status ? ` [${win.status}]` : "";
            lines.push(`  ${name}: ${p ?? "?"}%${st}${reset}`);
        }
    }
    if (snapshot.at) {
        lines.push("");
        lines.push(`Updated: ${new Date(snapshot.at).toLocaleString()}`);
    }
    const pollMs = getPollMs();
    const everyN = getRefreshEveryN();
    if (pollMs > 0) {
        lines.push(`Backup poll: every ${Math.round(pollMs / 60000)} min`);
    }
    else {
        lines.push("Backup poll: off (request-driven)");
    }
    lines.push(
        `Auto-refresh: after conversation idle (~${IDLE_REFRESH_MS}ms) · every ${everyN} API usage events · on focus`,
    );
    lines.push(`Pending API events since last refresh: ${forwardsSinceRefresh}`);
    lines.push("Click: Show Usage · Command: Refresh Usage");
    return lines.join("\n");
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

function updateStatusBarVisibility(hasOpenCode, hasError) {
    if (!statusBar) {
        return;
    }
    const mode = getShowMode();
    if (mode === "off") {
        statusBar.hide();
        return;
    }
    if (mode === "always" || hasOpenCode || hasError) {
        statusBar.show();
    }
    else {
        statusBar.hide();
    }
}

async function refreshQuota(reason) {
    const endpoints = collectOpenCodeEndpoints();
    if (!endpoints.length) {
        lastQuotaSnapshot = { at: Date.now(), endpoints: [] };
        if (statusBar) {
            statusBar.text = "$(dashboard) Go —";
            statusBar.tooltip = formatTooltip(lastQuotaSnapshot);
        }
        updateStatusBarVisibility(false, false);
        logger_1.logger.info(`Usage refresh (${reason}): no OpenCode Go endpoints`);
        return lastQuotaSnapshot;
    }

    const results = [];
    for (const ep of endpoints) {
        const r = await fetchGoUsage(ep);
        results.push({
            label: ep.label,
            baseUrl: ep.baseUrl,
            usage: r.usage,
            error: r.error,
        });
        if (r.error) {
            logger_1.logger.warn(`Go usage fetch failed for ${ep.label}: ${r.error}`);
        }
    }
    lastQuotaSnapshot = { at: Date.now(), endpoints: results };
    const primary = results.find((x) => x.usage && !x.error) || results[0];
    if (statusBar) {
        if (primary?.error && !primary.usage) {
            statusBar.text = "$(warning) Go usage err";
        }
        else {
            statusBar.text = formatStatusText(primary?.usage);
        }
        statusBar.tooltip = formatTooltip(lastQuotaSnapshot);
    }
    updateStatusBarVisibility(true, Boolean(primary?.error));
    if (!primary?.error || primary?.usage) {
        forwardsSinceRefresh = 0;
    }
    if (statusBar && lastQuotaSnapshot) {
        statusBar.tooltip = formatTooltip(lastQuotaSnapshot);
    }
    logger_1.logger.info(
        `Usage refresh (${reason}): ${results.length} endpoint(s), primary=${formatStatusText(primary?.usage)}`,
    );
    return lastQuotaSnapshot;
}

function schedulePoll() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (getShowMode() === "off") {
        return;
    }
    const ms = getPollMs();
    if (ms <= 0) {
        return;
    }
    pollTimer = setInterval(() => {
        void refreshQuota("poll");
    }, ms);
}

/**
 * Called after each upstream chat completion that reported usage (one API forward).
 * - Idle debounce ≈ end of a multi-tool "big" turn → refresh once
 * - Every N usage events → refresh immediately (mid-turn safety)
 */
function notifyChatUsage() {
    if (getShowMode() === "off") {
        return;
    }
    forwardsSinceRefresh += 1;
    const everyN = getRefreshEveryN();
    if (forwardsSinceRefresh >= everyN) {
        if (chatRefreshTimer) {
            clearTimeout(chatRefreshTimer);
            chatRefreshTimer = null;
        }
        void refreshQuota(`every-${everyN}-requests`);
        return;
    }
    if (chatRefreshTimer) {
        clearTimeout(chatRefreshTimer);
    }
    // Quiet period after last API ≈ end of agent turn / "大对话"
    chatRefreshTimer = setTimeout(() => {
        chatRefreshTimer = null;
        void refreshQuota("after-conversation-idle");
    }, IDLE_REFRESH_MS);
}

async function showUsageDetail() {
    await refreshQuota("show-command");
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
                    `  ${name}: ${pct(win) ?? "?"}%  status=${win.status || "?"}  resetsAt=${win.resetsAt || "?"}`,
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
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = "unified-proxy-copilot.showUsage";
    statusBar.name = "Unified Proxy Go Usage";
    statusBar.text = "$(dashboard) Go …";
    statusBar.tooltip = "Unified Proxy OpenCode usage";
    context.subscriptions.push(statusBar);

    context.subscriptions.push(
        vscode.commands.registerCommand("unified-proxy-copilot.showUsage", () => showUsageDetail()),
        vscode.commands.registerCommand("unified-proxy-copilot.refreshUsage", async () => {
            await refreshQuota("manual");
            void vscode.window.showInformationMessage("Unified Proxy: usage refreshed");
        }),
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (
                e.affectsConfiguration(`${CONFIG_SECTION}.showUsageStatusBar`) ||
                e.affectsConfiguration(`${CONFIG_SECTION}.usagePollMinutes`) ||
                e.affectsConfiguration(`${CONFIG_SECTION}.usageRefreshEveryNRequests`)
            ) {
                schedulePoll();
                void refreshQuota("config-change");
            }
        }),
        vscode.window.onDidChangeWindowState((state) => {
            // Optional catch-up when returning to the window (not the primary trigger).
            if (state.focused && getShowMode() !== "off" && forwardsSinceRefresh > 0) {
                void refreshQuota("window-focus");
            }
        }),
    );

    context.subscriptions.push({
        dispose: () => {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            if (chatRefreshTimer) {
                clearTimeout(chatRefreshTimer);
                chatRefreshTimer = null;
            }
        },
    });

    schedulePoll();
    void refreshQuota("activate");

    return {
        refresh: () => refreshQuota("external"),
        onConfigReloaded: () => {
            schedulePoll();
            void refreshQuota("reload-config");
        },
    };
}
