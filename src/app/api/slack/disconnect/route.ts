import { NextResponse } from "next/server";
import { SLACK_COOKIE, readSlack } from "@/lib/slackServer";

// Revokes the token at Slack (best effort) and forgets it.
export async function POST() {
  const s = await readSlack();
  if (s) {
    await fetch("https://slack.com/api/auth.revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}` },
    }).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SLACK_COOKIE);
  return res;
}
