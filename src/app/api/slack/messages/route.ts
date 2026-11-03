import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { SLACK_COOKIE, readSlack, slackConfigured } from "@/lib/slackServer";
import { MAX_PAGES, toMessages, type Match } from "@/lib/slackParse";

// Finds recent Slack messages that matter to the user: their DMs, messages that
// @mention them, and things they said themselves (where promises live).
export async function GET(req: NextRequest) {
  const email = (await auth())?.user?.email;
  if (!email) return NextResponse.json({ error: "signed-out" }, { status: 401 });
  if (!slackConfigured()) return NextResponse.json({ connected: false, configured: false });
  const s = await readSlack();
  if (!s || s.owner !== email) {
    const res = NextResponse.json({ connected: false, configured: true });
    if (s) res.cookies.delete(SLACK_COOKIE);
    return res;
  }

  const days = Math.min(7, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 2));
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const matches: Match[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch("https://slack.com/api/search.messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}` },
      body: new URLSearchParams({
        query: `after:${since}`,
        sort: "timestamp",
        sort_dir: "desc",
        count: "100",
        page: String(page),
        highlight: "false",
      }),
    });
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      messages?: { matches?: Match[]; paging?: { pages?: number } };
    };
    if (!data.ok) {
      if (data.error === "invalid_auth" || data.error === "token_revoked" || data.error === "account_inactive") {
        const res = NextResponse.json({ connected: false, configured: true, error: "Slack signed you out. Connect again." });
        res.cookies.delete(SLACK_COOKIE);
        return res;
      }
      if (data.error === "ratelimited" || r.status === 429) {
        return NextResponse.json({ error: "Slack asked us to slow down. Try again in a minute." }, { status: 429 });
      }
      return NextResponse.json({ error: `Slack returned an error (${data.error ?? r.status}).` }, { status: 502 });
    }
    matches.push(...(data.messages?.matches ?? []));
    if (page >= (data.messages?.paging?.pages ?? 1)) break;
  }

  const messages = toMessages(matches, s.userId);

  return NextResponse.json({ connected: true, configured: true, team: s.team, messages });
}
