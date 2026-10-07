"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConsentCommand = buildConsentCommand;
const commander_1 = require("commander");
const consent_1 = require("../../config/consent");
function buildConsentCommand() {
    const cmd = new commander_1.Command("consent");
    cmd
        .description("Show or accept legal consent")
        .option("--accept", "Accept and persist legal consent")
        .action(async (options) => {
        console.log(consent_1.consentText);
        if (options.accept) {
            await (0, consent_1.acceptConsent)();
            console.log("Consent accepted and stored.");
            return;
        }
        const state = await (0, consent_1.getConsentState)();
        console.log(`Consent accepted: ${state.accepted ? "yes" : "no"}`);
        if (state.acceptedAt) {
            console.log(`Accepted at: ${state.acceptedAt}`);
        }
    });
    return cmd;
}
