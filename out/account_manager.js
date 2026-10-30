"use strict";
/**
 * Multi-account (multi API key) per proxy entry.
 * Active selection stored in globalState only — never written back to proxy_configs.json.
 *
 * Config (optional):
 *   "accounts": [ { "id": "main", "name": "主号", "api_key": "oc_sk_..." }, ... ]
 *   "account_switch": { "mode": "manual"|"rotate", "rotate_minutes": 5 }
 * Legacy: single "api_key" → one account.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAccountManager = initAccountManager;
exports.parseAccountsFromProxy = parseAccountsFromProxy;
exports.getActiveAccount = getActiveAccount;
exports.setActiveAccountId = setActiveAccountId;
exports.listMultiAccountProxies = listMultiAccountProxies;
exports.resolveApiKeyForProxy = resolveApiKeyForProxy;
exports.maskApiKey = maskApiKey;
exports.pickAndSwitchAccount = pickAndSwitchAccount;
exports.getAccountSwitchMode = getAccountSwitchMode;

const vscode = require("vscode");
const fs = require("fs");
const proxy_config_loader_1 = require("./proxy_config_loader");
const logger_1 = require("./logger");

const CONFIG_SECTION = "unified-proxy-copilot";
const ACTIVE_KEY = "unified-proxy-copilot.activeAccounts";
/** @type {vscode.ExtensionContext|null} */
let extContext = null;
/** @type {Map<string, NodeJS.Timeout>} proxyKey -> rotate timer */
const rotateTimers = new Map();
/** @type {(() => void)|null} */
let onAccountChanged = null;

function initAccountManager(context, hooks) {
    extContext = context;
    onAccountChanged = hooks?.onAccountChanged || null;
    context.subscriptions.push({
        dispose: () => {
            for (const t of rotateTimers.values()) {
                clearInterval(t);
            }
            rotateTimers.clear();
        },
    });
    context.subscriptions.push(
        vscode.commands.registerCommand("unified-proxy-copilot.switchAccount", () =>
            pickAndSwitchAccount(),
        ),
    );
    rescheduleAllRotators();
    return {
        rescheduleAllRotators,
        getActiveAccount,
    };
}

function maskApiKey(key) {
    const s = String(key || "");
    if (s.length <= 10) {
        return s ? "***" : "";
    }
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

/**
 * @param {object} proxy
 * @param {string} proxyKey
 * @returns {{ accounts: Array<{id:string,name:string,api_key:string}>, mode: 'manual'|'rotate', rotateMinutes: number }}
 */
function parseAccountsFromProxy(proxy, proxyKey) {
    const switchCfg =
        proxy?.account_switch || proxy?.accountSwitch || proxy?.api_key_switch || {};
    let mode = String(switchCfg.mode || switchCfg.Mode || "manual")
        .trim()
        .toLowerCase();
    if (mode === "auto" || mode === "rotate" || mode === "rotation") {
        mode = "rotate";
    }
    else {
        mode = "manual";
    }
    let rotateMinutes = Number(switchCfg.rotate_minutes ?? switchCfg.rotateMinutes ?? 5);
    if (!Number.isFinite(rotateMinutes) || rotateMinutes <= 0) {
        rotateMinutes = 5;
    }
    rotateMinutes = Math.max(1, Math.min(1440, Math.floor(rotateMinutes)));

    const rawList = proxy?.accounts || proxy?.api_keys || proxy?.apiKeys;
    /** @type {Array<{id:string,name:string,api_key:string}>} */
    const accounts = [];
    if (Array.isArray(rawList) && rawList.length) {
        rawList.forEach((item, i) => {
            if (typeof item === "string" && item.trim()) {
                accounts.push({
                    id: `key-${i + 1}`,
                    name: `账号${i + 1}`,
                    api_key: item.trim(),
                    autoNamed: true,
                });
                return;
            }
            if (item && typeof item === "object") {
                const key = String(item.api_key || item.apiKey || item.key || "").trim();
                if (!key) {
                    return;
                }
                const id = String(item.id || item.name || `key-${i + 1}`).trim() || `key-${i + 1}`;
                const hasLabel = Boolean(item.name || item.label);
                const name = String(item.name || item.label || id).trim() || id;
                accounts.push({ id, name, api_key: key, autoNamed: !hasLabel });
            }
        });
    }
    if (!accounts.length) {
        const legacy = String(proxy?.api_key || proxy?.apiKey || "").trim();
        if (legacy) {
            // Do NOT use proxy.name (often a model label). OpenCode identity
            // comes from console/api/go/status later; placeholder until then.
            accounts.push({
                id: "default",
                name: maskApiKey(legacy) || "opencode-account",
                api_key: legacy,
                autoNamed: true,
            });
        }
    }
    // Dedupe by api_key keep first
    const seen = new Set();
    const uniq = [];
    for (const a of accounts) {
        if (seen.has(a.api_key)) {
            continue;
        }
        seen.add(a.api_key);
        uniq.push(a);
    }
    return { accounts: uniq, mode, rotateMinutes };
}

function readActiveMap() {
    if (!extContext) {
        return {};
    }
    const raw = extContext.globalState.get(ACTIVE_KEY);
    return raw && typeof raw === "object" ? { ...raw } : {};
}

function writeActiveMap(map) {
    if (!extContext) {
        return;
    }
    void extContext.globalState.update(ACTIVE_KEY, map);
}

function loadProxyRaw(proxyKey) {
    const path = (0, proxy_config_loader_1.getProxyConfigPath)();
    if (!fs.existsSync(path)) {
        return null;
    }
    try {
        const cfg = JSON.parse(fs.readFileSync(path, "utf-8"));
        return cfg.proxies?.[proxyKey] || null;
    }
    catch {
        return null;
    }
}

function listAllProxyEntries() {
    const path = (0, proxy_config_loader_1.getProxyConfigPath)();
    if (!fs.existsSync(path)) {
        return [];
    }
    try {
        const cfg = JSON.parse(fs.readFileSync(path, "utf-8"));
        return Object.entries(cfg.proxies || {}).filter(([, p]) => p?.base_url);
    }
    catch {
        return [];
    }
}

function listMultiAccountProxies() {
    return listAllProxyEntries()
        .map(([key, proxy]) => {
            const parsed = parseAccountsFromProxy(proxy, key);
            return {
                proxyKey: key,
                proxyName: proxy.name || key,
                ...parsed,
            };
        })
        .filter((x) => x.accounts.length > 1);
}

/**
 * @returns {{ id: string, name: string, api_key: string, mode: string, rotateMinutes: number, proxyKey: string }|null}
 */
function getActiveAccount(proxyKey) {
    const proxy = loadProxyRaw(proxyKey);
    if (!proxy) {
        return null;
    }
    const { accounts, mode, rotateMinutes } = parseAccountsFromProxy(proxy, proxyKey);
    if (!accounts.length) {
        return null;
    }
    const map = readActiveMap();
    let id = map[proxyKey];
    let acc = accounts.find((a) => a.id === id);
    if (!acc) {
        acc = accounts[0];
        id = acc.id;
    }
    return {
        ...acc,
        mode,
        rotateMinutes,
        proxyKey,
    };
}

function setActiveAccountId(proxyKey, accountId, reason) {
    const proxy = loadProxyRaw(proxyKey);
    if (!proxy) {
        return false;
    }
    const { accounts } = parseAccountsFromProxy(proxy, proxyKey);
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) {
        return false;
    }
    const map = readActiveMap();
    map[proxyKey] = accountId;
    writeActiveMap(map);
    logger_1.logger.info(
        `Active account for ${proxyKey} → ${acc.name} (${maskApiKey(acc.api_key)}) [${reason || "manual"}]`,
    );
    onAccountChanged?.();
    return true;
}

