"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
const configuredLevel = (process.env.LOG_LEVEL || "info").toLowerCase();
const shouldLog = (level) => {
    return ORDER[level] >= (ORDER[configuredLevel] ?? ORDER.info);
};
const stamp = () => new Date().toISOString();
exports.logger = {
    debug: (...args) => {
        if (shouldLog("debug")) {
            console.debug(`[${stamp()}] [DEBUG]`, ...args);
        }
    },
    info: (...args) => {
        if (shouldLog("info")) {
            console.info(`[${stamp()}] [INFO]`, ...args);
        }
    },
    warn: (...args) => {
        if (shouldLog("warn")) {
            console.warn(`[${stamp()}] [WARN]`, ...args);
        }
    },
    error: (...args) => {
        if (shouldLog("error")) {
            console.error(`[${stamp()}] [ERROR]`, ...args);
        }
    },
};
