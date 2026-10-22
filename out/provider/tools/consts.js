"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DRIFT_NOTICE_END = exports.TOOL_DRIFT_NOTICE_START = exports.MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST = exports.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX = exports.ACTIVATE_TOOL_PREFIX = exports.DEEPSEEK_TOOLS_LIMIT = void 0;
// Legacy constant kept for notice docs / older references only.
// Upstream DeepSeek V4 0.9.4 (#291) removed the hard 128-tool request cap;
// Unified Proxy no longer enforces this limit either.
exports.DEEPSEEK_TOOLS_LIMIT = 128;
exports.ACTIVATE_TOOL_PREFIX = 'activate_';
exports.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX = 'deepseek_preflight_activate_';
exports.MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST = 3;
exports.TOOL_DRIFT_NOTICE_START = '[deepseek-copilot-tool-drift-notice-start]: #';
exports.TOOL_DRIFT_NOTICE_END = '[deepseek-copilot-tool-drift-notice-end]: #';
//# sourceMappingURL=consts.js.map