"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.consentText = void 0;
exports.getConsentState = getConsentState;
exports.acceptConsent = acceptConsent;
exports.assertConsent = assertConsent;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
// Consent state lives in ~/.musicer/consent.json by default. Set MUSICER_HOME
// to override the directory (useful when a web server such as PHP/httpd runs
// as a different user whose home dir is unset or read-only — e.g. /srv/http
// on Arch/CachyOS — and needs to share state with the CLI).
const baseDir = process.env.MUSICER_HOME
    ? node_path_1.default.resolve(process.env.MUSICER_HOME)
    : node_path_1.default.join(node_os_1.default.homedir(), ".musicer");
const consentFile = node_path_1.default.join(baseDir, "consent.json");
const defaultState = {
    accepted: false,
};
exports.consentText = `WARNING: This tool is for personal use only.\nDownloading content may violate platform Terms of Service and local laws.\nYou are solely responsible for how you use this software.`;
async function getConsentState() {
    try {
        const raw = await node_fs_1.promises.readFile(consentFile, "utf8");
        const parsed = JSON.parse(raw);
        return { ...defaultState, ...parsed };
    }
    catch {
        return defaultState;
    }
}
async function acceptConsent() {
    await node_fs_1.promises.mkdir(baseDir, { recursive: true });
    const nextState = {
        accepted: true,
        acceptedAt: new Date().toISOString(),
    };
    await node_fs_1.promises.writeFile(consentFile, JSON.stringify(nextState, null, 2), "utf8");
}
// Consent gate is disabled: downloads proceed without requiring a stored
// consent acceptance. The `consent` command and consent.json are kept for
// backward compatibility but no longer block any operation.
async function assertConsent() {
    return;
}
