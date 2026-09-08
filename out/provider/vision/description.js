"use strict";
/**
 * Shared lazy vision describer session (ported from DeepSeek V4 0.8.2 #261).
 * One describer is reused for user-tail images and tool-result images in a request.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVisionDescriptionSession = createVisionDescriptionSession;
const json_1 = require("../../json");
const logger_1 = require("../../logger");
const consts_1 = require("./consts");
const model_1 = require("./model");

/**
 * @param {object} stats
 * @param {import('vscode').CancellationToken} token
 * @param {() => Promise<{ id?: string, source?: string, describe: Function }|undefined>} getDescriber
 */
function createVisionDescriptionSession(stats, token, getDescriber) {
    let describerPromise;
    let describer;
    let missingVisionProxy = false;
    let failureNotice;
    const resolveDescriber = async () => {
        if (token?.isCancellationRequested) {
            return undefined;
        }
        describerPromise ??= getDescriber();
        describer = await describerPromise;
        if (!describer && !token?.isCancellationRequested && !missingVisionProxy) {
            missingVisionProxy = true;
            logger_1.logger.warn("[vision] no vision describer available");
        }
        return describer;
    };
    return {
        async describe(images, owner) {
            const currentDescriber = await resolveDescriber();
            if (!currentDescriber || token?.isCancellationRequested) {
                stats.unavailableImageMessages += 1;
                recordImageOutcome(stats, owner, images.length, "dropped");
                return consts_1.IMAGE_DESCRIPTION_UNAVAILABLE;
            }
            try {
                const description = await currentDescriber.describe({
                    prompt: (0, model_1.getVisionPrompt)(),
                    images,
                    token,
                });
                if (!description || description.length === 0) {
                    stats.failedImageMessages += 1;
                    recordImageOutcome(stats, owner, images.length, "dropped");
                    failureNotice ??=
                        "[Vision Proxy] Empty image description. Falling back to a placeholder.";
                    return consts_1.IMAGE_DESCRIPTION_UNAVAILABLE;
                }
                stats.generatedImageMessages += 1;
                recordImageOutcome(stats, owner, images.length, "forwarded");
                return (0, json_1.toWellFormedString)(
                    consts_1.IMAGE_DESCRIPTION_PREFIX + description + consts_1.IMAGE_DESCRIPTION_SUFFIX,
                );
            }
            catch (error) {
                if (token?.isCancellationRequested) {
                    stats.unavailableImageMessages += 1;
                    recordImageOutcome(stats, owner, images.length, "dropped");
                    return consts_1.IMAGE_DESCRIPTION_UNAVAILABLE;
                }
                logger_1.logger.error("[vision] describe failed:", error);
                stats.failedImageMessages += 1;
                recordImageOutcome(stats, owner, images.length, "dropped");
                failureNotice ??=
                    "[Vision Proxy] Image description failed. Falling back to a placeholder.";
                return consts_1.IMAGE_DESCRIPTION_UNAVAILABLE;
            }
        },
        getMetadata() {
            return {
                visionModelId: describer?.id,
                visionProxySource: describer?.source,
                initialResponseNotice: missingVisionProxy
                    ? "[Vision Proxy] No vision model/endpoint configured; image attachments were not described."
                    : failureNotice,
            };
        },
    };
}

function recordImageOutcome(stats, owner, imageParts, outcome) {
    if (!stats[owner]) {
        stats[owner] = { forwardedImageParts: 0, droppedImageParts: 0 };
    }
    const field = outcome === "forwarded" ? "forwardedImageParts" : "droppedImageParts";
    stats[owner][field] += imageParts;
    if (outcome === "dropped") {
        stats.droppedImageParts = (stats.droppedImageParts || 0) + imageParts;
    }
}
