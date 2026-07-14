"use strict";
/**
 * Endpoint-based vision proxy — send images to a configurable API endpoint
 * for description, then return the text for injection into the target model.
 *
 * Supported protocols:
 *   - openai-chat:    POST /v1/chat/completions (OpenAI-compatible)
 *   - openai-responses: POST /v1/responses (OpenAI Responses API)
 *   - anthropic-messages: POST /v1/messages (Anthropic API)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeImageViaEndpoint = describeImageViaEndpoint;
const http = require("http");
const https = require("https");
const VISION_PROMPT = "Describe all image attachments in this message. Return one concise factual description suitable for inserting into a text-only chat prompt. Include visible text, objects, UI elements, people, and relevant context. Do not invent details.";
const ENDPOINT_TIMEOUT = 60000;

/**
 * Describe image data via a configured API endpoint.
 * @param {Uint8Array[]} imageDataArray - Array of raw image bytes
 * @param {string[]} mimeTypes - Corresponding MIME types (image/png, image/jpeg, etc.)
 * @param {object} visionConfig - Parsed vision_proxy config
 * @returns {Promise<string>} Description text
 */
async function describeImageViaEndpoint(imageDataArray, mimeTypes, visionConfig) {
    const { protocol, baseUrl, apiKey, modelId, customHeaders } = visionConfig;
    if (!baseUrl) {
        throw new Error("vision_proxy.base_url is required for endpoint type");
    }
    const targetModel = modelId || "gpt-4o";
    const url = buildEndpointUrl(baseUrl, protocol);

    switch (protocol) {
        case "openai-chat":
            return doOpenAIChat(url, apiKey, targetModel, imageDataArray, mimeTypes, customHeaders);
        case "openai-responses":
            return doOpenAIResponses(url, apiKey, targetModel, imageDataArray, mimeTypes, customHeaders);
        case "anthropic-messages":
            return doAnthropicMessages(url, apiKey, targetModel, imageDataArray, mimeTypes, customHeaders);
        default:
            throw new Error(`Unsupported vision proxy protocol: ${protocol}`);
    }
}

function buildEndpointUrl(baseUrl, protocol) {
    const clean = baseUrl.replace(/\/+$/, "");
    if (protocol === "openai-chat") {
        return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
    }
    if (protocol === "openai-responses") {
        return clean.endsWith("/responses") ? clean : `${clean}/responses`;
    }
    if (protocol === "anthropic-messages") {
        return clean.endsWith("/messages") ? clean : `${clean}/messages`;
    }
    return clean;
}

function buildImageContent(imageDataArray, mimeTypes) {
    const parts = [];
    for (let i = 0; i < imageDataArray.length; i++) {
        const data = imageDataArray[i];
        const mime = mimeTypes[i] || "image/png";
        const b64 = bufferToBase64(data);
        parts.push({
            type: "image_url",
            image_url: { url: `data:${mime};base64,${b64}`, detail: "auto" },
        });
    }
    return parts;
}

function bufferToBase64(data) {
    if (typeof Buffer !== "undefined") {
        if (Buffer.isBuffer(data)) {
            return data.toString("base64");
        }
        return Buffer.from(data).toString("base64");
    }
    let binary = "";
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function buildRequestOptions(url, apiKey, customHeaders, bodyBytes) {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const headers = {
        "Content-Type": "application/json",
        "Content-Length": String(bodyBytes.length),
        Connection: "close",
    };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    if (customHeaders) {
        for (const [k, v] of Object.entries(customHeaders)) {
            headers[k] = v;
        }
    }
    return {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
        timeout: ENDPOINT_TIMEOUT,
        family: 4,
    };
}

function httpRequest(options, bodyBytes) {
    return new Promise((resolve, reject) => {
        const isHttps = options.port === 443 || options.path?.startsWith("https");
        const transport = isHttps ? https : http;
        const req = transport.request(options, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const raw = Buffer.concat(chunks);
                if (res.statusCode && res.statusCode >= 400) {
                    const detail = raw.toString("utf8").slice(0, 500);
                    reject(new Error(`Vision endpoint HTTP ${res.statusCode}: ${detail}`));
                    return;
                }
                resolve(raw.toString("utf8"));
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Vision endpoint timeout"));
        });
        req.write(bodyBytes);
        req.end();
    });
}

async function doOpenAIChat(url, apiKey, model, imageDataArray, mimeTypes, customHeaders) {
    const imageContent = buildImageContent(imageDataArray, mimeTypes);
    const body = JSON.stringify({
        model,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: VISION_PROMPT },
                    ...imageContent,
                ],
            },
        ],
        max_tokens: 4096,
        stream: false,
    });
    const options = buildRequestOptions(url, apiKey, customHeaders, Buffer.from(body, "utf8"));
    const raw = await httpRequest(options, Buffer.from(body, "utf8"));
    const parsed = JSON.parse(raw);
    const text = parsed.choices?.[0]?.message?.content || "";
    return text.trim();
}

async function doOpenAIResponses(url, apiKey, model, imageDataArray, mimeTypes, customHeaders) {
    // OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
    const imageContent = buildImageContent(imageDataArray, mimeTypes);
    const input = [{ role: "user", content: [{ type: "input_text", text: VISION_PROMPT }, ...imageContent] }];
    const body = JSON.stringify({ model, input, max_output_tokens: 4096 });
    const options = buildRequestOptions(url, apiKey, customHeaders, Buffer.from(body, "utf8"));
    const raw = await httpRequest(options, Buffer.from(body, "utf8"));
    const parsed = JSON.parse(raw);
    // Responses API output format
    let text = "";
    if (parsed.output_text) {
        text = parsed.output_text;
    } else if (parsed.output?.length) {
        for (const item of parsed.output) {
            if (item.type === "message" && item.content?.[0]?.text) {
                text += item.content[0].text;
            } else if (item.type === "text") {
                text += item.text;
            }
        }
    } else if (parsed.output?.[0]?.content?.[0]?.text) {
        text = parsed.output[0].content[0].text;
    }
    return text.trim();
}

async function doAnthropicMessages(url, apiKey, model, imageDataArray, mimeTypes, customHeaders) {
    // Anthropic Messages API: https://docs.anthropic.com/en/api/messages
    const content = [{ type: "text", text: VISION_PROMPT }];
    for (let i = 0; i < imageDataArray.length; i++) {
        const data = imageDataArray[i];
        const mime = mimeTypes[i] || "image/png";
        const b64 = bufferToBase64(data);
        content.push({
            type: "image",
            source: { type: "base64", media_type: mime, data: b64 },
        });
    }
    const body = JSON.stringify({
        model: model || "claude-3-haiku-20240307",
        max_tokens: 4096,
        messages: [{ role: "user", content }],
    });
    const parsed = new URL(url);
    const headers = {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
    };
    if (apiKey) {
        // Anthropic native uses x-api-key; OpenCode Go / generic use Bearer.
        // Send both to maximize compatibility; customHeaders can override.
        headers["x-api-key"] = apiKey;
        headers.Authorization = `Bearer ${apiKey}`;
    }
    if (customHeaders) {
        for (const [k, v] of Object.entries(customHeaders)) {
            headers[k] = v;
        }
    }
    const options = {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers,
        timeout: ENDPOINT_TIMEOUT,
        family: 4,
    };
    const raw = await httpRequest(options, Buffer.from(body, "utf8"));
    const parsed2 = JSON.parse(raw);
    let text = "";
    if (parsed2.content) {
        for (const block of parsed2.content) {
            if (block.type === "text") {
                text += block.text;
            }
        }
    }
    return text.trim();
}
