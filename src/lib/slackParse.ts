import type { SlackMessage } from "./slack";

// Pure helpers for the Slack search results, kept apart from the route so they're easy to test.

export type Match = {
  ts: string;
  text?: string;
  user?: string;
  username?: string;
  permalink?: string;
  channel?: { id?: string; name?: string; is_im?: boolean; is_mpim?: boolean };
};

export const MAX_PAGES = 3;

/** Turns Slack's markup (<@U1>, <#C1|name>, <url|label>, &amp;) into plain text. */
export function plain(text: string, names: Map<string, string>, me: string) {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id: string, label?: string) =>
      id === me ? "@you" : `@${label ?? names.get(id) ?? "someone"}`,
    )
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<!(here|channel|everyone)[^>]*>/g, "@$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Keeps what matters to the user (DMs, @mentions, their own messages) as plain text. */
export function toMessages(matches: Match[], me: string): SlackMessage[] {
  const names = new Map<string, string>();
  for (const m of matches) if (m.user && m.username) names.set(m.user, m.username);
  return matches
    .filter((m) => m.text?.trim())
    .filter((m) => {
      const dm = !!(m.channel?.is_im || m.channel?.is_mpim);
      return dm || m.user === me || (m.text ?? "").includes(`<@${me}`);
    })
    .slice(0, 150)
    .map((m) => {
      const dm = !!(m.channel?.is_im || m.channel?.is_mpim);
      return {
        id: `${m.channel?.id ?? "?"}:${m.ts}`,
        at: new Date(Number(m.ts) * 1000).toISOString(),
        from: m.user === me ? "you" : (m.username ?? names.get(m.user ?? "") ?? "someone"),
        fromMe: m.user === me,
        where: dm ? (m.channel?.is_mpim ? "Group DM" : "DM") : `#${m.channel?.name ?? "channel"}`,
        dm,
        text: plain(m.text ?? "", names, me).slice(0, 1200),
        link: m.permalink,
      };
    });
}
