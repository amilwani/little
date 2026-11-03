import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { STATE_COOKIE, cookieOptions, slackConfigured } from "@/lib/slackServer";

// Sends the user to Slack to approve read-only search of their messages.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!(await auth())?.user) return NextResponse.redirect(`${origin}/`);
  if (!slackConfigured()) return NextResponse.redirect(`${origin}/inbox?error=setup`);
  const state = crypto.randomUUID();
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID!);
  url.searchParams.set("user_scope", "search:read");
  url.searchParams.set("redirect_uri", `${origin}/api/slack/callback`);
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(600));
  return res;
}
