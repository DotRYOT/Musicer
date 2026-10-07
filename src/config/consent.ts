import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

interface ConsentState {
  accepted: boolean;
  acceptedAt?: string;
}

// Consent state lives in ~/.musicer/consent.json by default. Set MUSICER_HOME
// to override the directory (useful when a web server such as PHP/httpd runs
// as a different user whose home dir is unset or read-only — e.g. /srv/http
// on Arch/CachyOS — and needs to share state with the CLI).
const baseDir = process.env.MUSICER_HOME
  ? path.resolve(process.env.MUSICER_HOME)
  : path.join(os.homedir(), ".musicer");
const consentFile = path.join(baseDir, "consent.json");

const defaultState: ConsentState = {
  accepted: false,
};

export const consentText = `WARNING: This tool is for personal use only.\nDownloading content may violate platform Terms of Service and local laws.\nYou are solely responsible for how you use this software.`;

export async function getConsentState(): Promise<ConsentState> {
  try {
    const raw = await fs.readFile(consentFile, "utf8");
    const parsed = JSON.parse(raw) as ConsentState;
    return { ...defaultState, ...parsed };
  } catch {
    return defaultState;
  }
}

export async function acceptConsent(): Promise<void> {
  await fs.mkdir(baseDir, { recursive: true });
  const nextState: ConsentState = {
    accepted: true,
    acceptedAt: new Date().toISOString(),
  };
  await fs.writeFile(consentFile, JSON.stringify(nextState, null, 2), "utf8");
}

// Consent gate is disabled: downloads proceed without requiring a stored
// consent acceptance. The `consent` command and consent.json are kept for
// backward compatibility but no longer block any operation.
export async function assertConsent(): Promise<void> {
  return;
}
