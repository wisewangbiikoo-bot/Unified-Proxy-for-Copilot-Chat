"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamChatCompletion = streamChatCompletion;
const vscode_1 = __importDefault(require("vscode"));
const logger_1 = require("../logger");
const diagnostics_1 = require("./diagnostics");
const replay_1 = require("./replay");
const COPILOT_USAGE_DATA_PART_MIME = 'usage';
function streamChatCompletion({ prepared, progress, token, initialResponseNotice, getCharsPerToken, setCharsPerToken, }) {
    const state = {
        accumulatedReasoning: '',
        emittedToolCallIds: [],
        initialResponseNoticeReported: false,
        replayMarkerReported: false,
    };
    const cancelListener = (0, diagnostics_1.observeCancellationToken)(token, prepared.cacheDiagnostics);
    return prepared.client
        .streamChatCompletion(prepared.request, {
        onContent: (content) => {
            reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
            progress.report(new vscode_1.default.LanguageModelTextPart(content));
        },
        onThinking: (text) => {
            reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
            handleThinking(text, state, progress);
        },
        onToolCall: (toolCall) => {
            reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
            handleToolCall(toolCall, state, progress);
        },
        onError: (error) => {
            logger_1.logger.error(`Stream error for ${prepared.request?.model || '?'}: ${error?.message || error}`);
            throw error;
        },
        onDone: () => {
            reportReplayMarkerOnce(prepared, progress, state, 'done');
            finalizeReplayDiagnostics(prepared.trailingToolResultIds, state, prepared.cacheDiagnostics);
        },
        onUsage: (usage) => {
            const charsPerToken = updateCharsPerToken(prepared.totalRequestChars, usage, getCharsPerToken());
            setCharsPerToken(charsPerToken);
            prepared.cacheDiagnostics.onUsage(usage, charsPerToken);
            try {
                reportCopilotContextUsage(progress, usage);
            } catch (e) {
                logger_1.logger.warn('Failed to report usage to Copilot context', e);
            }
        },
    }, token)
        .then(undefined, (error) => {
        reportSkippedReplayMarkerIfNeeded(prepared, state, token.isCancellationRequested ? 'cancelled' : 'stream-error', error);
        throw error;
    })
        .then(() => {
        if (token.isCancellationRequested) {
            reportSkippedReplayMarkerIfNeeded(prepared, state, 'cancelled');
        }
    })
        .finally(() => {
        cancelListener.dispose();
    });
}
function reportInitialResponseNoticeOnce(progress, state, initialResponseNotice) {
    if (!initialResponseNotice || state.initialResponseNoticeReported) {
        return;
    }
    state.initialResponseNoticeReported = true;
    progress.report(new vscode_1.default.LanguageModelTextPart(initialResponseNotice));
}
function reportReplayMarkerOnce(prepared, progress, state, trigger) {
    if (state.replayMarkerReported) {
        return;
    }
    state.replayMarkerReported = true;
    reportReplayMarker(prepared, progress, state, trigger);
}
function reportSkippedReplayMarkerIfNeeded(prepared, state, reason, error) {
    if (state.replayMarkerReported) {
        return;
    }
    state.replayMarkerReported = true;
    prepared.cacheDiagnostics.onReplayMarkerReport({
        status: 'skipped',
        reason,
        visionTextChars: prepared.visionMarkerTextChars,
        reasoningTextChars: state.accumulatedReasoning.length || undefined,
        error,
    });
}
function reportReplayMarker(prepared, progress, state, trigger) {
    const metadata = getReplayMarkerMetadata(prepared, state);
    if (!(0, replay_1.hasReplayMarkerMetadata)(metadata)) {
        prepared.cacheDiagnostics.onReplayMarkerReport({
            status: 'skipped',
            trigger,
            reason: 'no-replay-data',
            visionTextChars: prepared.visionMarkerTextChars,
            reasoningTextChars: state.accumulatedReasoning.length || undefined,
        });
        return;
    }
    try {
        const markerPart = (0, replay_1.createReplayMarkerPart)(metadata);
        progress.report(markerPart);
        prepared.cacheDiagnostics.onReplayMarkerReport({
            status: 'reported',
            trigger,
            markerBytes: markerPart.data.byteLength,
            visionTextChars: prepared.visionMarkerTextChars,
            reasoningTextChars: state.accumulatedReasoning.length || undefined,
        });
    }
    catch (error) {
        prepared.cacheDiagnostics.onReplayMarkerReport({
            status: 'failed',
            trigger,
            visionTextChars: prepared.visionMarkerTextChars,
            reasoningTextChars: state.accumulatedReasoning.length || undefined,
            error,
        });
        logger_1.logger.warn('Failed to report replay marker', error);
    }
}
function getReplayMarkerMetadata(prepared, state) {
    return {
        ...prepared.replayMarkerMetadata,
        reasoningText: state.accumulatedReasoning || undefined,
    };
}
function handleThinking(text, state, progress) {
    const cleaned = stripGemmaChannelLeaksForStream(text);
    if (!cleaned.trim()) {
        return;
    }
    state.accumulatedReasoning += cleaned;
    // LanguageModelThinkingPart is a proposed API; the project root augmentation provides types.
    progress.report(new vscode_1.default.LanguageModelThinkingPart(cleaned));
}
function stripGemmaChannelLeaksForStream(text) {
    if (!text) {
        return "";
    }
    return text
        .replace(/<\|channel>thought[\s\S]*?<\|channel\|>/gi, "")
        .replace(/(?:<\|channel>thought|thought\s*<\|channel\|>|thought\s*<\|channel>)/gi, "")
        .replace(/<\|channel\|>|<\|channel>/gi, "");
}
function handleToolCall(toolCall, state, progress) {
    state.emittedToolCallIds.push(toolCall.id);
    try {
        const args = JSON.parse(toolCall.function.arguments);
        progress.report(new vscode_1.default.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args));
    }
    catch {
        progress.report(new vscode_1.default.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {}));
    }
}
function finalizeReplayDiagnostics(trailingToolResultIds, state, cacheDiagnostics) {
    cacheDiagnostics.onDone({
        reasoningTextChars: state.accumulatedReasoning.length,
        emittedToolCalls: state.emittedToolCallIds.length,
        trailingToolResults: trailingToolResultIds.length,
    });
}
function updateCharsPerToken(totalRequestChars, usage, charsPerToken) {
    if (totalRequestChars > 0 && usage.prompt_tokens > 0) {
        const observedRatio = totalRequestChars / usage.prompt_tokens;
        return charsPerToken * 0.7 + observedRatio * 0.3;
    }
    return charsPerToken;
}
function reportCopilotContextUsage(progress, usage) {
    const data = {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        prompt_tokens_details: {
            cached_tokens: usage.prompt_cache_hit_tokens ?? 0,
        },
    };
    progress.report(new vscode_1.default.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(data)), COPILOT_USAGE_DATA_PART_MIME));
}
//# sourceMappingURL=stream.js.map