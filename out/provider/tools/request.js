"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareRequestTools = prepareRequestTools;
exports.collectTrailingToolResultIds = collectTrailingToolResultIds;
const i18n_1 = require("../../i18n");
const convert_1 = require("../convert");
const sanitize_1 = require("./sanitize");
const consts_1 = require("./consts");
function prepareRequestTools(toolCallingCapability, options) {
    const raw = toolCallingCapability ? (0, convert_1.convertTools)(options.tools) : undefined;
    const tools = raw ? (0, sanitize_1.sanitizeToolsForUpstream)(raw) : undefined;
    const toolLimit = getToolCallingLimit(toolCallingCapability);
    const toolsCount = tools?.length ?? 0;
    if (toolsCount > toolLimit) {
        throw new Error((0, i18n_1.t)('request.toolsLimitExceeded', toolLimit, toolsCount));
    }
    return tools;
}
function collectTrailingToolResultIds(messages) {
    const trailingToolResultIds = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== 'tool' || !message.tool_call_id) {
            break;
        }
        trailingToolResultIds.push(message.tool_call_id);
    }
    return trailingToolResultIds.reverse();
}
function getToolCallingLimit(toolCallingCapability) {
    return typeof toolCallingCapability === 'number' ? toolCallingCapability : consts_1.DEEPSEEK_TOOLS_LIMIT;
}
//# sourceMappingURL=request.js.map