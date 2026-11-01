"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepSeekClient = void 0;
const path = require("path");
const { spawn } = require("child_process");
const vscode = require("vscode");
const json_1 = require("./json");
const logger_1 = require("./logger");
const no_proxy_1 = require("./no_proxy");
const sanitize_1 = require("./provider/tools/sanitize");
function cancellationError() {
    try {
        return new vscode.CancellationError();
    }
    catch {
        const e = new Error("Cancelled");
        e.name = "Canceled";
        return e;
    }
}
const SSE_BRIDGE_SCRIPT = path.join(__dirname, "sse_bridge.js");
const GEMMA_THINK_START_RE = /<\|channel>thought/i;
const GEMMA_ORPHAN_RE = /<\|channel\|>|<\|channel>/gi;
const GEMMA_THOUGHT_LEAK_RE = /(?:<\|channel>thought|thought\s*<\|channel\|>|thought\s*<\|channel>)/gi;
/** Strip Gemma 4 channel leaks per chunk. No cross-chunk buffer — buffering ate newline-only SSE deltas and broke Markdown layout. LM Studio reasoning parser is the primary fix. */
function stripGemmaChannelOrphans(text) {
    if (!text) {
        return "";
    }
    return text
        .replace(/<\|channel>thought[\s\S]*?<\|channel\|>/gi, "")
        .replace(GEMMA_THOUGHT_LEAK_RE, "")
        .replace(GEMMA_ORPHAN_RE, "")
        .replace(GEMMA_THINK_START_RE, "");
}
function stripToolsFromRequest(body) {
    const req = JSON.parse(body);
    delete req.tools;
    delete req.tool_choice;
    req.messages = (req.messages || [])
        .filter((m) => m.role !== "tool")
        .map((m) => {
            if (m.role !== "assistant") {
                return m;
            }
            const out = {
                role: "assistant",
                content: typeof m.content === "string" ? m.content : "",
            };
            if (m.reasoning_content) {
                out.reasoning_content = m.reasoning_content;
            }
            return out;
        });
    return (0, json_1.safeStringify)(req);
}
function resanitizeToolsInRequest(body) {
    const req = JSON.parse(body);
    if (!req.tools?.length) {
        return body;
    }
    const { sanitizeToolsForUpstream } = sanitize_1;
    req.tools = sanitizeToolsForUpstream(req.tools);
    return (0, json_1.safeStringify)(req);
}
class DeepSeekClient {
    baseUrl;
    apiKey;
    /** @type {Record<string, string>} */
    extraHeaders;
    /**
     * @param {string} baseUrl
     * @param {string} apiKey
     * @param {Record<string, string>|null|undefined} [extraHeaders]
     */
    constructor(baseUrl, apiKey, extraHeaders) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.extraHeaders =
            extraHeaders && typeof extraHeaders === "object" ? { ...extraHeaders } : {};
    }
    async streamChatCompletion(request, callbacks, cancellationToken) {
        (0, no_proxy_1.applyNoProxyBypass)();
        const requestBody = {
            ...request,
            stream_options: { include_usage: true },
        };
        const body = (0, json_1.safeStringify)(requestBody);
        const url = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;
        const pendingToolCalls = new Map();
        let buffer = "";
        let cancelListener;
        let lastUsage = null;
        let lastFinishReason = "";
        let contentChars = 0;
        let thinkingChars = 0;
        let toolCallChunks = 0;
        let upstreamError = "";
        const textDecoder = new TextDecoder("utf-8", { fatal: false });
        const emitContent = (content) => {
            const cleaned = stripGemmaChannelOrphans(content);
            if (cleaned) {
                contentChars += cleaned.length;
                callbacks.onContent(cleaned);
            }
        };
        const emitUsage = () => {
            if (lastUsage && callbacks.onUsage) {
                callbacks.onUsage(lastUsage);
                lastUsage = null;
            }
        };
        const flushContent = () => { };
        const processLines = () => {
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(":")) {
                    continue;
                }
                if (trimmed === "data: [DONE]") {
                    // Finalization (usage / tools / empty check) happens in finishStream
                    return true;
                }
                if (!trimmed.startsWith("data: ")) {
                    continue;
                }
                const jsonStr = trimmed.slice(6);
                try {
                    const chunk = JSON.parse(jsonStr);
                    if (chunk.error) {
                        const errMsg =
                            chunk.error?.message ||
                            chunk.error?.type ||
                            JSON.stringify(chunk.error).slice(0, 300);
                        upstreamError = String(errMsg);
                        logger_1.logger.error(`Upstream SSE error object: ${upstreamError}`);
                    }
                    const choice = chunk.choices?.[0];
                    // Accumulate usage, emit only once at stream end (#145)
                    if (chunk.usage) {
                        lastUsage = chunk.usage;
                    }
                    if (!choice) {
                        continue;
                    }
                    if (choice.finish_reason) {
                        lastFinishReason = String(choice.finish_reason);
                    }
                    const reasoning =
                        choice.delta?.reasoning_content ||
                        choice.delta?.reasoning ||
                        "";
                    if (reasoning) {
                        const cleanedReasoning = stripGemmaChannelOrphans(reasoning);
                        if (cleanedReasoning.trim()) {
                            thinkingChars += cleanedReasoning.length;
                            callbacks.onThinking(cleanedReasoning);
                        }
                    }
                    if (choice.delta?.content) {
                        emitContent(choice.delta.content);
                    }
                    if (choice.delta?.tool_calls) {
                        toolCallChunks += choice.delta.tool_calls.length;
                        for (const tc of choice.delta.tool_calls) {
                            let pending = pendingToolCalls.get(tc.index);
                            if (!pending && tc.id) {
                                pending = {
                                    id: tc.id,
                                    type: "function",
                                    function: { name: "", arguments: "" },
                                };
                                pendingToolCalls.set(tc.index, pending);
                            }
                            if (pending) {
                                if (tc.function?.name) {
                                    pending.function.name += tc.function.name;
                                }
                                if (tc.function?.arguments) {
                                    pending.function.arguments += tc.function.arguments;
                                }
                            }
                        }
                    }
                    if (choice.finish_reason === "tool_calls" ||
                        choice.finish_reason === "stop") {
                        for (const tc of pendingToolCalls.values()) {
                            callbacks.onToolCall(tc);
                        }
                        pendingToolCalls.clear();
                    }
                }
                catch (e) {
                    logger_1.logger.error("Failed to parse SSE chunk:", jsonStr.slice(0, 200), e);
                }
            }
            return false;
        };
        const appendChunk = (chunk) => {
            if (cancellationToken?.isCancellationRequested) {
                return true;
            }
            if (chunk == null || chunk.length === 0) {
                return false;
            }
            buffer += typeof chunk === "string" ? chunk : textDecoder.decode(chunk, { stream: true });
            return processLines();
        };
        const finishStream = (resolve, reject) => {
            const tail = textDecoder.decode();
            if (tail) {
                buffer += tail;
            }
            if (buffer.length > 0) {
                buffer += "\n";
                processLines();
            }
            flushContent();
            emitUsage();
            for (const tc of pendingToolCalls.values()) {
                callbacks.onToolCall(tc);
            }
            const pendingTools = pendingToolCalls.size;
            pendingToolCalls.clear();
            callbacks.onDone();
            const empty =
                contentChars === 0 &&
                thinkingChars === 0 &&
                toolCallChunks === 0 &&
                pendingTools === 0;
            logger_1.logger.info(
                `SSE done model=${request?.model || "?"} finish=${lastFinishReason || "?"} ` +
                    `contentChars=${contentChars} thinkingChars=${thinkingChars} ` +
                    `toolChunks=${toolCallChunks} empty=${empty}` +
                    (upstreamError ? ` upstreamError=${upstreamError}` : ""),
            );
            if (upstreamError) {
                reject(new Error(`Upstream error: ${upstreamError}`));
                return;
            }
            if (empty) {
                reject(
                    new Error(
                        `Upstream returned empty stream for ${request?.model || "?"} ` +
                            `(finish=${lastFinishReason || "none"}). ` +
                            `Often happens when Agent context is huge — try a new chat.`,
                    ),
                );
                return;
            }
            resolve();
        };
        const runBridge = (requestBody) => this.streamViaChildBridge(url, requestBody, appendChunk, finishStream, cancellationToken);
        let retried = false;
        return runBridge(body)
            .catch(async (err) => {
            const msg = err?.message || String(err);
            // Retry once on transient upstream provider errors
            if (!retried && (msg.includes("Upstream request failed") || msg.includes("500") || msg.includes("502") || msg.includes("503"))) {
                retried = true;
                logger_1.logger.warn("Upstream provider error; retrying once");
                await new Promise((r) => setTimeout(r, 1000));
                return runBridge(body);
            }
            if (!msg.includes("no stdout data") && !msg.includes("SSE bridge returned")) {
                throw err;
            }
            if (!retried) {
                const fixed = resanitizeToolsInRequest(body);
                if (fixed !== body) {
                    retried = true;
                    logger_1.logger.warn("Upstream returned empty SSE; retrying with sanitized tool schemas");
                    return runBridge(fixed);
                }
            }
            const slim = stripToolsFromRequest(body);
            if (slim === body) {
                throw err;
            }
            retried = true;
            logger_1.logger.warn("Upstream returned empty SSE; retrying without tools");
            return runBridge(slim);
        })
            .finally(() => cancelListener?.dispose());
    }
    streamViaChildBridge(url, body, appendChunk, finishStream, cancellationToken) {
        return new Promise((resolve, reject) => {
            let stderr = "";
            let finished = false;
            let stdoutBytes = 0;
            const directEnv = (0, no_proxy_1.getDirectConnectEnv)(url);
            const headerEnv =
                this.extraHeaders && Object.keys(this.extraHeaders).length > 0
                    ? JSON.stringify(this.extraHeaders)
                    : "";
            const child = spawn(process.execPath, [SSE_BRIDGE_SCRIPT], {
                env: {
                    ...process.env,
                    ...directEnv,
                    SSE_BRIDGE_URL: url,
                    SSE_BRIDGE_AUTH: this.apiKey,
                    ...(headerEnv ? { SSE_BRIDGE_HEADERS: headerEnv } : {}),
                },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
            const cancelSub = cancellationToken?.onCancellationRequested(() => {
                logger_1.logger.info(`SSE bridge cancelled for ${url.slice(0, 80)}`);
                child.kill("SIGTERM");
            });
            if (cancellationToken?.isCancellationRequested) {
                child.kill("SIGTERM");
                // Must reject — resolve() with empty body looks like "no response" to Copilot
                reject(cancellationError());
                return;
            }
            const endStdin = () => {
                const ok = child.stdin.write(body);
                if (!ok) {
                    child.stdin.once("drain", () => child.stdin.end());
                }
                else {
                    child.stdin.end();
                }
            };
            child.stdin.on("error", (err) => {
                logger_1.logger.error(`SSE bridge stdin error for ${url.slice(0, 80)}: ${err.message}`);
                reject(err);
            });
            endStdin();
            child.stderr.on("data", (c) => {
                stderr += c.toString();
            });
            child.stdout.on("data", (chunk) => {
                stdoutBytes += chunk.length;
                if (appendChunk(chunk)) {
                    // [DONE] seen — still run empty/error checks via finishStream
                    finished = true;
                    child.kill("SIGTERM");
                    finishStream(resolve, reject);
                }
            });
            child.on("error", (err) => {
                logger_1.logger.error(`SSE bridge child process error for ${url.slice(0, 80)}: ${err.message}`);
                reject(err);
            });
            child.on("close", (code) => {
                cancelSub?.dispose();
                if (finished) {
                    return;
                }
                if (cancellationToken?.isCancellationRequested) {
                    logger_1.logger.info(
                        `SSE bridge closed after cancel (code=${code}, stdout=${stdoutBytes}) for ${url.slice(0, 80)}`,
                    );
                    reject(cancellationError());
                    return;
                }
                if (code !== 0) {
                    const detail = stderr.slice(0, 500);
                    let hint = "";
                    if (detail.includes("ETIMEDOUT") || detail.includes("connect timeout")) {
                        hint = " Connection timed out. Check that the proxy server is running and reachable (e.g. curl http://host:port/v1/models).";
                    } else if (detail.includes("ECONNREFUSED")) {
                        hint = " Connection refused. The server may be down or the port is wrong.";
                    } else if (detail.includes("ECONNRESET")) {
                        hint = " Connection reset. The server may have terminated the connection unexpectedly.";
                    } else if (detail.includes("ENOTFOUND")) {
                        hint = " DNS resolution failed. Check the hostname in base_url.";
                    } else if (detail.includes("401") || detail.includes("403")) {
                        hint = " Authentication failed. Check api_key.";
                    } else if (detail.includes("MissingSessionID") || detail.includes("x-opencode-session")) {
                        hint = " OpenCode Go requires x-opencode-session. Upgrade Unified Proxy to 1.3.0+, or set custom_headers.x-opencode-session / unified-proxy-copilot.openCodeSession.";
                    }
                    logger_1.logger.error(`SSE bridge exit ${code} for ${url.slice(0, 80)}: ${detail.slice(0, 200)}${hint}`);
                    reject(new Error(`SSE bridge exit ${code}: ${detail}${hint}`));
                    return;
                }
                if (stdoutBytes === 0) {
                    logger_1.logger.warn(`SSE bridge returned no stdout data for ${url.slice(0, 80)}`);
                    reject(new Error("SSE bridge returned no stdout data"));
                    return;
                }
                finishStream(resolve, reject);
            });
        });
    }
}
exports.DeepSeekClient = DeepSeekClient;
