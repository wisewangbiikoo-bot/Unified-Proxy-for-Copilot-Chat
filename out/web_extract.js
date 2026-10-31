"use strict";
/**
 * Auxiliary web-extract: summarize long HTML-like tool results via aux model.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.maybeSummarizeWebToolResults = maybeSummarizeWebToolResults;
exports.looksLikeWebPageContent = looksLikeWebPageContent;

const vscode = require("vscode");
const logger_1 = require("./logger");
const no_proxy_1 = require("./no_proxy");
const opencode_headers_1 = require("./opencode_headers");
const config_v2_1 = require("./config_v2");
const proxy_config_loader_1 = require("./proxy_config_loader");

const DEFAULT_THRESHOLD = 12000;
const MAX_INPUT_CHARS = 48000;
const SUMMARIZE_TIMEOUT_MS = 45000;

function looksLikeWebPageContent(text) {
    const s = String(text || "");
    if (s.length < DEFAULT_THRESHOLD) {
        return false;
    }
    const lower = s.slice(0, 4000).toLowerCase();
    if (
        lower.includes("<!doctype html") ||
        lower.includes("<html") ||
        lower.includes("<head") ||
        lower.includes("<body") ||
        (lower.includes("<div") && lower.includes("</div>"))
    ) {
        return true;
    }
    // Long fetched markdown / plain pages
    if (s.length >= DEFAULT_THRESHOLD * 1.5) {
        return true;
    }
    return false;
}

/**
 * @param {vscode.LanguageModelChatMessage[]} messages
 * @param {object|null} proxyConfig from getProxyConfig
 * @param {vscode.CancellationToken} [token]
 * @returns {Promise<vscode.LanguageModelChatMessage[]>}
 */
async function maybeSummarizeWebToolResults(messages, proxyConfig, token) {
    if (!proxyConfig || proxyConfig.schemaVersion !== 2 || !proxyConfig.hasAuxWebExtract) {
        return messages;
    }
    const { ok, cfg } = proxy_config_loader_1.readConfigFile();
    if (!ok || !cfg) {
        return messages;
    }
    const target = (0, config_v2_1.resolveAuxWebExtractTarget)(cfg);
    if (!target) {
        return messages;
    }
    const apiKey = String(target.api_key || "").trim();
    if (!apiKey) {
        return messages;
    }

    let changed = false;
    const out = [];
    for (const message of messages) {
        if (
            message.role !== vscode.LanguageModelChatMessageRole.User &&
            message.role !== vscode.LanguageModelChatMessageRole.Assistant
        ) {
            // tool results are often User-wrapped; also scan all content
        }
        const nextContent = [];
        let msgChanged = false;
        for (const part of message.content || []) {
            if (!(part instanceof vscode.LanguageModelToolResultPart)) {
                nextContent.push(part);
                continue;
            }
            const summarized = await summarizeToolResultPart(
                part,
                target,
                apiKey,
                token,
            );
            if (summarized) {
                nextContent.push(summarized);
                msgChanged = true;
                changed = true;
            }
            else {
                nextContent.push(part);
            }
        }
        if (msgChanged) {
            out.push({
                role: message.role,
                content: nextContent,
                name: message.name,
            });
        }
        else {
            out.push(message);
        }
    }
    if (changed) {
        logger_1.logger.info(
            `web_extract: summarized tool result(s) via ${target.model_id}`,
        );
    }
    return out;
}

/**
 * @returns {Promise<vscode.LanguageModelToolResultPart|null>}
 */
async function summarizeToolResultPart(part, target, apiKey, token) {
    let text = "";
    for (const item of part.content || []) {
        if (item instanceof vscode.LanguageModelTextPart) {
            text += item.value;
        }
    }
    if (!looksLikeWebPageContent(text)) {
        return null;
    }
    const summary = await callSummarize(
        target.base_url,
        apiKey,
        target.model_id,
        target.custom_headers || target.openCodeSession
            ? {
                customHeaders: target.custom_headers,
                openCodeSession: target.openCodeSession || "",
            }
            : null,
        text,
        token,
    );
    if (!summary) {
        return null;
    }
    const note =
        `[网页提取 · 辅助模型摘要 ${target.name || target.model_id}]\n\n` +
        summary;
    return new vscode.LanguageModelToolResultPart(part.callId, [
        new vscode.LanguageModelTextPart(note),
    ]);
}

async function callSummarize(baseUrl, apiKey, modelId, headerOpts, text, token) {
    (0, no_proxy_1.applyNoProxyBypass)();
    const root = String(baseUrl || "").replace(/\/$/, "");
    const url = `${root}/chat/completions`;
    const extra = (0, opencode_headers_1.buildUpstreamHeaders)({
        baseUrl,
        customHeaders: headerOpts?.customHeaders,
        sessionOverride: headerOpts?.openCodeSession || "",
    });
    const clipped = String(text || "").slice(0, MAX_INPUT_CHARS);
    const body = {
        model: modelId,
        temperature: 0.2,
        max_tokens: 2048,
        messages: [
            {
                role: "system",
                content:
                    "你是网页内容提取助手。根据用户给出的页面原文，输出中文摘要：保留标题、关键链接、要点列表；去掉导航/广告/脚本噪音。不要编造原文没有的信息。",
            },
            {
                role: "user",
                content: clipped,
            },
        ],
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SUMMARIZE_TIMEOUT_MS);
    const cancelSub = token?.onCancellationRequested?.(() => ac.abort());
    try {
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                ...extra,
            },
            body: JSON.stringify(body),
            signal: ac.signal,
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => "");
            logger_1.logger.warn(`web_extract summarize HTTP ${resp.status}: ${t.slice(0, 200)}`);
            return null;
        }
        const json = await resp.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim()) {
            return content.trim();
        }
        return null;
    }
    catch (e) {
        logger_1.logger.warn(`web_extract summarize failed: ${e?.message || e}`);
        return null;
    }
    finally {
        clearTimeout(timer);
        cancelSub?.dispose?.();
    }
}
