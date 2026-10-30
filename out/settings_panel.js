"use strict";
/**
 * Unified Proxy 「设置」面板
 * — 绑定当前聊天模型（无模型下拉）
 * — 账号：手动 / 按时间轮换 / 按请求次数轮换
 * — 思考模式、上下文、温度
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSettingsPanel = openSettingsPanel;
exports.registerSettingsCommands = registerSettingsCommands;

const vscode = require("vscode");
const fs = require("fs");
const proxy_config_loader_1 = require("./proxy_config_loader");
const account_manager_1 = require("./account_manager");
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
        "设置",
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
            if (msg?.type === "ready" || msg?.type === "reload") {
                await postState(panel.webview, opts.proxyKey);
                return;
            }
            if (msg?.type === "switchAccount") {
                // Instant apply — no「保存」needed for current-account dropdown
                const proxyKey =
                    String(msg.proxyKey || "").trim() ||
                    resolveCurrentProxyKey(opts.proxyKey);
                const accountId = String(msg.accountId || "").trim();
                const ok =
                    Boolean(proxyKey) &&
                    Boolean(accountId) &&
                    account_manager_1.setActiveAccountId(
                        proxyKey,
                        accountId,
                        "settings-panel-instant",
                    );
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
            if (msg?.type === "save") {
                const result = await saveSettings(msg.payload || {});
                panel.webview.postMessage({ type: "saved", ok: result.ok, error: result.error });
                if (result.ok) {
                    onSaved?.();
                    void vscode.window.showInformationMessage(
                        `设置已保存：${result.name || result.proxyKey}`,
                    );
                    await postState(panel.webview, result.proxyKey);
                }
            }
        }
        catch (e) {
            logger_1.logger.warn("Settings panel message failed", e);
            panel?.webview.postMessage({
                type: "saved",
                ok: false,
                error: e?.message || String(e),
            });
        }
    });
    return panel;
}

/** Resolve which proxy entry the settings panel edits (= current chat model). */
function resolveCurrentProxyKey(hint) {
    if (hint) {
        const { proxyKey } = proxy_config_loader_1.parseModelRef(hint);
        if (proxyKey) {
            return proxyKey;
        }
    }
    try {
        const usage_monitor_1 = require("./usage_monitor");
        const last = usage_monitor_1.getLastActiveChat?.();
        if (last?.proxyKey) {
            return proxy_config_loader_1.parseModelRef(last.proxyKey).proxyKey;
        }
    }
    catch {
        /* optional */
    }
    const multi = account_manager_1.listMultiAccountProxies();
    if (multi.length) {
        return multi[0].proxyKey;
    }
    const models = loadModelList();
    return models[0]?.key || "";
}

