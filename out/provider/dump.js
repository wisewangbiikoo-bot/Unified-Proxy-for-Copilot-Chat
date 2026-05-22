"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dumpProviderInput = dumpProviderInput;
exports.dumpDeepSeekRequest = dumpDeepSeekRequest;
exports.ensureRequestDumpRoot = ensureRequestDumpRoot;
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = require("path");
const vscode_1 = __importDefault(require("vscode"));
const config_1 = require("../config");
const consts_1 = require("../consts");
const json_1 = require("../json");
const logger_1 = require("../logger");
const replay_1 = require("./replay");
const consts_2 = require("./tools/consts");
let dumpCounter = 0;
let providerInputDumpCounter = 0;
let dumpWriteQueue = Promise.resolve();
const REQUEST_OBSERVATIONS_FILE = '_request-observations.jsonl';
const HASH_WINDOW_CHARS = 2_048;
/**
 * Dump the raw LanguageModelChatProvider input before any request preparation.
 * This captures the first observable `options.tools` list, including any
 * `activate_*` virtual tools, even if the provider later short-circuits.
 */
function dumpProviderInput(options) {
    if (!(0, config_1.getRequestDumpEnabled)())
        return;
    const context = createDumpContext(options.globalStorageUri, options.segment, 'deepseek-provider-input', (providerInputDumpCounter += 1));
    const paths = createProviderInputDumpPaths(context);
    const toolSummary = summarizeTools(options.requestOptions.tools);
    enqueueDumpWrite('providerInputDump', async () => {
        await (0, promises_1.mkdir)(context.root, { recursive: true });
        await writeJsonFile(paths.providerInput, createProviderInputSnapshot(options, context));
        await writeDumpObservation(options.globalStorageUri, createDumpObservation({
            event: 'provider-input',
            context,
            segment: options.segment,
            paths,
            model: {
                vscodeModelId: options.modelInfo.id,
            },
            requestOptions: options.requestOptions,
            messages: options.messages,
            toolSummary,
        }));
        logProviderInputDump(options, paths, toolSummary);
    });
}
/**
 * Dump the FULL DeepSeek request payload (messages + tools) to disk verbatim
 * when debugMode is `verbose`. No truncation, no hashing - you get the
 * exact JSON that will be sent to the DeepSeek API (minus the auth header).
 *
 * Files land under `<dump root>/<conversationSegmentId>/` so marker replay and
 * cache-lineage changes are easy to inspect across provider calls:
 *   deepseek-request-<timestamp>-NNNN.input.json     — VS Code input snapshot
 *   deepseek-request-<timestamp>-NNNN.resolved.json  — post-vision VS Code snapshot
 *   deepseek-request-<timestamp>-NNNN.json           — full request body
 *   deepseek-request-<timestamp>-NNNN.msg0.txt       — messages[0] content (system prompt)
 */
