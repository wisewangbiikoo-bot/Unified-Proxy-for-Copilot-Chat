"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepSeekClient = void 0;
const path = require("path");
const { spawn } = require("child_process");
const json_1 = require("./json");
const logger_1 = require("./logger");
const no_proxy_1 = require("./no_proxy");
const sanitize_1 = require("./provider/tools/sanitize");
const SSE_BRIDGE_SCRIPT = path.join(__dirname, "sse_bridge.js");
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
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
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
        const processLines = () => {
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(":")) {
                    continue;
                }
                if (trimmed === "data: [DONE]") {
                    for (const tc of pendingToolCalls.values()) {
                        callbacks.onToolCall(tc);
                    }
                    pendingToolCalls.clear();
                    callbacks.onDone();
                    return true;
                }
                if (!trimmed.startsWith("data: ")) {
                    continue;
                }
                const jsonStr = trimmed.slice(6);
                try {
                    const chunk = JSON.parse(jsonStr);
                    const choice = chunk.choices?.[0];
                    if (chunk.usage && callbacks.onUsage) {
                        callbacks.onUsage(chunk.usage);
                    }
                    if (!choice) {
                        continue;
                    }
                    const reasoning = choice.delta?.reasoning_content;
                    if (reasoning) {
                        callbacks.onThinking(reasoning);
                    }
                    if (choice.delta?.content) {
                        callbacks.onContent(choice.delta.content);
                    }
                    if (choice.delta?.tool_calls) {
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
            buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
            return processLines();
        };
        const finishStream = (resolve) => {
            if (buffer.length > 0) {
                buffer += "\n";
                processLines();
            }
            for (const tc of pendingToolCalls.values()) {
                callbacks.onToolCall(tc);
            }
            pendingToolCalls.clear();
            callbacks.onDone();
            resolve();
        };
        const runBridge = (requestBody) => this.streamViaChildBridge(url, requestBody, appendChunk, finishStream, cancellationToken);
        let retried = false;
        return runBridge(body)
            .catch(async (err) => {
            const msg = err?.message || String(err);
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
            const child = spawn(process.execPath, [SSE_BRIDGE_SCRIPT], {
                env: {
                    ...process.env,
                    ...directEnv,
                    SSE_BRIDGE_URL: url,
                    SSE_BRIDGE_AUTH: this.apiKey,
                },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true,
            });
            const cancelSub = cancellationToken?.onCancellationRequested(() => child.kill("SIGTERM"));
            if (cancellationToken?.isCancellationRequested) {
                child.kill("SIGTERM");
                resolve();
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
            child.stdin.on("error", reject);
            endStdin();
            child.stderr.on("data", (c) => {
                stderr += c.toString();
            });
            child.stdout.on("data", (chunk) => {
                stdoutBytes += chunk.length;
                if (appendChunk(chunk)) {
                    finished = true;
                    child.kill("SIGTERM");
                    resolve();
                }
            });
            child.on("error", reject);
            child.on("close", (code) => {
                cancelSub?.dispose();
                if (finished) {
                    return;
                }
                if (code !== 0) {
                    const detail = stderr.slice(0, 500);
                    const hint = detail.includes("ETIMEDOUT") || detail.includes("ECONNREFUSED")
                        ? " Check that the proxy server is running and reachable from this PC (e.g. curl http://host:port/v1/models)."
                        : "";
                    reject(new Error(`SSE bridge exit ${code}: ${detail}${hint}`));
                    return;
                }
                if (stdoutBytes === 0) {
                    reject(new Error("SSE bridge returned no stdout data"));
                    return;
                }
                finishStream(resolve);
            });
        });
    }
}
exports.DeepSeekClient = DeepSeekClient;
