"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareRequestTools = prepareRequestTools;
exports.collectTrailingToolResultIds = collectTrailingToolResultIds;
const convert_1 = require("../convert");
const sanitize_1 = require("./sanitize");
/**
 * Prepare tools for the upstream request.
 * No hard tool-count cap (aligned with DeepSeek V4 0.9.4 #291 — remove stale 128 limit).
 * Still sanitize schemas for OpenAI-compatible gateways.
 */
function prepareRequestTools(toolCallingCapability, options) {
    if (!toolCallingCapability) {
        return undefined;
    }
    const raw = (0, convert_1.convertTools)(options.tools);
    return raw ? (0, sanitize_1.sanitizeToolsForUpstream)(raw) : undefined;
}
function collectTrailingToolResultIds(messages) {
    const trailingToolResultIds = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "tool" || !message.tool_call_id) {
            break;
        }
        trailingToolResultIds.push(message.tool_call_id);
    }
    return trailingToolResultIds.reverse();
}
//# sourceMappingURL=request.js.map
