"use strict";
/**
 * Resolve image parts for vision proxy mode (supports_images=1).
 * Aligned with DeepSeek V4 0.8.2: user-tail images + tool-result images share one describer session.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveImageMessages = resolveImageMessages;
const vscode_1 = __importDefault(require("vscode"));
const json_1 = require("../../json");
const replay_1 = require("../replay");
const description_1 = require("./description");
const model_1 = require("./model");
const normalize_1 = require("./normalize");
const tool_1 = require("./tool");

/**
 * @param {object} [visionProxyConfig] - Optional per-backend vision_proxy config.
 */
async function resolveImageMessages(messages, token, getModel, visionProxyConfig) {
    const stats = createVisionResolutionStats();
    const summary = (0, normalize_1.collectVisionInputSummary)(messages);
    stats.inputImageParts = summary.inputImageParts;
    stats.inputImageMessages = summary.inputImageMessages;
    const hasHistoricalToolVision = messages.some(
        (message) =>
            message.role === vscode_1.default.LanguageModelChatMessageRole.Assistant &&
            Boolean((0, replay_1.parseFirstReplayMarker)(message)?.toolVision?.length),
    );
    if (summary.inputImageParts + summary.toolResultImageParts === 0 && !hasHistoricalToolVision) {
        return { messages, stats, replayMarkerMetadata: {} };
    }

    const session = (0, description_1.createVisionDescriptionSession)(stats, token, () =>
        (0, model_1.createVisionDescriber)(getModel, visionProxyConfig, token),
    );

    const markerBindings = createVisionMarkerBindings(messages, stats);
    const currentImageMessageIndex = findCurrentImageMessageIndex(messages);
    const result = [];
    let markerVisionText;

    for (const [messageIndex, message] of messages.entries()) {
        const imageParts =
            message.role === vscode_1.default.LanguageModelChatMessageRole.User
                ? getImageParts(message)
                : [];
        if (imageParts.length === 0) {
            result.push(message);
            continue;
        }
        const nonImageParts = getNonImageParts(message);
        const replayText = markerBindings.get(messageIndex);
        if (replayText) {
            stats.replayedImageMessages += 1;
            stats.droppedImageParts += imageParts.length;
            result.push(
                createResolvedMessage(message, [
                    ...nonImageParts,
                    new vscode_1.default.LanguageModelTextPart(replayText),
                ]),
            );
            continue;
        }
        if (messageIndex === currentImageMessageIndex) {
            stats.currentImageMessages += 1;
            const visionText = createVisionReplayText(
                await session.describe(
                    imageParts.map((p) => ({ mimeType: p.mimeType, data: p.data })),
                    "input",
                ),
                nonImageParts,
            );
            markerVisionText = visionText;
            stats.markerVisionTextChars = visionText.length;
            stats.droppedImageParts += imageParts.length;
            result.push(
                createResolvedMessage(message, [
                    ...nonImageParts,
                    new vscode_1.default.LanguageModelTextPart(visionText),
                ]),
            );
            continue;
        }
        stats.omittedImageMessages += 1;
        stats.droppedImageParts += imageParts.length;
        result.push(createResolvedMessage(message, nonImageParts));
    }

    const toolResolution = await (0, tool_1.resolveToolResultImages)(result, session, stats);
    const sessionMetadata = session.getMetadata();
    return {
        messages: toolResolution.messages,
        stats,
        replayMarkerMetadata: {
            visionText: markerVisionText,
            toolVision: toolResolution.replayEntries,
        },
        visionModelId: sessionMetadata.visionModelId,
        initialResponseNotice: sessionMetadata.initialResponseNotice,
    };
}

function createVisionResolutionStats() {
    return {
        inputImageParts: 0,
        inputImageMessages: 0,
        currentImageMessages: 0,
        generatedImageMessages: 0,
        replayedImageMessages: 0,
        omittedImageMessages: 0,
        unavailableImageMessages: 0,
        failedImageMessages: 0,
        droppedImageParts: 0,
        markerVisionTextChars: 0,
        invalidMarkerVisionMetadata: 0,
        input: { forwardedImageParts: 0, droppedImageParts: 0 },
        tool: { forwardedImageParts: 0, droppedImageParts: 0 },
    };
}

function createVisionMarkerBindings(messages, stats) {
    const bindings = new Map();
    const boundUserMessages = new Set();
    for (const [messageIndex, message] of messages.entries()) {
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.Assistant) {
            continue;
        }
        const visionText = findAssistantVisionText(message, stats);
        if (!visionText) {
            continue;
        }
        for (let userIndex = messageIndex - 1; userIndex >= 0; userIndex -= 1) {
            if (boundUserMessages.has(userIndex)) {
                continue;
            }
            const candidate = messages[userIndex];
            if (candidate.role !== vscode_1.default.LanguageModelChatMessageRole.User) {
                continue;
            }
            if (getImageParts(candidate).length === 0) {
                continue;
            }
            bindings.set(userIndex, visionText);
            boundUserMessages.add(userIndex);
            break;
        }
    }
    return bindings;
}

function findAssistantVisionText(message, stats) {
    const marker = (0, replay_1.parseFirstReplayMarker)(message);
    if (!marker) {
        return undefined;
    }
    if (!marker.valid) {
        stats.invalidMarkerVisionMetadata += 1;
        return undefined;
    }
    if (marker.visionText) {
        return marker.visionText;
    }
    if (marker.visionTextIgnoredReason) {
        stats.invalidMarkerVisionMetadata += 1;
    }
    return undefined;
}

function findCurrentImageMessageIndex(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role === vscode_1.default.LanguageModelChatMessageRole.Assistant) {
            return undefined;
        }
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.User) {
            continue;
        }
        if (getImageParts(message).length > 0) {
            return index;
        }
    }
    return undefined;
}

function createVisionReplayText(visionText, nonImageParts) {
    const separatedText = hasNonEmptyTextPart(nonImageParts) ? `\n\n${visionText}` : visionText;
    return (0, json_1.toWellFormedString)(separatedText);
}

function createResolvedMessage(message, content) {
    return {
        role: message.role,
        content,
        name: message.name,
    };
}

function getImageParts(message) {
    return message.content.filter(normalize_1.isImageDataPart);
}

function getNonImageParts(message) {
    return message.content.filter((part) => !(0, normalize_1.isImageDataPart)(part));
}

function hasNonEmptyTextPart(parts) {
    return parts.some(
        (part) => part instanceof vscode_1.default.LanguageModelTextPart && part.value.trim().length > 0,
    );
}
