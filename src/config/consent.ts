import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

interface ConsentState {
  accepted: boolean;
  acceptedAt?: string;
}

const baseDir = path.join(os.homedir(), ".musicer");
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

export async function assertConsent(): Promise<void> {
  const state = await getConsentState();
  if (!state.accepted) {
    throw new Error(
      "Legal consent has not been accepted. Run 'musicer consent --accept' first."
    );
  }
}
