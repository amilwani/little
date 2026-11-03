import { cookies } from "next/headers";

// The Slack token lives only in an encrypted, httpOnly cookie on the user's device.
// Little has no database, so nothing about their Slack is stored anywhere else.

export const SLACK_COOKIE = "little_slack";
export const STATE_COOKIE = "little_slack_state";

/** `owner` is the Google account that connected it, so a shared device never shows one person's Slack to another. */
export type SlackSession = { token: string; userId: string; team: string; owner: string };

async function key() {
  const secret = process.env.AUTH_SECRET ?? "";
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`little-slack:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

export async function seal(data: SlackSession) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(data)));
  return `${b64(iv)}.${b64(new Uint8Array(enc))}`;
}

export async function unseal(value: string | undefined): Promise<SlackSession | null> {
  if (!value) return null;
  try {
    const [iv, body] = value.split(".");
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(body));
    return JSON.parse(new TextDecoder().decode(dec));
  } catch {
    return null;
  }
}

export async function readSlack() {
  return unseal((await cookies()).get(SLACK_COOKIE)?.value);
}

export const slackConfigured = () => !!process.env.SLACK_CLIENT_ID && !!process.env.SLACK_CLIENT_SECRET;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
