"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_SEGMENT_ID_PATTERN = exports.BASE64URL_PATTERN = exports.ENCODED_JSON_MARKER_PREFIX = exports.REPLAY_MARKER_PREFIXES = exports.REPLAY_MARKER_WRITER_ID = exports.REPLAY_MARKER_MIME = void 0;
const consts_1 = require("../../consts");
exports.REPLAY_MARKER_MIME = 'stateful_marker';
exports.REPLAY_MARKER_WRITER_ID = 'deepseek-copilot';
exports.REPLAY_MARKER_PREFIXES = new Set([
    exports.REPLAY_MARKER_WRITER_ID,
    ...consts_1.MODELS.map((model) => model.id),
]);
exports.ENCODED_JSON_MARKER_PREFIX = 'json:';
exports.BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
exports.LEGACY_SEGMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
//# sourceMappingURL=consts.js.map