"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyNoProxyBypass = applyNoProxyBypass;
exports.collectNoProxyHosts = collectNoProxyHosts;
exports.getDirectConnectEnv = getDirectConnectEnv;
const fs = require("fs");
const os = require("os");
const path = require("path");
const proxy_config_loader_1 = require("./proxy_config_loader");
const PROXY_ENV_KEYS = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
];
/**
 * Merge LAN/backend hosts into NO_PROXY so extension-host HTTP skips system proxy.
 */
function applyNoProxyBypass() {
    const merged = [...collectNoProxyHosts()].join(",");
    process.env.NO_PROXY = merged;
    process.env.no_proxy = merged;
}
function collectNoProxyHosts(extraHost) {
    const hosts = new Set(["localhost", "127.0.0.1", "::1", "<local>"]);
    if (extraHost) {
        hosts.add(extraHost);
    }
    const configPath = (0, proxy_config_loader_1.getProxyConfigPath)();
    try {
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            for (const proxy of Object.values(cfg.proxies || {})) {
                const baseUrl = proxy?.base_url;
                if (typeof baseUrl === "string") {
                    try {
                        hosts.add(new URL(baseUrl).hostname);
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
        }
    }
    catch {
        /* ignore */
    }
    mergeVscodeNoProxyHosts(hosts);
    const prev = process.env.NO_PROXY || process.env.no_proxy || "";
    for (const part of prev.split(/[,;\s]+/)) {
        if (part) {
            hosts.add(part.trim());
        }
    }
    return hosts;
}
/** Env patch for child processes: bypass system HTTP proxy for LAN upstream. */
function getDirectConnectEnv(targetUrl) {
    let host;
    try {
        host = new URL(targetUrl).hostname;
    }
    catch {
        host = undefined;
    }
    const merged = [...collectNoProxyHosts(host)].join(",");
    const env = {
        NO_PROXY: merged,
        no_proxy: merged,
    };
    for (const key of PROXY_ENV_KEYS) {
        env[key] = "";
    }
    return env;
}
function mergeVscodeNoProxyHosts(hosts) {
    const candidates = [
        path.join(os.homedir(), "AppData", "Roaming", "Code", "User", "settings.json"),
        path.join(os.homedir(), "AppData", "Roaming", "Cursor", "User", "settings.json"),
    ];
    for (const settingsPath of candidates) {
        try {
            if (!fs.existsSync(settingsPath)) {
                continue;
            }
            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
            const noProxy = settings["http.noProxy"];
            if (Array.isArray(noProxy)) {
                for (const entry of noProxy) {
                    if (typeof entry === "string" && entry) {
                        hosts.add(entry.trim());
                    }
                }
            }
            else if (typeof noProxy === "string") {
                for (const part of noProxy.split(/[,;\s]+/)) {
                    if (part) {
                        hosts.add(part.trim());
                    }
                }
            }
        }
        catch {
            /* ignore */
        }
    }
}
