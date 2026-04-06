import { Command } from "commander";
import { acceptConsent, consentText, getConsentState } from "../../config/consent";

export function buildConsentCommand(): Command {
  const cmd = new Command("consent");

  cmd
    .description("Show or accept legal consent")
    .option("--accept", "Accept and persist legal consent")
    .action(async (options: { accept?: boolean }) => {
      console.log(consentText);

      if (options.accept) {
        await acceptConsent();
        console.log("Consent accepted and stored.");
        return;
      }

      const state = await getConsentState();
      console.log(`Consent accepted: ${state.accepted ? "yes" : "no"}`);
      if (state.acceptedAt) {
        console.log(`Accepted at: ${state.acceptedAt}`);
      }
    });

  return cmd;
}
