import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { SLACK_COOKIE, STATE_COOKIE, cookieOptions, seal, slackConfigured } from "@/lib/slackServer";

// Slack sends the user back here with a one-time code, which we swap for their token.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/inbox?${q}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };
  const owner = (await auth())?.user?.email;
  if (!owner) return NextResponse.redirect(`${origin}/`);
  if (!slackConfigured()) return back("error=setup");
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back("error=denied");
  const state = req.cookies.get(STATE_COOKIE)?.value;
  if (!state || state !== params.get("state")) return back("error=state");

  const body = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    client_secret: process.env.SLACK_CLIENT_SECRET!,
    code: params.get("code") ?? "",
    redirect_uri: `${origin}/api/slack/callback`,
  });
  const r = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", body });
  const data = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    authed_user?: { id?: string; access_token?: string };
    team?: { name?: string };
  };
  const token = data.authed_user?.access_token;
  if (!data.ok || !token || !data.authed_user?.id) return back("error=exchange");

  const res = back("connected=1");
  res.cookies.set(
    SLACK_COOKIE,
    await seal({ token, userId: data.authed_user.id, team: data.team?.name ?? "Slack", owner }),
    cookieOptions(60 * 60 * 24 * 365),
  );
  return res;
}
