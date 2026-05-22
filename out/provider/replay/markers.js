"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findFirstReplayMarker = findFirstReplayMarker;
exports.parseFirstReplayMarker = parseFirstReplayMarker;
exports.hasReplayMarkerMetadata = hasReplayMarkerMetadata;
exports.createReplayMarkerPart = createReplayMarkerPart;
exports.parseReplayMarkerData = parseReplayMarkerData;
const vscode_1 = __importDefault(require("vscode"));
const json_1 = require("../../json");
const consts_1 = require("./consts");
function findFirstReplayMarker(message) {
    for (const [partIndex, part] of message.content.entries()) {
        const marker = parseReplayMarkerPart(part);
        if (marker) {
            return { partIndex, marker };
        }
    }
    return undefined;
}
function parseFirstReplayMarker(message) {
    return findFirstReplayMarker(message)?.marker;
}
function parseReplayMarkerPart(part) {
    if (!(part instanceof vscode_1.default.LanguageModelDataPart)) {
        return undefined;
    }
    if (part.mimeType !== consts_1.REPLAY_MARKER_MIME) {
        return undefined;
    }
    return parseReplayMarkerData(part.data);
}
function hasReplayMarkerMetadata(metadata) {
    return Boolean(metadata.visionText || metadata.reasoningText);
}
function createReplayMarkerPart(metadata) {
    const payload = encodeReplayMarkerJson({
        ...createVisionMarkerPayload(metadata.visionText),
        ...createReasoningMarkerPayload(metadata.reasoningText),
    });
    return new vscode_1.default.LanguageModelDataPart(new TextEncoder().encode(`${consts_1.REPLAY_MARKER_WRITER_ID}\\${payload}`), consts_1.REPLAY_MARKER_MIME);
}
function parseReplayMarkerData(data) {
    const decoded = new TextDecoder().decode(data);
    const separatorIndex = decoded.indexOf('\\');
    if (separatorIndex < 0) {
        return { valid: false, error: 'marker-prefix-missing' };
    }
    const markerPrefix = decoded.slice(0, separatorIndex);
    if (!consts_1.REPLAY_MARKER_PREFIXES.has(markerPrefix)) {
        return { valid: false, error: 'marker-prefix-mismatch' };
    }
    const markerPayload = decoded.slice(separatorIndex + 1);
    const decodedPayload = decodeReplayMarkerPayload(markerPayload);
    if (!decodedPayload.valid) {
        return { valid: false, error: decodedPayload.error };
    }
    const payload = decodedPayload.value;
    if (isValidLegacySegmentId(payload)) {
        return {
            valid: true,
            segmentId: payload.toLowerCase(),
            legacySegmentOnly: true,
            payloadFormat: decodedPayload.format,
        };
    }
    try {
        const value = JSON.parse(payload);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { valid: false, error: 'marker-payload-not-object' };
        }
        const segmentId = parseOptionalSegmentId(value);
        if (segmentId.error) {
            return { valid: false, error: segmentId.error };
        }
        const vision = parseVisionMarkerMetadata(value);
        const reasoning = parseReasoningMarkerMetadata(value);
        return {
            valid: true,
            segmentId: segmentId.value,
            ...vision,
            ...reasoning,
            legacySegmentOnly: Boolean(segmentId.value && !vision.visionText && !reasoning.reasoningText),
            payloadFormat: decodedPayload.format,
        };
    }
    catch {
        return { valid: false, error: 'marker-json-invalid' };
    }
}
function parseOptionalSegmentId(value) {
    const segmentId = value.segmentId;
    if (segmentId === undefined) {
        return {};
    }
    if (typeof segmentId !== 'string') {
        return { error: 'segment-id-not-string' };
    }
    if (!isValidLegacySegmentId(segmentId)) {
        return { error: 'segment-id-not-uuid' };
    }
    return { value: segmentId.toLowerCase() };
}
function createVisionMarkerPayload(visionText) {
    return visionText ? { vision: { text: visionText } } : {};
}
function parseVisionMarkerMetadata(value) {
    const vision = value.vision;
    if (vision === undefined) {
        return {};
    }
    if (!vision || typeof vision !== 'object' || Array.isArray(vision)) {
        return { visionTextIgnoredReason: 'vision-not-object' };
    }
    const text = vision.text;
    if (typeof text !== 'string') {
        return { visionTextIgnoredReason: 'vision-text-not-string' };
    }
    if (text.length === 0) {
        return { visionTextIgnoredReason: 'vision-text-empty' };
    }
    return { visionText: text };
}
function createReasoningMarkerPayload(reasoningText) {
    return reasoningText ? { reasoning: { text: reasoningText } } : {};
}
function parseReasoningMarkerMetadata(value) {
    const reasoning = value.reasoning;
    if (reasoning === undefined) {
        return {};
    }
    if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) {
        return { reasoningTextIgnoredReason: 'reasoning-not-object' };
    }
    const text = reasoning.text;
    if (typeof text !== 'string') {
        return { reasoningTextIgnoredReason: 'reasoning-text-not-string' };
    }
    if (text.length === 0) {
        return { reasoningTextIgnoredReason: 'reasoning-text-empty' };
    }
    return { reasoningText: text };
}
function encodeReplayMarkerJson(value) {
    const json = (0, json_1.safeStringify)(value);
    return `${consts_1.ENCODED_JSON_MARKER_PREFIX}${Buffer.from(json, 'utf8').toString('base64url')}`;
}
function decodeReplayMarkerPayload(markerPayload) {
    if (!markerPayload.startsWith(consts_1.ENCODED_JSON_MARKER_PREFIX)) {
        return {
            valid: true,
            value: markerPayload,
            format: isValidLegacySegmentId(markerPayload) ? 'raw-uuid' : 'raw-json',
        };
    }
    const encodedPayload = markerPayload.slice(consts_1.ENCODED_JSON_MARKER_PREFIX.length);
    if (!encodedPayload || !consts_1.BASE64URL_PATTERN.test(encodedPayload)) {
        return { valid: false, error: 'marker-json-base64-invalid' };
    }
    try {
        return {
            valid: true,
            value: Buffer.from(encodedPayload, 'base64url').toString('utf8'),
            format: 'json-base64url',
        };
    }
    catch {
        return { valid: false, error: 'marker-json-base64-invalid' };
    }
}
function isValidLegacySegmentId(value) {
    return consts_1.LEGACY_SEGMENT_ID_PATTERN.test(value);
}
//# sourceMappingURL=markers.js.map