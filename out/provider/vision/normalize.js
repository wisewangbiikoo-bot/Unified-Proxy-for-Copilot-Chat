"use strict";
/**
 * Normalize tool results for vision routing (ported from DeepSeek V4 0.8.2).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeToolResult = normalizeToolResult;
exports.collectVisionInputSummary = collectVisionInputSummary;
exports.isImageDataPart = isImageDataPart;
const vscode_1 = __importDefault(require("vscode"));

function normalizeToolResult(part) {
    return {
        callId: part.callId,
        parts: part.content.map(normalizeToolResultContentPart),
        originalContent: part.content,
    };
}

function collectVisionInputSummary(messages) {
    let inputImageParts = 0;
    let toolResultImageParts = 0;
    let toolResultsWithImages = 0;
    const messageIndexesWithInputImages = new Set();
    for (const [messageIndex, message] of messages.entries()) {
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.User) {
            continue;
        }
        for (const part of message.content) {
            if (isImageDataPart(part)) {
                inputImageParts += 1;
                messageIndexesWithInputImages.add(messageIndex);
                continue;
            }
            if (!(part instanceof vscode_1.default.LanguageModelToolResultPart)) {
                continue;
            }
            let toolResultHasImages = false;
            for (const item of normalizeToolResult(part).parts) {
                if (item.type !== "image") {
                    continue;
                }
                toolResultHasImages = true;
                toolResultImageParts += 1;
            }
            if (toolResultHasImages) {
                toolResultsWithImages += 1;
            }
        }
    }
    return {
        inputImageParts,
        inputImageMessages: messageIndexesWithInputImages.size,
        toolResultImageParts,
        toolResultsWithImages,
    };
}

function isImageDataPart(part) {
    return (part instanceof vscode_1.default.LanguageModelDataPart &&
        typeof part.mimeType === "string" &&
        part.mimeType.toLowerCase().startsWith("image/"));
}

function normalizeToolResultContentPart(item) {
    if (item instanceof vscode_1.default.LanguageModelTextPart) {
        return { type: "text", text: item.value };
    }
    if (isImageDataPart(item)) {
        return {
            type: "image",
            mimeType: item.mimeType,
            data: item.data,
        };
    }
    return { type: "other", value: item };
}