function resolveApiKeyForProxy(proxyKey, proxy) {
    const parsed = parseAccountsFromProxy(proxy || loadProxyRaw(proxyKey) || {}, proxyKey);
    if (!parsed.accounts.length) {
        return { apiKey: "", account: null };
    }
    const active = getActiveAccount(proxyKey);
    const acc = active || { ...parsed.accounts[0], mode: parsed.mode, rotateMinutes: parsed.rotateMinutes, proxyKey };
    return { apiKey: acc.api_key, account: acc };
}

function getAccountSwitchMode(proxyKey) {
    const proxy = loadProxyRaw(proxyKey);
    if (!proxy) {
        return "manual";
    }
    return parseAccountsFromProxy(proxy, proxyKey).mode;
}

function advanceRotate(proxyKey) {
    const proxy = loadProxyRaw(proxyKey);
    if (!proxy) {
        return;
    }
    const { accounts, mode } = parseAccountsFromProxy(proxy, proxyKey);
    if (mode !== "rotate" || accounts.length < 2) {
        return;
    }
    const cur = getActiveAccount(proxyKey);
    const idx = Math.max(0, accounts.findIndex((a) => a.id === cur?.id));
    const next = accounts[(idx + 1) % accounts.length];
    setActiveAccountId(proxyKey, next.id, "rotate");
    void vscode.window.setStatusBarMessage(
        `Unified Proxy: ${proxy.name || proxyKey} → ${next.name}`,
        4000,
    );
}

function rescheduleAllRotators() {
    for (const t of rotateTimers.values()) {
        clearInterval(t);
    }
    rotateTimers.clear();
    for (const [key, proxy] of listAllProxyEntries()) {
        const { accounts, mode, rotateMinutes } = parseAccountsFromProxy(proxy, key);
        if (mode !== "rotate" || accounts.length < 2) {
            continue;
        }
        const ms = rotateMinutes * 60 * 1000;
        const timer = setInterval(() => advanceRotate(key), ms);
        rotateTimers.set(key, timer);
        logger_1.logger.info(
            `Account rotator: ${key} every ${rotateMinutes} min (${accounts.length} accounts)`,
        );
    }
}

async function pickAndSwitchAccount() {
    const multi = listMultiAccountProxies();
    if (!multi.length) {
        void vscode.window.showInformationMessage(
            "No multi-account proxies. Add `accounts` array in proxy_configs.json.",
        );
        return;
    }
    let target = multi[0];
    if (multi.length > 1) {
        const picked = await vscode.window.showQuickPick(
            multi.map((m) => ({
                label: m.proxyName,
                description: `${m.accounts.length} accounts · mode=${m.mode}`,
                detail: m.proxyKey,
                m,
            })),
            { title: "Switch account — select proxy", placeHolder: "Proxy / model entry" },
        );
        if (!picked) {
            return;
        }
        target = picked.m;
    }
    const active = getActiveAccount(target.proxyKey);
    const items = target.accounts.map((a) => ({
        label: a.name,
        description: maskApiKey(a.api_key),
        detail: a.id === active?.id ? "● currently active" : a.id,
        a,
    }));
    const chosen = await vscode.window.showQuickPick(items, {
        title: `Switch account — ${target.proxyName}`,
        placeHolder:
            target.mode === "rotate"
                ? `Mode: rotate every ${target.rotateMinutes} min (manual pick still overrides until next tick)`
                : "Mode: manual",
    });
    if (!chosen) {
        return;
    }
    setActiveAccountId(target.proxyKey, chosen.a.id, "quickpick");
    void vscode.window.showInformationMessage(
        `${target.proxyName}: active account → ${chosen.a.name}`,
    );
}
