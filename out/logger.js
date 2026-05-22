"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const vscode_1 = __importDefault(require("vscode"));
let channel;
function getChannel() {
    if (!channel) {
        channel = vscode_1.default.window.createOutputChannel('Unified Proxy Copilot');
    }
    return channel;
}
function ts() {
    return new Date().toISOString().slice(11, 23);
}
function write(level, args) {
    const text = args
        .map((a) => {
        if (typeof a === 'string')
            return a;
        if (a instanceof Error)
            return a.stack ?? a.message;
        try {
            return JSON.stringify(a);
        }
        catch {
            return String(a);
        }
    })
        .join(' ');
    getChannel().appendLine(`[${ts()}] [${level}] ${text}`);
}
exports.logger = {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    debug: (...args) => write('debug', args),
    show: () => getChannel().show(),
    dispose: () => {
        channel?.dispose();
        channel = undefined;
    },
};
//# sourceMappingURL=logger.js.map