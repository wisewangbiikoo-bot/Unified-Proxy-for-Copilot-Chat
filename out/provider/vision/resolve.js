"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveImageMessages = resolveImageMessages;
const vscode_1 = __importDefault(require("vscode"));
const i18n_1 = require("../../i18n");
const json_1 = require("../../json");
const logger_1 = require("../../logger");
const replay_1 = require("../replay");
const consts_1 = require("./consts");
const model_1 = require("./model");
/**
 * Resolve image parts without treating image bytes as persistent identity.
 * Historical images replay marker-carried text; only the current tail user
 * image message is sent to the vision proxy.
 */
async function resolveImageMessages(messages, token, getModel) {
    const stats = createVisionResolutionStats();
    collectInputImageStats(messages, stats);
    if (stats.inputImageParts === 0) {
        return { messages, stats, replayMarkerMetadata: {} };
    }
    const markerBindings = createVisionMarkerBindings(messages, stats);
    const currentImageMessageIndex = findCurrentImageMessageIndex(messages);
    const result = [];
    let visionModel;
    let visionModelRequested = false;
    let markerVisionText;
    for (const [messageIndex, message] of messages.entries()) {
        const imageParts = getImageParts(message);
        if (imageParts.length === 0) {
            result.push(message);
            continue;
        }
        const nonImageParts = getNonImageParts(message);
        const replayText = markerBindings.get(messageIndex);
        if (replayText) {
            stats.replayedImageMessages += 1;
            stats.droppedImageParts += imageParts.length;
            result.push(createResolvedMessage(message, [
                ...nonImageParts,
                new vscode_1.default.LanguageModelTextPart(replayText),
            ]));
            continue;
        }
        if (messageIndex === currentImageMessageIndex) {
            stats.currentImageMessages += 1;
            if (!visionModelRequested) {
                visionModelRequested = true;
                visionModel = await getModel();
            }
            const visionText = await resolveCurrentVisionText(imageParts, nonImageParts, visionModel, stats, token);
            markerVisionText = visionText;
            stats.markerVisionTextChars = visionText.length;
            stats.droppedImageParts += imageParts.length;
            result.push(createResolvedMessage(message, [
                ...nonImageParts,
                new vscode_1.default.LanguageModelTextPart(visionText),
            ]));
            continue;
        }
        stats.omittedImageMessages += 1;
        stats.droppedImageParts += imageParts.length;
        result.push(createResolvedMessage(message, nonImageParts));
    }
    return {
        messages: result,
        stats,
        replayMarkerMetadata: { visionText: markerVisionText },
        visionModelId: visionModel?.id,
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
    };
}
function collectInputImageStats(messages, stats) {
    for (const message of messages) {
        const imageParts = getImageParts(message).length;
        if (imageParts === 0) {
            continue;
        }
        stats.inputImageMessages += 1;
        stats.inputImageParts += imageParts;
    }
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
async function resolveCurrentVisionText(imageParts, nonImageParts, visionModel, stats, token) {
    if (!visionModel || token.isCancellationRequested) {
        if (!visionModel) {
            logger_1.logger.warn((0, i18n_1.t)('vision.unavailable'));
        }
        stats.unavailableImageMessages += 1;
        return createVisionReplayText(consts_1.IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts);
    }
    try {
        const description = await describeImageParts(imageParts, visionModel, (0, model_1.getVisionPrompt)(), token);
        if (description.length === 0) {
            stats.failedImageMessages += 1;
            return createVisionReplayText(consts_1.IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts);
        }
        stats.generatedImageMessages += 1;
        return createVisionReplayText(createImageDescriptionText(description), nonImageParts);
    }
    catch (error) {
        logger_1.logger.error((0, i18n_1.t)('vision.proxyError'), error);
        stats.failedImageMessages += 1;
        return createVisionReplayText(consts_1.IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts);
    }
}
async function describeImageParts(parts, visionModel, visionPrompt, token) {
    const visionMsg = vscode_1.default.LanguageModelChatMessage.User([
        ...parts,
        new vscode_1.default.LanguageModelTextPart(visionPrompt),
    ]);
    const response = await visionModel.sendRequest([visionMsg], {}, token);
    let description = '';
    for await (const chunk of response.stream) {
        if (chunk instanceof vscode_1.default.LanguageModelTextPart) {
            description += chunk.value;
        }
    }
    return description.trim();
}
function createVisionReplayText(visionText, nonImageParts) {
    const separatedText = hasNonEmptyTextPart(nonImageParts) ? `\n\n${visionText}` : visionText;
    return (0, json_1.toWellFormedString)(separatedText);
}
function createImageDescriptionText(description) {
    return consts_1.IMAGE_DESCRIPTION_PREFIX + description + consts_1.IMAGE_DESCRIPTION_SUFFIX;
}
function createResolvedMessage(message, content) {
    return {
        role: message.role,
        content,
        name: message.name,
    };
}
function getImageParts(message) {
    return message.content.filter(isImageDataPart);
}
function getNonImageParts(message) {
    return message.content.filter((part) => !isImageDataPart(part));
}
function hasNonEmptyTextPart(parts) {
    return parts.some((part) => part instanceof vscode_1.default.LanguageModelTextPart && part.value.trim().length > 0);
}
function isImageDataPart(part) {
    return part instanceof vscode_1.default.LanguageModelDataPart && part.mimeType.startsWith('image/');
}
//# sourceMappingURL=resolve.js.map