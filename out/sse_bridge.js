#!/usr/bin/env node
"use strict";
/**
 * Standalone SSE relay (separate Node process — not VS Code extension host).
 * Reads POST body from stdin; writes upstream SSE bytes to stdout.
 * Env: SSE_BRIDGE_URL (full URL), SSE_BRIDGE_AUTH (optional Bearer value)
 */
const http = require("http");
const https = require("https");

const CONNECT_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_MS = 300000;
const PROXY_ENV_KEYS = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
];

function applyDirectConnectEnv(hostname) {
    const hosts = new Set(["localhost", "127.0.0.1", "::1", "<local>"]);
    if (hostname) {
        hosts.add(hostname);
    }
    const prev = process.env.NO_PROXY || process.env.no_proxy || "";
    for (const part of prev.split(/[,;\s]+/)) {
        if (part) {
            hosts.add(part.trim());
        }
    }
    const merged = [...hosts].join(",");
    process.env.NO_PROXY = merged;
    process.env.no_proxy = merged;
    for (const key of PROXY_ENV_KEYS) {
        delete process.env[key];
    }
}

function main() {
    const target = process.env.SSE_BRIDGE_URL;
    const auth = process.env.SSE_BRIDGE_AUTH || "";
    if (!target) {
        process.stderr.write("SSE_BRIDGE_URL missing\n");
        process.exit(2);
    }
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
        const body = Buffer.concat(chunks);
        let url;
        try {
            url = new URL(target);
        }
        catch (e) {
            process.stderr.write(`Invalid URL: ${e.message}\n`);
            process.exit(2);
        }
        applyDirectConnectEnv(url.hostname);
        const isHttps = url.protocol === "https:";
        const transport = isHttps ? https : http;
        const port = url.port || (isHttps ? 443 : 80);
        const headers = {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "Content-Length": String(body.length),
            Connection: "close",
        };
        if (auth) {
            headers.Authorization = auth.startsWith("Bearer ") ? auth : `Bearer ${auth}`;
        }
        const req = transport.request(
            {
                hostname: url.hostname,
                port,
                path: `${url.pathname}${url.search}`,
                method: "POST",
                headers,
                family: 4,
                timeout: CONNECT_TIMEOUT_MS,
            },
            (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    const errChunks = [];
                    res.on("data", (c) => errChunks.push(c));
                    res.on("end", () => {
                        process.stderr.write(Buffer.concat(errChunks).toString("utf8").slice(0, 2000));
                        process.exit(1);
                    });
                    return;
                }
                res.setTimeout(REQUEST_TIMEOUT_MS, () => {
                    process.stderr.write("bridge error: response timeout\n");
                    req.destroy();
                    process.exit(1);
                });
                res.on("data", (c) => process.stdout.write(c));
                res.on("end", () => process.exit(0));
            }
        );
        req.setTimeout(CONNECT_TIMEOUT_MS, () => {
            process.stderr.write(`bridge error: connect timeout ${url.hostname}:${port}\n`);
            req.destroy();
            process.exit(1);
        });
        req.on("error", (err) => {
            process.stderr.write(`bridge error: ${err.message}\n`);
            process.exit(1);
        });
        req.write(body);
        req.end();
    });
}

main();
