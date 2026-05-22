"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectActivatePreflight = inspectActivatePreflight;
exports.filterPreflightControlFlow = filterPreflightControlFlow;
exports.createPreflightToolCallId = createPreflightToolCallId;
const crypto_1 = require("crypto");
const vscode_1 = __importDefault(require("vscode"));
const consts_1 = require("./consts");
const PREFLIGHT_TOOL_NAME_HASH_LENGTH = 32;
const PREFLIGHT_CALL_ID_SEPARATOR = '_';
function inspectActivatePreflight(messages, tools) {
    const activatorNames = collectActivateToolNames(tools);
    const calledActivatorNames = new Set();
    let rounds = 0;
    const latestHumanUserMessageIndex = findLatestHumanUserMessageIndex(messages);
    for (let index = latestHumanUserMessageIndex + 1; index < messages.length; index += 1) {
        for (const part of messages[index].content) {
            const parsed = parsePreflightPart(part);
            if (!parsed) {
                continue;
            }
            rounds = Math.max(rounds, parsed.round);
            if (parsed.toolName?.startsWith(consts_1.ACTIVATE_TOOL_PREFIX)) {
                calledActivatorNames.add(parsed.toolName);
            }
        }
    }
    const remainingActivatorNames = activatorNames.filter((name) => !calledActivatorNames.has(name));
    return {
        rounds,
        calledActivatorNames: [...calledActivatorNames],
        remainingActivatorNames,
    };
}
function filterPreflightControlFlow(messages) {
    let changed = false;
    const filteredMessages = [];
    for (const message of messages) {
        const hasPreflightPart = message.content.some(isPreflightPart);
        const filteredContent = message.content.filter((part) => !isPreflightPart(part) && !(hasPreflightPart && isEmptyTextPart(part)));
        if (filteredContent.length === message.content.length) {
            filteredMessages.push(message);
            continue;
        }
        changed = true;
        if (filteredContent.length > 0) {
            filteredMessages.push({ ...message, content: filteredContent });
        }
    }
    return changed ? filteredMessages : messages;
}
function createPreflightToolCallId(round, toolName) {
    // Keep IDs short and within the conservative alnum/_ set for cross-provider replay.
    const toolNameHash = (0, crypto_1.createHash)('sha256')
        .update(toolName)
        .digest('hex')
        .slice(0, PREFLIGHT_TOOL_NAME_HASH_LENGTH);
    return `${consts_1.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX}${round}${PREFLIGHT_CALL_ID_SEPARATOR}${toolNameHash}`;
}
function collectActivateToolNames(tools) {
    const names = [];
    const seen = new Set();
    for (const tool of tools ?? []) {
        if (!tool.name.startsWith(consts_1.ACTIVATE_TOOL_PREFIX) || seen.has(tool.name)) {
            continue;
        }
        seen.add(tool.name);
        names.push(tool.name);
    }
    return names;
}
function findLatestHumanUserMessageIndex(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== vscode_1.default.LanguageModelChatMessageRole.User) {
            continue;
        }
        if (message.content.some(isHumanUserMessagePart)) {
            return index;
        }
    }
    return -1;
}
function isHumanUserMessagePart(part) {
    if (part instanceof vscode_1.default.LanguageModelToolResultPart) {
        return false;
    }
    if (part instanceof vscode_1.default.LanguageModelTextPart) {
        return part.value.length > 0;
    }
    return true;
}
function parsePreflightPart(part) {
    if (part instanceof vscode_1.default.LanguageModelToolCallPart) {
        const parsed = parsePreflightToolCallId(part.callId);
        if (!parsed) {
            return undefined;
        }
        return {
            round: parsed.round,
            toolName: part.name,
        };
    }
    if (part instanceof vscode_1.default.LanguageModelToolResultPart) {
        return parsePreflightToolCallId(part.callId) ?? undefined;
    }
    return undefined;
}
function isPreflightPart(part) {
    return ((part instanceof vscode_1.default.LanguageModelToolCallPart ||
        part instanceof vscode_1.default.LanguageModelToolResultPart) &&
        part.callId.startsWith(consts_1.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX));
}
function isEmptyTextPart(part) {
    return part instanceof vscode_1.default.LanguageModelTextPart && part.value.length === 0;
}
function parsePreflightToolCallId(callId) {
    if (!callId.startsWith(consts_1.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX)) {
        return undefined;
    }
    const value = callId.slice(consts_1.PREFLIGHT_ACTIVATE_CALL_ID_PREFIX.length);
    const separatorIndex = value.indexOf(PREFLIGHT_CALL_ID_SEPARATOR);
    if (separatorIndex < 0) {
        return undefined;
    }
    const round = Number.parseInt(value.slice(0, separatorIndex), 10);
    if (!Number.isSafeInteger(round) || round < 1) {
        return undefined;
    }
    return { round };
}
//# sourceMappingURL=preflight.js.map