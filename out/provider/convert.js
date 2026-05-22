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
function convertMessages(messages, isThinkingModel) {
    const result = [];
    for (const message of messages) {
        const role = mapRole(message.role);
        let content = "";
        let thinkingContent = "";
        const toolCalls = [];
        const toolResults = [];
        for (const part of message.content) {
            if (part instanceof vscode_1.default.LanguageModelTextPart) {
                content += part.value;
            }
            else if (isLanguageModelThinkingPart(part)) {
                thinkingContent += normalizeThinkingPartText(part.value);
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
            if (content) {
                result.push({
                    role: role,
                    content: content,
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
        total += msg.content?.length ?? 0;
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
