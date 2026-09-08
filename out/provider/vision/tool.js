"use strict";
/**
 * Resolve tool-result images via vision proxy (ported from DeepSeek V4 0.8.2 #260).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveToolResultImages = resolveToolResultImages;
const vscode_1 = __importDefault(require("vscode"));
const normalize_1 = require("./normalize");
const replay_1 = require("../replay");

async function resolveToolResultImages(messages, session, stats) {
    const replayIndex = new Map();
    for (const [messageIndex, message] of messages.entries()) {
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.Assistant) {
            continue;
        }
        for (const entry of (0, replay_1.parseFirstReplayMarker)(message)?.toolVision ?? []) {
            const entries = replayIndex.get(entry.callId) ?? [];
            entries.push([messageIndex, entry]);
            replayIndex.set(entry.callId, entries);
        }
    }
    const replayEntries = [];
    let messagesChanged = false;
    const resolvedMessages = [];
    for (const [messageIndex, message] of messages.entries()) {
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.User) {
            resolvedMessages.push(message);
            continue;
        }
        let messageChanged = false;
        const content = [];
        for (const part of message.content) {
            if (!(part instanceof vscode_1.default.LanguageModelToolResultPart)) {
                content.push(part);
                continue;
            }
            const resolvedPart = await resolveToolResultPart(
                part,
                messageIndex,
                replayIndex,
                session,
                stats,
                replayEntries,
            );
            content.push(resolvedPart);
            if (resolvedPart !== part) {
                messageChanged = true;
            }
        }
        if (!messageChanged) {
            resolvedMessages.push(message);
            continue;
        }
        messagesChanged = true;
        resolvedMessages.push({
            role: message.role,
            content,
            name: message.name,
        });
    }
    return {
        messages: messagesChanged ? resolvedMessages : messages,
        replayEntries,
    };
}

async function resolveToolResultPart(part, messageIndex, replayIndex, session, stats, replayEntries) {
    const normalized = (0, normalize_1.normalizeToolResult)(part);
    const imagePartCount = normalized.parts.filter((item) => item.type === "image").length;
    const replayEntry = replayIndex
        .get(normalized.callId)
        ?.find(
            ([markerIndex, entry]) =>
                markerIndex > messageIndex &&
                (imagePartCount === 0 || imagePartCount === entry.imageParts),
        )?.[1];
    if (replayEntry) {
        stats.replayedImageMessages += 1;
        if (!stats.tool) {
            stats.tool = { forwardedImageParts: 0, droppedImageParts: 0 };
        }
        stats.tool.droppedImageParts += imagePartCount;
        return new vscode_1.default.LanguageModelToolResultPart(normalized.callId, [
            new vscode_1.default.LanguageModelTextPart(replayEntry.resolvedContent),
        ]);
    }
    if (imagePartCount === 0) {
        return part;
    }
    const content = [];
    let resolvedContent = "";
    for (const item of normalized.parts) {
        if (item.type === "text") {
            content.push(new vscode_1.default.LanguageModelTextPart(item.text));
            resolvedContent += item.text;
        }
        else if (item.type === "image") {
            const description = await session.describe(
                [{ mimeType: item.mimeType, data: item.data }],
                "tool",
            );
            content.push(new vscode_1.default.LanguageModelTextPart(description));
            resolvedContent += description;
        }
        else {
            content.push(item.value);
        }
    }
    replayEntries.push({
        callId: normalized.callId,
        resolvedContent,
        imageParts: imagePartCount,
    });
    return new vscode_1.default.LanguageModelToolResultPart(normalized.callId, content);
}