function loadModelList() {
    const path = proxy_config_loader_1.getProxyConfigPath();
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
    return Object.entries(cfg.proxies || {}).map(([key, proxy]) => ({
        key,
        name: String(proxy?.name || key),
        baseUrl: String(proxy?.base_url || ""),
        modelId: String(proxy?.model_id || ""),
    }));
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

/**
 * Build hover text: upstream /models limit + config + OpenCode Go usage.
 * @param {string} proxyKey
 * @param {object|null} proxy
 */
async function buildModelLimitTip(proxyKey, proxy) {
    const lines = [];
    if (!proxy) {
        return "未选中模型，无 limit 信息";
    }
    const modelId = String(proxy.model_id || "").trim();
    const baseUrl = String(proxy.base_url || "").trim().replace(/\/$/, "");
    const contextRaw = proxy.context_window_size ?? proxy.contextWindowSize;
    const maxOut = proxy.max_output_tokens ?? proxy.maxOutputTokens;
    const resolved = account_manager_1.resolveApiKeyForProxy(proxyKey, proxy);

    lines.push(`模型 ${modelId || "—"}`);

    // Upstream /v1/models limit.*
    if (baseUrl && resolved.apiKey && modelId) {
        try {
            const upstream_model_limits_1 = require("./upstream_model_limits");
            const headers = upstream_model_limits_1.buildListHeaders(
                baseUrl,
                proxy.custom_headers || proxy.customHeaders || null,
                proxy.opencode_session || proxy.openCodeSession || "",
            );
            const catalog = await upstream_model_limits_1.fetchUpstreamModelLimits(
                baseUrl,
                resolved.apiKey,
                headers,
            );
            const meta = catalog.get(modelId);
            if (meta && (meta.context || meta.output)) {
                lines.push("上游 limit（GET /models）");
                if (meta.context) {
                    lines.push(`  context: ${formatNum(meta.context)}`);
                }
                if (meta.output) {
                    lines.push(`  output: ${formatNum(meta.output)}`);
                }
                if (meta.supportsTools !== undefined) {
                    lines.push(`  tools: ${meta.supportsTools ? "是" : "否"}`);
                }
                if (meta.supportsNativeVision !== undefined) {
                    lines.push(`  vision: ${meta.supportsNativeVision ? "是" : "否"}`);
                }
                if (meta.supportsThinking !== undefined) {
                    lines.push(`  thinking: ${meta.supportsThinking ? "是" : "否"}`);
                }
            }
            else {
                lines.push("上游 limit：目录中无此 model_id");
            }
        }
        catch (e) {
            lines.push(`上游 limit：查询失败（${e?.message || e}）`);
        }
    }
    else {
        lines.push("上游 limit：缺少 base_url / api_key / model_id");
    }

    lines.push("本地配置");
    const ctxShow =
        contextRaw === "" || contextRaw === undefined || contextRaw === null || Number(contextRaw) === 0
            ? "自动"
            : formatNum(contextRaw);
    const outShow =
        maxOut === "" || maxOut === undefined || maxOut === null || Number(maxOut) === 0
            ? "自动"
            : formatNum(maxOut);
    lines.push(`  上下文: ${ctxShow}`);
    lines.push(`  最大输出: ${outShow}`);

    // OpenCode Go quota (refresh lightly)
    try {
        const usage_monitor_1 = require("./usage_monitor");
        await usage_monitor_1.refreshUsageQuota("settings-panel");
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
            if (snap.at) {
                lines.push(`更新于 ${new Date(snap.at).toLocaleString()}`);
            }
        }
        else if (ep?.error) {
            lines.push(`OpenCode Go 用量：${ep.error}`);
        }
    }
    catch (e) {
        lines.push(`OpenCode Go 用量：${e?.message || e}`);
    }

    return lines.join("\n");
}

async function postState(webview, proxyKeyHint) {
    const path = proxy_config_loader_1.getProxyConfigPath();
    const proxyKey = resolveCurrentProxyKey(proxyKeyHint);
    let proxy = null;
    if (fs.existsSync(path)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(path, "utf-8"));
            proxy = cfg.proxies?.[proxyKey] || null;
        }
        catch {
            proxy = null;
        }
    }
    const parsed = account_manager_1.parseAccountsFromProxy(proxy || {}, proxyKey);
    const active = account_manager_1.getActiveAccount(proxyKey);
    const thinking = thinkingValueFromProxy(proxy);
    const contextRaw = proxy?.context_window_size ?? proxy?.contextWindowSize ?? "";
    const tempRaw = proxy?.temperature;
    const maxOut = proxy?.max_output_tokens ?? proxy?.maxOutputTokens ?? "";
    const limitTip = await buildModelLimitTip(proxyKey, proxy);
    webview.postMessage({
        type: "state",
        configPath: path,
        proxyKey,
        form: {
            name: proxy?.name || proxyKey || "(未选中模型)",
            baseUrl: proxy?.base_url || "",
            modelId: proxy?.model_id || "",
            hasProxy: Boolean(proxy),
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
        },
    });
}

