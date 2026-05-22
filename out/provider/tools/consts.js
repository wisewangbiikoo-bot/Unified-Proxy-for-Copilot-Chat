"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_DRIFT_NOTICE_END = exports.TOOL_DRIFT_NOTICE_START = exports.MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST = exports.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX = exports.ACTIVATE_TOOL_PREFIX = exports.DEEPSEEK_TOOLS_LIMIT = void 0;
// DeepSeek Chat Completions API: "A max of 128 functions are supported."
// https://api-docs.deepseek.com/api/create-chat-completion#:~:text=A%20max%20of%20128%20functions%20are%20supported.
exports.DEEPSEEK_TOOLS_LIMIT = 128;
exports.ACTIVATE_TOOL_PREFIX = 'activate_';
exports.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX = 'deepseek_preflight_activate_';
exports.MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST = 3;
exports.TOOL_DRIFT_NOTICE_START = '[deepseek-copilot-tool-drift-notice-start]: #';
exports.TOOL_DRIFT_NOTICE_END = '[deepseek-copilot-tool-drift-notice-end]: #';
//# sourceMappingURL=consts.js.map