function dumpDeepSeekRequest(request, options) {
    if (!(0, config_1.getRequestDumpEnabled)())
        return;
    const context = createDumpContext(options.globalStorageUri, options.segment, 'deepseek-request', (dumpCounter += 1));
    const msg0 = request.messages[0];
    const paths = createRequestDumpPaths(context, Boolean(msg0));
    const toolSummary = summarizeTools(options.requestOptions.tools);
    enqueueDumpWrite('requestDump', async () => {
        await (0, promises_1.mkdir)(context.root, { recursive: true });
        await writeJsonFile(paths.input, createPipelineSnapshot('input', request, options.inputMessages, options, context));
        await writeJsonFile(paths.resolved, createPipelineSnapshot('resolved', request, options.resolvedMessages, options, context));
        const requestJson = await writeJsonFile(paths.request, request, (value) => JSON.stringify(value, null, 2));
        if (msg0 && paths.msg0) {
            await writeTextFile(paths.msg0, msg0.content);
        }
        await writeDumpObservation(options.globalStorageUri, createDumpObservation({
            event: 'deepseek-request',
            context,
            segment: options.segment,
            paths,
            model: {
                vscodeModelId: options.vscodeModelId,
                apiModelId: request.model,
            },
            requestOptions: options.requestOptions,
            messages: options.inputMessages,
            toolSummary,
        }));
        logRequestDump(request, options, paths, requestJson.length);
    });
}
async function ensureRequestDumpRoot(globalStorageUri) {
    const root = getRequestDumpBaseRootUri(globalStorageUri);
    await (0, promises_1.mkdir)(root.fsPath, { recursive: true });
    return root;
}
function createDumpContext(globalStorageUri, segment, prefix, seq) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return {
        root: getRequestDumpRoot(globalStorageUri, segment),
        timestamp,
        basename: `${prefix}-${timestamp}-${String(seq).padStart(4, '0')}`,
    };
}
function createProviderInputDumpPaths(context) {
    return {
        directory: context.root,
        providerInput: (0, path_1.join)(context.root, `${context.basename}.json`),
    };
}
function createRequestDumpPaths(context, hasMsg0) {
    return {
        directory: context.root,
        input: (0, path_1.join)(context.root, `${context.basename}.input.json`),
        resolved: (0, path_1.join)(context.root, `${context.basename}.resolved.json`),
        request: (0, path_1.join)(context.root, `${context.basename}.json`),
        msg0: hasMsg0 ? (0, path_1.join)(context.root, `${context.basename}.msg0.txt`) : undefined,
    };
}
function createDumpObservation(options) {
    return {
        event: options.event,
        timestamp: options.context.timestamp,
        basename: options.context.basename,
        segment: options.segment,
        paths: options.paths,
        model: options.model,
        options: summarizeRequestOptions(options.requestOptions),
        hostSettings: summarizeHostSettings(),
        systemPromptSummary: summarizeVscodeSystemPrompt(options.messages),
        messageStats: summarizeMessagesFromInput(options.messages),
        toolStats: options.toolSummary,
    };
}
function createProviderInputSnapshot(options, context) {
    return createDumpSnapshot({
        stage: 'provider-input',
        context,
        segment: options.segment,
        model: {
            vscodeModelId: options.modelInfo.id,
            name: options.modelInfo.name,
            family: options.modelInfo.family,
            version: options.modelInfo.version,
            maxInputTokens: options.modelInfo.maxInputTokens,
            maxOutputTokens: options.modelInfo.maxOutputTokens,
            capabilities: sanitizeJsonValue(options.modelInfo.capabilities),
        },
        messages: options.messages,
        requestOptions: options.requestOptions,
    });
}
function createPipelineSnapshot(stage, request, messages, options, context) {
    return createDumpSnapshot({
        stage,
        context,
        segment: options.segment,
        model: {
            vscodeModelId: options.vscodeModelId,
            apiModelId: request.model,
            isThinkingModel: options.isThinkingModel,
            thinkingEffort: options.thinkingEffort,
            maxTokens: options.maxTokens ?? null,
        },
        vision: stage === 'resolved'
            ? {
                modelId: options.visionModelId ?? null,
                stats: options.visionStats ?? null,
            }
            : undefined,
        deepSeekPromptSummary: summarizeDeepSeekSystemPrompt(request.messages),
        messages,
        requestOptions: options.requestOptions,
    });
}
function createDumpSnapshot(options) {
    const serializedMessages = options.messages.map((message, index) => serializeMessage(message, index));
    return {
        stage: options.stage,
        timestamp: options.context.timestamp,
        basename: options.context.basename,
        segment: options.segment,
        model: options.model,
        options: summarizeRequestOptions(options.requestOptions),
        hostSettings: summarizeHostSettings(),
        vision: options.vision,
        systemPromptSummary: summarizeVscodeSystemPrompt(options.messages),
        deepSeekPromptSummary: options.deepSeekPromptSummary,
        messageStats: summarizeMessages(serializedMessages),
        messages: serializedMessages,
        toolStats: summarizeTools(options.requestOptions.tools),
        tools: serializeTools(options.requestOptions.tools),
    };
}
function serializeMessage(message, index) {
    const contentParts = message.content.map((part, partIndex) => serializeContentPart(part, partIndex));
    return {
        index,
        role: formatRole(message.role),
        name: message.name,
        contentPartCount: contentParts.length,
        contentTextChars: contentParts.reduce((sum, part) => sum + getContentPartTextChars(part), 0),
        contentDataBytes: contentParts.reduce((sum, part) => sum + getContentPartDataBytes(part), 0),
        contentParts,
    };
}
function serializeContentPart(part, index) {
    if (part instanceof vscode_1.default.LanguageModelTextPart) {
        const value = (0, json_1.toWellFormedString)(part.value);
        return {
            index,
            type: 'text',
            value,
            chars: value.length,
            hash: hashString(value),
        };
    }
    if (part instanceof vscode_1.default.LanguageModelToolCallPart) {
        const input = sanitizeJsonValue(part.input);
        const inputJson = (0, json_1.safeStringify)(input);
        return {
            index,
            type: 'toolCall',
            callId: part.callId,
            name: part.name,
            input,
            inputJsonChars: inputJson.length,
            inputHash: hashString(inputJson),
        };
    }
    if (part instanceof vscode_1.default.LanguageModelToolResultPart) {
        return {
            index,
            type: 'toolResult',
            callId: part.callId,
            contentPartCount: part.content.length,
            contentParts: part.content.map((item, itemIndex) => serializeContentPart(item, itemIndex)),
        };
    }
    if (part instanceof vscode_1.default.LanguageModelPromptTsxPart) {
        const value = sanitizeJsonValue(part.value);
        const valueJson = (0, json_1.safeStringify)(value);
        return {
            index,
            type: 'promptTsx',
            value,
            valueJsonChars: valueJson.length,
            valueHash: hashString(valueJson),
        };
    }
    if (part instanceof vscode_1.default.LanguageModelDataPart) {
        const replayMarker = part.mimeType === replay_1.REPLAY_MARKER_MIME
            ? summarizeReplayMarker((0, replay_1.parseReplayMarkerData)(part.data))
            : undefined;
        return {
            index,
            type: 'data',
            mimeType: part.mimeType,
            byteLength: part.data.byteLength,
            dataHash: hashBytes(part.data),
            isImage: part.mimeType.toLowerCase().startsWith('image/'),
            replayMarker,
        };
    }
    const value = sanitizeJsonValue(part);
    const valueJson = (0, json_1.safeStringify)(value);
    return {
        index,
        type: 'unknown',
        constructorName: getConstructorName(part),
        value,
        valueJsonChars: valueJson.length,
        valueHash: hashString(valueJson),
    };
}
function summarizeReplayMarker(marker) {
    return {
        valid: marker.valid,
        segmentId: marker.segmentId,
        payloadFormat: marker.payloadFormat,
        legacySegmentOnly: marker.legacySegmentOnly,
        visionTextChars: marker.visionText?.length,
        visionTextHash: marker.visionText ? hashString(marker.visionText) : undefined,
        visionTextIgnoredReason: marker.visionTextIgnoredReason,
        reasoningTextChars: marker.reasoningText?.length,
        reasoningTextHash: marker.reasoningText ? hashString(marker.reasoningText) : undefined,
        reasoningTextIgnoredReason: marker.reasoningTextIgnoredReason,
        error: marker.error,
    };
}
function serializeTools(tools) {
    return tools?.map((tool, index) => {
        const inputSchema = sanitizeJsonValue(tool.inputSchema);
        const inputSchemaJson = (0, json_1.safeStringify)(inputSchema);
        return {
            index,
            name: tool.name,
            description: tool.description,
            inputSchema,
            inputSchemaJsonChars: inputSchemaJson.length,
            inputSchemaHash: hashString(inputSchemaJson),
        };
    });
}
function summarizeMessages(messages) {
    const roleCounts = {};
    let textChars = 0;
    let dataBytes = 0;
    let toolCallParts = 0;
    let toolResultParts = 0;
    let dataParts = 0;
    let imageParts = 0;
    for (const message of messages) {
        roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1;
        textChars += message.contentTextChars;
        dataBytes += message.contentDataBytes;
        for (const part of flattenContentParts(message.contentParts)) {
            if (part.type === 'toolCall')
                toolCallParts += 1;
            if (part.type === 'toolResult')
                toolResultParts += 1;
            if (part.type === 'data') {
                dataParts += 1;
                if (part.isImage)
                    imageParts += 1;
            }
        }
    }
    return {
        messageCount: messages.length,
        roleCounts,
        textChars,
        dataBytes,
        toolCallParts,
        toolResultParts,
        dataParts,
        imageParts,
    };
}
function summarizeMessagesFromInput(messages) {
    return summarizeMessages(messages.map((message, index) => serializeMessage(message, index)));
}
function summarizeVscodeSystemPrompt(messages) {
    const message = messages[0];
    const customizations = summarizeVscodeCustomizations(messages);
    if (!message) {
        return createSystemPromptSummary(null, null, '', customizations);
    }
    return createSystemPromptSummary(0, formatRole(message.role), getVscodeMessageText(message), customizations);
}
function summarizeDeepSeekSystemPrompt(messages) {
    const message = messages[0];
    const customizations = summarizeDeepSeekCustomizations(messages);
    if (!message) {
        return createSystemPromptSummary(null, null, '', customizations);
    }
    return createSystemPromptSummary(0, message.role, message.content ?? '', customizations);
}
function createSystemPromptSummary(messageIndex, role, text, customizations) {
    return {
        messageIndex,
        role,
        chars: text.length,
        lines: countLines(text),
        hash: messageIndex === null ? null : hashString(text),
        headHash: messageIndex === null ? null : hashString(text.slice(0, HASH_WINDOW_CHARS)),
        tailHash: messageIndex === null ? null : hashString(text.slice(-HASH_WINDOW_CHARS)),
        hasInstructionsTag: text.includes('<instructions>'),
        hasSkillsTag: text.includes('<skills>'),
        hasAgentsTag: text.includes('<agents>'),
        skillTagCount: countLiteral(text, '<skill>'),
        agentTagCount: countLiteral(text, '<agent>'),
        ...customizations,
    };
}
function summarizeVscodeCustomizations(messages) {
    let customizationsUpdateCountInHistory = 0;
    let latestUserMessageIndex = null;
    let latestUserHasCustomizationsUpdate = false;
    for (const [index, message] of messages.entries()) {
        const text = getVscodeMessageText(message);
        customizationsUpdateCountInHistory += countLiteral(text, '<customizationsUpdate>');
        if (message.role === vscode_1.default.LanguageModelChatMessageRole.User) {
            latestUserMessageIndex = index;
            latestUserHasCustomizationsUpdate = text.includes('<customizationsUpdate>');
        }
    }
    return {
        customizationsUpdateCountInHistory,
        latestUserMessageIndex,
        latestUserHasCustomizationsUpdate,
    };
}
function summarizeDeepSeekCustomizations(messages) {
    let customizationsUpdateCountInHistory = 0;
    let latestUserMessageIndex = null;
    let latestUserHasCustomizationsUpdate = false;
    for (const [index, message] of messages.entries()) {
        const text = message.content ?? '';
        customizationsUpdateCountInHistory += countLiteral(text, '<customizationsUpdate>');
        if (message.role === 'user') {
            latestUserMessageIndex = index;
            latestUserHasCustomizationsUpdate = text.includes('<customizationsUpdate>');
        }
    }
    return {
        customizationsUpdateCountInHistory,
        latestUserMessageIndex,
        latestUserHasCustomizationsUpdate,
    };
}
function summarizeHostSettings() {
    return {
        copilotFreezeCustomizationsIndex: getBooleanSetting('github.copilot.chat', 'freezeCustomizationsIndex'),
    };
}
function getVscodeMessageText(message) {
    let text = '';
    for (const part of message.content) {
        if (part instanceof vscode_1.default.LanguageModelTextPart) {
            text += part.value;
        }
    }
    return text;
}
function getBooleanSetting(section, key) {
    const value = vscode_1.default.workspace.getConfiguration(section).get(key);
    return typeof value === 'boolean' ? value : 'unknown';
}
function summarizeTools(tools) {
    const toolNames = getToolNames(tools);
    const activateToolNames = getActivateToolNames(toolNames);
    return {
        toolCount: toolNames.length,
        toolNames,
        activateToolCount: activateToolNames.length,
        activateToolNames,
    };
}
function summarizeRequestOptions(options) {
    const modelOptions = sanitizeJsonValue(options.modelOptions);
    return {
        optionKeys: Object.keys(options).sort(),
        toolMode: formatToolMode(options.toolMode),
        modelOptions,
        modelOptionsKeys: getObjectKeys(modelOptions),
    };
}
function getObjectKeys(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return Object.keys(value).sort();
}
function getToolNames(tools) {
    return tools?.map((tool) => tool.name) ?? [];
}
function getActivateToolNames(toolNames) {
    return toolNames.filter((name) => name.startsWith(consts_2.ACTIVATE_TOOL_PREFIX));
}
function formatActivateToolNames(toolNames) {
    if (toolNames.length === 0) {
        return '';
    }
    const shown = toolNames.slice(0, 5).join(',');
    const suffix = toolNames.length > 5 ? `,+${toolNames.length - 5}` : '';
    return ` names=${shown}${suffix}`;
}
function getContentPartTextChars(part) {
    if (part.type === 'text')
        return part.chars;
    if (part.type === 'toolResult') {
        return part.contentParts.reduce((sum, item) => sum + getContentPartTextChars(item), 0);
    }
    return 0;
}
function getContentPartDataBytes(part) {
    if (part.type === 'data')
        return part.byteLength;
    if (part.type === 'toolResult') {
        return part.contentParts.reduce((sum, item) => sum + getContentPartDataBytes(item), 0);
    }
    return 0;
}
function flattenContentParts(parts) {
    const flattened = [];
    for (const part of parts) {
        flattened.push(part);
        if (part.type === 'toolResult') {
            flattened.push(...flattenContentParts(part.contentParts));
        }
    }
    return flattened;
}
function formatRole(role) {
    if (role === vscode_1.default.LanguageModelChatMessageRole.User)
        return 'user';
    if (role === vscode_1.default.LanguageModelChatMessageRole.Assistant)
        return 'assistant';
    if (role === consts_1.LANGUAGE_MODEL_CHAT_SYSTEM_ROLE)
        return 'system';
    return String(role);
}
function formatToolMode(mode) {
    if (mode === vscode_1.default.LanguageModelChatToolMode.Auto)
        return 'auto';
    if (mode === vscode_1.default.LanguageModelChatToolMode.Required)
        return 'required';
    return String(mode);
}
function sanitizeJsonValue(value) {
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(value, (_key, entryValue) => {
        if (typeof entryValue === 'string') {
            return (0, json_1.toWellFormedString)(entryValue);
        }
        if (typeof entryValue === 'bigint') {
            return `${entryValue.toString()}n`;
        }
        if (entryValue instanceof Uint8Array) {
            return {
                type: 'Uint8Array',
                byteLength: entryValue.byteLength,
                sha256: hashBytes(entryValue),
            };
        }
        if (entryValue && typeof entryValue === 'object') {
            if (seen.has(entryValue)) {
                return '[Circular]';
            }
            seen.add(entryValue);
        }
        return entryValue;
    }) ?? 'null');
}
function getConstructorName(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const constructorName = value.constructor?.name;
    return constructorName || undefined;
}
function hashString(value) {
    return (0, crypto_1.createHash)('sha256').update(value).digest('hex');
}
function hashBytes(value) {
    return (0, crypto_1.createHash)('sha256').update(value).digest('hex');
}
function countLines(value) {
    if (!value) {
        return 0;
    }
    return value.split('\n').length;
}
function countLiteral(value, literal) {
    if (!value || !literal) {
        return 0;
    }
    let count = 0;
    let index = 0;
    while (true) {
        index = value.indexOf(literal, index);
        if (index < 0) {
            break;
        }
        count += 1;
        index += literal.length;
    }
    return count;
}
async function writeJsonFile(filePath, value, stringify = json_1.safeStringify) {
    const content = stringify(value);
    await (0, promises_1.writeFile)(filePath, content, 'utf-8');
    return content;
}
async function writeTextFile(filePath, content) {
    await (0, promises_1.writeFile)(filePath, content, 'utf-8');
}
async function writeDumpObservation(globalStorageUri, observation) {
    const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
    await (0, promises_1.mkdir)(baseRoot, { recursive: true });
    await (0, promises_1.appendFile)((0, path_1.join)(baseRoot, REQUEST_OBSERVATIONS_FILE), `${(0, json_1.safeStringify)(observation)}\n`, 'utf-8');
}
function enqueueDumpWrite(label, write) {
    dumpWriteQueue = dumpWriteQueue.then(write, write).catch((err) => {
        logger_1.logger.warn(`${label} write failed`, err);
    });
}
function logProviderInputDump(options, paths, toolSummary) {
    const systemPromptSummary = summarizeVscodeSystemPrompt(options.messages);
    logger_1.logger.info(`providerInputDump written: ${formatDumpSegment(options.segment)}` +
        ` input=${paths.providerInput} ` +
        `(${options.messages.length} msgs, ${toolSummary.toolCount} tools, ` +
        `activateTools=${toolSummary.activateToolCount}${formatActivateToolNames(toolSummary.activateToolNames)}) ` +
        formatHostSettingsSummary(summarizeHostSettings()) +
        ` ${formatSystemPromptSummary(systemPromptSummary)}`);
}
function logRequestDump(request, options, paths, requestJsonLength) {
    const systemPromptSummary = summarizeDeepSeekSystemPrompt(request.messages);
    logger_1.logger.info(`requestDump written: ${formatDumpSegment(options.segment)}` +
        ` request=${paths.request} ` +
        `input=${paths.input} resolved=${paths.resolved} ` +
        `(${request.messages.length} msgs, ${request.tools?.length ?? 0} tools, ` +
        `~${(requestJsonLength / 1024).toFixed(0)} KB) ` +
        formatHostSettingsSummary(summarizeHostSettings()) +
        ` ${formatSystemPromptSummary(systemPromptSummary)}`);
}
function formatDumpSegment(segment) {
    if (segment.reason === 'markerFound') {
        return `dumpSegment=${segment.segmentId} legacySegmentMarker=found`;
    }
    if (segment.reason === 'markerInvalid') {
        const markerLocation = segment.markerMessageIndex === undefined || segment.markerPartIndex === undefined
            ? ''
            : ` at=message#${segment.markerMessageIndex}:part#${segment.markerPartIndex}`;
        const markerError = segment.markerError ? ` error=${segment.markerError}` : '';
        return `dumpSegment=${segment.segmentId} legacySegmentMarker=invalid${markerLocation}${markerError}`;
    }
    return `dumpSegment=${segment.segmentId}`;
}
function formatHostSettingsSummary(settings) {
    return `hostFreezeCustomizationsIndex=${settings.copilotFreezeCustomizationsIndex}`;
}
function formatSystemPromptSummary(summary) {
    if (summary.messageIndex === null) {
        return 'systemPrompt=none';
    }
    return (`systemPrompt#${summary.messageIndex}:${summary.role}` +
        `:chars=${summary.chars}` +
        `:lines=${summary.lines}` +
        `:hash=${formatShortHash(summary.hash)}` +
        `:skills=${formatBoolean(summary.hasSkillsTag)}(${summary.skillTagCount})` +
        `:agents=${formatBoolean(summary.hasAgentsTag)}(${summary.agentTagCount})` +
        `:customizationsUpdate=${summary.customizationsUpdateCountInHistory}` +
        `:latestUser#${summary.latestUserMessageIndex ?? 'none'}=` +
        formatBoolean(summary.latestUserHasCustomizationsUpdate));
}
function formatShortHash(value) {
    return value ? value.slice(0, 12) : 'none';
}
function formatBoolean(value) {
    return value ? 'yes' : 'no';
}
function getRequestDumpRoot(globalStorageUri, segment) {
    const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
    return segment ? (0, path_1.join)(baseRoot, segment.segmentId) : baseRoot;
}
function getRequestDumpBaseRoot(globalStorageUri) {
    return getRequestDumpBaseRootUri(globalStorageUri).fsPath;
}
function getRequestDumpBaseRootUri(globalStorageUri) {
    if (globalStorageUri.fsPath) {
        return vscode_1.default.Uri.joinPath(globalStorageUri, 'request-dumps');
    }
    return vscode_1.default.Uri.file((0, path_1.join)((0, os_1.tmpdir)(), 'deepseek-request-dumps'));
}
//# sourceMappingURL=dump.js.map