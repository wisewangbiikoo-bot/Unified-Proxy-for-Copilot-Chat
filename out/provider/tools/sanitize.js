"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeToolsForUpstream = sanitizeToolsForUpstream;
/** JSON Schema keywords that break some OpenAI-compatible proxies (e.g. Kiro / Bedrock). */
const STRIP_KEYS = new Set([
    "$schema",
    "$id",
    "$ref",
    "$defs",
    "definitions",
    "patternProperties",
    "unevaluatedProperties",
    "const",
    "not",
    "if",
    "then",
    "else",
    "prefixItems",
]);
const COMPOSITE_KEYS = ["anyOf", "oneOf", "allOf"];
const MAX_SCHEMA_DEPTH = 32;
const MAX_DESCRIPTION_LEN = 8192;
const MAX_PROPERTY_DESC_LEN = 2048;
const MAX_PROPERTIES = 128;
const MAX_REQUIRED = 64;
/**
 * Normalize Copilot/VS Code tool definitions for upstream APIs.
 * Fixes tools with missing `parameters` (Kiro returns HTTP 200 + empty SSE).
 */
function sanitizeToolsForUpstream(tools) {
    if (!tools?.length) {
        return tools;
    }
    return tools.map((tool) => sanitizeTool(tool));
}
function sanitizeTool(tool) {
    if (!tool || tool.type !== "function" || !tool.function) {
        return tool;
    }
    const fn = { ...tool.function };
    if (typeof fn.description === "string" &&
        fn.description.length > MAX_DESCRIPTION_LEN) {
        fn.description = fn.description.slice(0, MAX_DESCRIPTION_LEN);
    }
    fn.parameters = sanitizeParameters(fn.parameters);
    return { type: "function", function: fn };
}
function sanitizeParameters(params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
        return { type: "object", properties: {} };
    }
    if (params.type !== "object") {
        return { type: "object", properties: {} };
    }
    return sanitizeSchemaNode(params, 0);
}
function sanitizeSchemaNode(node, depth) {
    if (depth > MAX_SCHEMA_DEPTH) {
        return { type: "string" };
    }
    if (!node || typeof node !== "object") {
        return { type: "string" };
    }
    if (Array.isArray(node)) {
        return node.map((item) => sanitizeSchemaNode(item, depth + 1));
    }
    for (const key of COMPOSITE_KEYS) {
        if (Array.isArray(node[key]) && node[key].length > 0) {
            const branch = node[key].find((b) => b && typeof b === "object" && b.type !== "null") ?? node[key][0];
            const merged = { ...node };
            for (const ck of COMPOSITE_KEYS) {
                delete merged[ck];
            }
            if (branch && typeof branch === "object") {
                Object.assign(merged, branch);
            }
            return sanitizeSchemaNode(merged, depth);
        }
    }
    const out = {};
    if (typeof node.type === "string") {
        out.type = node.type;
    }
    if (Array.isArray(node.enum)) {
        out.enum = node.enum.slice(0, 64);
    }
    if (typeof node.description === "string") {
        out.description = node.description.slice(0, MAX_PROPERTY_DESC_LEN);
    }
    if (Array.isArray(node.required)) {
        out.required = node.required
            .filter((name) => typeof name === "string")
            .slice(0, MAX_REQUIRED);
    }
    if (node.properties && typeof node.properties === "object" && !Array.isArray(node.properties)) {
        out.properties = {};
        const entries = Object.entries(node.properties).slice(0, MAX_PROPERTIES);
        for (const [name, schema] of entries) {
            out.properties[name] = sanitizeSchemaNode(schema, depth + 1);
        }
    }
    if (node.type === "array" && node.items) {
        out.items = sanitizeSchemaNode(node.items, depth + 1);
    }
    for (const [key, value] of Object.entries(node)) {
        if (STRIP_KEYS.has(key) || COMPOSITE_KEYS.includes(key)) {
            continue;
        }
        if (key in out ||
            key === "properties" ||
            key === "items" ||
            key === "required" ||
            key === "description" ||
            key === "enum" ||
            key === "type") {
            continue;
        }
        if (key === "additionalProperties") {
            if (value === false) {
                out.additionalProperties = false;
            }
            continue;
        }
        if (typeof value === "object" && value !== null) {
            out[key] = sanitizeSchemaNode(value, depth + 1);
        }
        else if (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean") {
            out[key] = value;
        }
    }
    if (!out.type) {
        if (out.properties) {
            out.type = "object";
        }
        else if (out.enum) {
            out.type = "string";
        }
        else if (out.items) {
            out.type = "array";
        }
        else {
            out.type = "string";
        }
    }
    if (out.type === "object" && !out.properties) {
        out.properties = {};
    }
    return out;
}
