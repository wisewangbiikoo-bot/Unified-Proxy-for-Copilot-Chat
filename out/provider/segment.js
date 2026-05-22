"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveConversationSegment = resolveConversationSegment;
const crypto_1 = require("crypto");
const vscode_1 = __importDefault(require("vscode"));
const replay_1 = require("./replay");
function resolveConversationSegment(messages) {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = messages[messageIndex];
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.Assistant) {
            continue;
        }
        const foundMarker = (0, replay_1.findFirstReplayMarker)(message);
        if (!foundMarker) {
            continue;
        }
        const { marker, partIndex } = foundMarker;
        if (marker.valid && marker.segmentId) {
            return {
                segmentId: marker.segmentId,
                reason: 'markerFound',
                markerMessageIndex: messageIndex,
                markerPartIndex: partIndex,
            };
        }
        if (!marker.valid) {
            return {
                segmentId: (0, crypto_1.randomUUID)(),
                reason: 'markerInvalid',
                markerMessageIndex: messageIndex,
                markerPartIndex: partIndex,
                markerError: marker.error ?? 'unknown-marker-error',
            };
        }
    }
    return {
        segmentId: (0, crypto_1.randomUUID)(),
        reason: 'markerMissing',
    };
}
//# sourceMappingURL=segment.js.map