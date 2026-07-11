"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertMessages = convertMessages;
exports.convertTools = convertTools;
exports.countMessageChars = countMessageChars;
const vscode_1 = __importDefault(require("vscode"));
const json_1 = require("../json");
const consts_1 = require("../consts");
const replay_1 = require("./replay");
/**
 * Convert VS Code chat messages to OpenAI-compatible chat messages.
 * @param {object} [options]
 * @param {boolean} [options.passNativeImages] When true (supports_images=2), image
 *   DataParts become OpenAI multimodal `image_url` content parts.
 *   When false, image parts are ignored here (mode 0 drops; mode 1 already
 *   replaced images with text via the vision proxy).
 */
function convertMessages(messages, isThinkingModel, options = {}) {
    const passNativeImages = Boolean(options.passNativeImages);
    const result = [];
    for (const message of messages) {
        const role = mapRole(message.role);
        let content = "";
        let thinkingContent = "";
        const toolCalls = [];
        const toolResults = [];
        const imageParts = [];
        for (const part of message.content) {
            if (part instanceof vscode_1.default.LanguageModelTextPart) {
                content += part.value;
            }
            else if (isLanguageModelThinkingPart(part)) {
                thinkingContent += normalizeThinkingPartText(part.value);
            }
            else if (passNativeImages && isImageDataPart(part)) {
                imageParts.push(part);
            }
            else if (part instanceof vscode_1.default.LanguageModelToolCallPart) {
                toolCalls.push({
                    id: part.callId,
                    type: "function",
                    function: {
                        name: part.name,
                        arguments: (0, json_1.safeStringify)(part.input),
                    },
                });
            }
            else if (part instanceof vscode_1.default.LanguageModelToolResultPart) {
                let toolContent = "";
                for (const item of part.content) {
                    if (item instanceof vscode_1.default.LanguageModelTextPart) {
                        toolContent += item.value;
                    }
                }
                toolResults.push({
                    callId: part.callId,
                    content: toolContent || (0, json_1.safeStringify)(part.content),
                });
            }
        }
        if (role === "assistant") {
            if (content || toolCalls.length > 0) {
                const replayMarker = isThinkingModel ? (0, replay_1.parseFirstReplayMarker)(message) : undefined;
                const msg = {
                    role: "assistant",
                    content: content || "",
                };
                if (toolCalls.length > 0) {
                    msg.tool_calls = toolCalls;
                }
                if (isThinkingModel) {
                    msg.reasoning_content = getReasoningContent(replayMarker, thinkingContent);
                }
                result.push(msg);
            }
        }
        else {
            const openaiContent = buildUserOrSystemContent(content, imageParts, passNativeImages);
            if (openaiContent !== undefined) {
                result.push({
                    role: role,
                    content: openaiContent,
                });
            }
        }
        for (const tr of toolResults) {
            result.push({
                role: "tool",
                content: tr.content,
                tool_call_id: tr.callId,
            });
        }
    }
    return result;
}
function buildUserOrSystemContent(text, imageParts, passNativeImages) {
    if (!passNativeImages || imageParts.length === 0) {
        return text ? text : undefined;
    }
    const parts = [];
    if (text && text.trim()) {
        parts.push({ type: "text", text });
    }
    for (const img of imageParts) {
        parts.push(dataPartToImageUrlContent(img));
    }
    return parts.length > 0 ? parts : undefined;
}
function isImageDataPart(part) {
    return (part instanceof vscode_1.default.LanguageModelDataPart &&
        typeof part.mimeType === "string" &&
        part.mimeType.startsWith("image/"));
}
function dataPartToImageUrlContent(part) {
    const mime = part.mimeType || "image/png";
    const b64 = bytesToBase64(part.data);
    return {
        type: "image_url",
        image_url: {
            url: `data:${mime};base64,${b64}`,
        },
    };
}
function bytesToBase64(data) {
    if (typeof data === "string") {
        return data;
    }
    if (typeof Buffer !== "undefined") {
        if (Buffer.isBuffer(data)) {
            return data.toString("base64");
        }
        return Buffer.from(data).toString("base64");
    }
    // Fallback without Buffer (should not happen in VS Code extension host)
    let binary = "";
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
function getReasoningContent(replayMarker, thinkingContent) {
    if (replayMarker?.valid && replayMarker.reasoningText) {
        return replayMarker.reasoningText;
    }
    return thinkingContent;
}
function isLanguageModelThinkingPart(part) {
    return (typeof vscode_1.default.LanguageModelThinkingPart === "function" &&
        part instanceof vscode_1.default.LanguageModelThinkingPart);
}
function normalizeThinkingPartText(value) {
    return Array.isArray(value) ? value.join("") : value;
}
function mapRole(role) {
    if (role === consts_1.LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) {
        return "system";
    }
    switch (role) {
        case vscode_1.default.LanguageModelChatMessageRole.User:
            return "user";
        case vscode_1.default.LanguageModelChatMessageRole.Assistant:
            return "assistant";
        default:
            return "user";
    }
}
function convertTools(tools) {
    if (!tools || tools.length === 0) {
        return undefined;
    }
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
        },
    }));
}
function countMessageChars(messages) {
    let total = 0;
    for (const msg of messages) {
        total += contentCharLength(msg.content);
        total += msg.reasoning_content?.length ?? 0;
        if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
                total += tc.function?.name?.length ?? 0;
                total += tc.function?.arguments?.length ?? 0;
            }
        }
    }
    return total;
}
function contentCharLength(content) {
    if (typeof content === "string") {
        return content.length;
    }
    if (!Array.isArray(content)) {
        return 0;
    }
    let n = 0;
    for (const part of content) {
        if (!part || typeof part !== "object") {
            continue;
        }
        if (part.type === "text" && typeof part.text === "string") {
            n += part.text.length;
        }
        else if (part.type === "image_url") {
            const url = part.image_url?.url;
            if (typeof url === "string") {
                n += url.length;
            }
        }
    }
    return n;
}
