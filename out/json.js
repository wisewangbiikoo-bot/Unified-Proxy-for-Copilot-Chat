"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeStringify = safeStringify;
exports.toWellFormedString = toWellFormedString;
const REPLACEMENT_CHARACTER = '\uFFFD';
const LONE_SURROGATE_PATTERN = /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g;
function safeStringify(value) {
    const json = JSON.stringify(value, (_key, entryValue) => {
        if (typeof entryValue === 'string') {
            return toWellFormedString(entryValue);
        }
        return entryValue;
    });
    if (json === undefined) {
        throw new TypeError('Value cannot be serialized as JSON');
    }
    return json;
}
function toWellFormedString(value) {
    const toWellFormed = value.toWellFormed;
    if (typeof toWellFormed === 'function') {
        return toWellFormed.call(value);
    }
    return value.replace(LONE_SURROGATE_PATTERN, (_match, pair) => pair ? pair : REPLACEMENT_CHARACTER);
}
//# sourceMappingURL=json.js.map