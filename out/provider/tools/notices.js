"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createToolDriftNotice = createToolDriftNotice;
exports.filterProviderNotices = filterProviderNotices;
const vscode_1 = __importDefault(require("vscode"));
const i18n_1 = require("../../i18n");
const consts_1 = require("./consts");
function createToolDriftNotice() {
    return [
        '',
        consts_1.TOOL_DRIFT_NOTICE_START,
        '',
        createBlockquote((0, i18n_1.t)('notice.toolDrift')),
        '',
        consts_1.TOOL_DRIFT_NOTICE_END,
        '',
    ].join('\n');
}
function filterProviderNotices(messages) {
    let changed = false;
    const filteredMessages = [];
    for (const message of messages) {
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.Assistant) {
            filteredMessages.push(message);
            continue;
        }
        let messageChanged = false;
        const filteredContent = [];
        for (const part of message.content) {
            if (!(part instanceof vscode_1.default.LanguageModelTextPart)) {
                filteredContent.push(part);
                continue;
            }
            const value = stripProviderNotices(part.value);
            if (value === part.value) {
                filteredContent.push(part);
                continue;
            }
            changed = true;
            messageChanged = true;
            if (value.length > 0) {
                filteredContent.push(new vscode_1.default.LanguageModelTextPart(value));
            }
        }
        if (!messageChanged) {
            filteredMessages.push(message);
        }
        else if (filteredContent.length > 0) {
            filteredMessages.push({ ...message, content: filteredContent });
        }
        else {
            changed = true;
        }
    }
    return changed ? filteredMessages : messages;
}
function stripProviderNotices(value) {
    let result = value;
    while (true) {
        const startIndex = result.indexOf(consts_1.TOOL_DRIFT_NOTICE_START);
        if (startIndex < 0) {
            return result;
        }
        const endMarkerIndex = result.indexOf(consts_1.TOOL_DRIFT_NOTICE_END, startIndex);
        const endIndex = endMarkerIndex < 0 ? result.length : endMarkerIndex + consts_1.TOOL_DRIFT_NOTICE_END.length;
        result = removeRangeWithWhitespace(result, startIndex, endIndex);
    }
}
function removeRangeWithWhitespace(value, startIndex, endIndex) {
    let removeStart = startIndex;
    while (removeStart > 0 && isWhitespace(value.charAt(removeStart - 1))) {
        removeStart -= 1;
    }
    let removeEnd = endIndex;
    while (removeEnd < value.length && isWhitespace(value.charAt(removeEnd))) {
        removeEnd += 1;
    }
    return value.slice(0, removeStart) + value.slice(removeEnd);
}
function isWhitespace(char) {
    return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}
function createBlockquote(value) {
    return value
        .split(/\r?\n/)
        .map((line) => (line.length > 0 ? `> ${line}` : '>'))
        .join('\n');
}
//# sourceMappingURL=notices.js.map