async function saveSettings(payload) {
    const proxyKey = String(payload.proxyKey || "").trim();
    if (!proxyKey) {
        return { ok: false, error: "当前没有可设置的模型（请先在 Copilot 选一个 Unified Proxy 模型并对话一次）" };
    }
    const path = proxy_config_loader_1.getProxyConfigPath();
    if (!fs.existsSync(path)) {
        return { ok: false, error: `找不到配置文件: ${path}` };
    }
    let cfg;
    try {
        cfg = JSON.parse(fs.readFileSync(path, "utf-8"));
    }
    catch (e) {
        return { ok: false, error: `配置解析失败: ${e.message}` };
    }
    const proxy = cfg.proxies?.[proxyKey];
    if (!proxy || typeof proxy !== "object") {
        return { ok: false, error: `配置中无此模型: ${proxyKey}` };
    }

    const thinking = String(payload.thinking || "high");
    proxy.thinking_mode = THINKING_TO_CONFIG[thinking] || "标准";

    // 0 / empty → auto (omit or write 0 so parse* treats as fromConfig=false)
    if (payload.contextWindow !== undefined) {
        const raw = String(payload.contextWindow).trim();
        if (raw === "" || raw === "0") {
            proxy.context_window_size = 0;
        }
        else {
            const n = Number(raw.replace(/,/g, ""));
            if (Number.isFinite(n) && n > 0) {
                proxy.context_window_size = Math.floor(n);
            }
            else {
                proxy.context_window_size = raw;
            }
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
            // 0 = auto → remove forced temperature
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

    // Account switch mode
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
    const rotateMinutes = Math.max(
        1,
        Math.min(1440, Math.floor(Number(payload.rotateMinutes) || 5)),
    );
    const rotateEveryN = Math.max(
        1,
        Math.min(500, Math.floor(Number(payload.rotateEveryNRequests) || 10)),
    );
    proxy.account_switch = {
        mode: accountMode,
        rotate_minutes: rotateMinutes,
        rotate_every_n_requests: rotateEveryN,
    };

    fs.writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");

    if (accountMode === "manual") {
        const accountId = String(payload.accountId || "").trim();
        if (accountId) {
            account_manager_1.setActiveAccountId(proxyKey, accountId, "settings-panel");
        }
    }

    account_manager_1.rescheduleAllRotators?.();
    // ensure export - call via require if needed
    try {
        require("./account_manager").rescheduleAllRotators();
    }
    catch {
        /* */
    }

    logger_1.logger.info(
        `Settings saved ${proxyKey}: accountMode=${accountMode} thinking=${proxy.thinking_mode}`,
    );
    return { ok: true, proxyKey, name: proxy.name || proxyKey };
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
    margin: 0; padding: 14px 18px 24px; line-height: 1.4;
  }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 10px; }
  /* Do NOT set opacity on h2 — it makes nested .tip translucent and text stacks. */
  h2 { font-size: 0.95rem; font-weight: 600; margin: 0 0 8px; color: var(--vscode-foreground); }
  .sub { color: var(--vscode-descriptionForeground); margin-bottom: 10px; font-size: 0.88em; }
  .card {
    border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #4444));
    border-radius: 8px; padding: 12px 14px; margin-bottom: 12px;
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    overflow: visible; position: relative;
  }
  .card:has(.lbl:hover), .card:has(.lbl:focus-within) { z-index: 40; }
  .row {
    display: grid; grid-template-columns: minmax(120px, 150px) 1fr; gap: 6px 12px;
    align-items: center; margin-bottom: 8px;
  }
  .lbl {
    position: relative; display: inline-flex; align-items: center; gap: 6px;
    cursor: default; user-select: none; width: fit-content; max-width: 100%;
    z-index: 1;
  }
  .lbl:hover, .lbl:focus-within { z-index: 50; }
  .lbl .name { line-height: 1.2; }
  .help {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
    border: 1.5px solid var(--vscode-descriptionForeground);
    color: var(--vscode-descriptionForeground);
    font-size: 10px; font-weight: 700; line-height: 1;
  }
  .tip {
    display: none; position: absolute; left: calc(100% + 10px); top: 0;
    z-index: 1000; min-width: 200px; max-width: 340px; padding: 10px 12px;
    /* Solid opaque fill — hoverWidget vars can be translucent in some themes */
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-widget-border, #555));
    border-radius: 6px; font-size: 12px; font-weight: 400; line-height: 1.45;
    white-space: normal;
    box-shadow: 0 6px 18px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.2);
    pointer-events: none;
  }
  .lbl:hover .tip, .lbl:focus-within .tip { display: block; }
  .tip.pre { white-space: pre-line; max-width: min(380px, 58vw); min-width: 240px; }
  select, input {
    width: 100%; box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px; padding: 5px 8px; font: inherit;
  }
  select:disabled, input:disabled { opacity: 0.55; cursor: not-allowed; }
  .mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.88em; opacity: 0.85; word-break: break-all; }
  .actions { display: flex; gap: 10px; margin-top: 10px; }
  button { font: inherit; border-radius: 4px; border: 1px solid transparent; padding: 6px 14px; cursor: pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .status { margin-top: 10px; min-height: 1.2em; color: var(--vscode-descriptionForeground); }
  .status.err { color: var(--vscode-errorForeground); }
  .status.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .hidden { display: none !important; }
  .model-title { font-weight: 600; margin-bottom: 2px; }
</style>
</head>
<body>
  <h1>
    <span class="lbl">设置
      <span class="help" aria-hidden="true">!</span>
      <span class="tip">针对当前 Copilot 选中的模型；请先在聊天里选好 Unified Proxy 模型再打开本页</span>
    </span>
  </h1>

  <div class="card">
    <h2>
      <span class="lbl">
        <span class="name">当前模型</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip pre" id="modelLimitTip">加载 limit 信息…</span>
      </span>
    </h2>
    <div class="model-title" id="modelName">—</div>
    <div class="mono sub" id="modelMeta" style="margin-bottom:0"></div>
    <input type="hidden" id="proxyKey" />
  </div>

  <div class="card" id="accountCard">
    <h2>账号切换</h2>
    <div class="row">
      <label class="lbl" for="accountMode">
        <span class="name">切换方式</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">开启自动轮换后，下方账号选择会禁用（由插件自动切换 API Key）。切换方式与轮换参数需点「保存」写入配置</span>
      </label>
      <select id="accountMode">
        <option value="manual">手动选择</option>
        <option value="rotate">自动轮换 · 按时间</option>
        <option value="rotate_requests">自动轮换 · 按请求次数</option>
      </select>
    </div>

    <div class="row" id="accountRow">
      <label class="lbl" for="account">
        <span class="name">当前账号</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">切换后立即生效，无需点「保存」；状态栏用量会跟着刷新</span>
      </label>
      <select id="account"></select>
    </div>

    <div class="row hidden" id="rotateMinRow">
      <label class="lbl" for="rotateMinutes">
        <span class="name">轮换间隔</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">单位：分钟。例如 5 = 每 5 分钟换下一个账号（需点保存）</span>
      </label>
      <input id="rotateMinutes" type="number" min="1" max="1440" step="1" placeholder="5" />
    </div>

    <div class="row hidden" id="rotateReqRow">
      <label class="lbl" for="rotateEveryN">
        <span class="name">每 N 次请求</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">累计 N 次聊天 API 调用后切换到下一个账号（需点保存）</span>
      </label>
      <input id="rotateEveryN" type="number" min="1" max="500" step="1" placeholder="10" />
    </div>
  </div>

  <div class="card">
    <h2>模型参数</h2>
    <div class="row">
      <label class="lbl" for="thinking">
        <span class="name">思考模式</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">写入配置默认档；聊天里 Copilot「标准 · Max …」仍可临时覆盖</span>
      </label>
      <select id="thinking">
        <option value="none">停用</option>
        <option value="low">轻量</option>
        <option value="high">标准</option>
        <option value="max">深度</option>
      </select>
    </div>

    <div class="row">
      <label class="lbl" for="context">
        <span class="name">上下文大小</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">0 = 自动（按上游模型参数）；也可填 1000000 / 1M</span>
      </label>
      <input id="context" placeholder="0 = 自动" />
    </div>
    <div class="row">
      <label class="lbl" for="maxOut">
        <span class="name">最大输出</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">0 = 自动（按上游模型参数）</span>
      </label>
      <input id="maxOut" placeholder="0 = 自动" />
    </div>
    <div class="row">
      <label class="lbl" for="temperature">
        <span class="name">温度</span>
        <span class="help" aria-hidden="true">!</span>
        <span class="tip">0 = 自动（用扩展默认温度）；大于 0 时写入配置</span>
      </label>
      <input id="temperature" type="number" min="0" max="2" step="0.1" placeholder="0 = 自动" />
    </div>

    <div class="actions">
      <button class="primary" id="save">保存</button>
      <button class="secondary" id="reload">重新加载</button>
    </div>
    <div class="status" id="status"></div>
  </div>

  <div class="sub mono" id="configPath"></div>

<script>
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const els = {
    modelName: $('modelName'), modelMeta: $('modelMeta'), modelLimitTip: $('modelLimitTip'), proxyKey: $('proxyKey'),
    accountCard: $('accountCard'), accountMode: $('accountMode'), account: $('account'), accountRow: $('accountRow'),
    rotateMinRow: $('rotateMinRow'), rotateMinutes: $('rotateMinutes'),
    rotateReqRow: $('rotateReqRow'), rotateEveryN: $('rotateEveryN'),
    thinking: $('thinking'), context: $('context'), temperature: $('temperature'), maxOut: $('maxOut'),
    save: $('save'), reload: $('reload'), status: $('status'), configPath: $('configPath'),
  };

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function syncAccountModeUi() {
    const mode = els.accountMode.value;
    const auto = mode === 'rotate' || mode === 'rotate_requests';
    els.account.disabled = auto;
    els.rotateMinRow.classList.toggle('hidden', mode !== 'rotate');
    els.rotateReqRow.classList.toggle('hidden', mode !== 'rotate_requests');
  }

  function applyState(msg) {
    const form = msg.form || {};
    els.proxyKey.value = msg.proxyKey || '';
    els.modelName.textContent = form.name || '—';
    els.modelMeta.textContent = (form.baseUrl || '') + (form.modelId ? '  ·  ' + form.modelId : '');
    els.modelLimitTip.textContent = form.limitTip || '暂无 limit 信息';
    els.configPath.textContent = msg.configPath || '';

    const accounts = form.accounts || [];
    if (accounts.length > 1) {
      els.accountCard.classList.remove('hidden');
      els.account.innerHTML = accounts.map(a =>
        '<option value="' + esc(a.id) + '"' + (a.id === form.accountId ? ' selected' : '') + '>' +
        esc(a.name) + '  (' + esc(a.key) + ')</option>'
      ).join('');
      els.accountMode.value = form.accountMode || 'manual';
      els.rotateMinutes.value = form.rotateMinutes != null ? form.rotateMinutes : 5;
      els.rotateEveryN.value = form.rotateEveryNRequests != null ? form.rotateEveryNRequests : 10;
      syncAccountModeUi();
    } else {
      els.accountCard.classList.add('hidden');
    }

    els.thinking.value = form.thinking || 'high';
    els.context.value = form.contextWindow === '' || form.contextWindow == null ? '0' : form.contextWindow;
    els.maxOut.value = form.maxOutputTokens === '' || form.maxOutputTokens == null ? '0' : form.maxOutputTokens;
    els.temperature.value = form.temperature === '' || form.temperature == null ? '0' : form.temperature;
    setStatus(form.hasProxy ? '' : '未找到当前模型配置：请先在 Copilot 选择 Unified Proxy 模型并发送一条消息', form.hasProxy ? '' : 'err');
  }

  els.accountMode.addEventListener('change', syncAccountModeUi);
  els.account.addEventListener('change', () => {
    const id = els.account.value || '';
    if (!id || els.account.disabled) return;
    setStatus('正在切换账号…');
    vscode.postMessage({
      type: 'switchAccount',
      proxyKey: els.proxyKey.value,
      accountId: id,
    });
  });
  els.save.addEventListener('click', () => {
    setStatus('保存中…');
    vscode.postMessage({
      type: 'save',
      payload: {
        proxyKey: els.proxyKey.value,
        accountId: els.account.value || '',
        accountMode: els.accountMode.value,
        rotateMinutes: els.rotateMinutes.value,
        rotateEveryNRequests: els.rotateEveryN.value,
        thinking: els.thinking.value,
        contextWindow: els.context.value,
        temperature: els.temperature.value,
        maxOutputTokens: els.maxOut.value,
      }
    });
  });
  els.reload.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
  window.addEventListener('message', (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'state') applyState(msg);
    if (msg.type === 'saved') setStatus(msg.ok ? '已保存' : ('保存失败：' + (msg.error || '')), msg.ok ? 'ok' : 'err');
    if (msg.type === 'accountSwitched') {
      setStatus(msg.ok ? '账号已切换（立即生效）' : ('切换失败：' + (msg.error || '')), msg.ok ? 'ok' : 'err');
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
