// Note templates. Each one gives the user a starting outline for their own
// notes while recording (works without an AI key), and tells the AI which
// sections to write.

export type TemplateId = "general" | "one-on-one" | "walkthrough" | "review" | "brainstorm" | "decision";

export type Template = {
  id: TemplateId;
  name: string;
  emoji: string;
  blurb: string;
  /** Headings pre-filled in "My notes". */
  outline: string;
  /** The Markdown sections the AI should write, in order. */
  aiSections: string;
};

const ACTIONS = `## Action items
A task list using "- [ ] " items, each with the owner's name in bold when the transcript names one, and a due date when one was mentioned. Write "- None mentioned" if there are none.`;

export const TEMPLATES: Template[] = [
  {
    id: "general",
    name: "General meeting",
    emoji: "📝",
    blurb: "Summary, key points, action items",
    outline: "",
    aiSections: `## Summary
Two to four sentences on what the meeting was about and what came out of it.
## Key points
Short bullet points.
${ACTIONS}
## Decisions
Bullet points, only if decisions were made; otherwise leave this section out.`,
  },
  {
    id: "one-on-one",
    name: "1:1",
    emoji: "🤝",
    blurb: "Updates, wins, blockers, feedback, follow-ups",
    outline: "## Updates\n\n## Blockers\n\n## Feedback\n\n## Follow-ups\n",
    aiSections: `## Summary
Two or three sentences on how the 1:1 went.
## Updates and wins
Bullet points.
## Blockers and concerns
Bullet points, with who raised each one.
## Feedback
Feedback given in either direction, only if any; otherwise leave this section out.
## Career and growth
Only if discussed; otherwise leave this section out.
${ACTIONS}`,
  },
  {
    id: "walkthrough",
    name: "Process walkthrough",
    emoji: "🧭",
    blurb: "Step by step guide, tools, tips, open questions",
    outline: "## Steps\n1. \n\n## Questions\n",
    aiSections: `## Purpose
One or two sentences on what the process is for and when it is used.
## Steps
A numbered list of the steps in order, as someone could follow them. Include the tool, screen or person used at each step when mentioned.
## Inputs and outputs
What the process needs to start and what it produces, if mentioned.
## Tips and gotchas
Bullet points on warnings, exceptions and shortcuts mentioned.
## Open questions
Bullet points on anything left unclear, if any; otherwise leave this section out.
${ACTIONS}`,
  },
  {
    id: "review",
    name: "Review meeting",
    emoji: "📊",
    blurb: "Progress, metrics, what went well, risks",
    outline: "## Progress\n\n## Risks\n\n## Next steps\n",
    aiSections: `## Summary
Two to four sentences on the overall status.
## Progress against goals
Bullet points; include every number, metric and date mentioned.
## What went well
Bullet points.
## What didn't go well
Bullet points.
## Risks and issues
Bullet points, with owners when named.
${ACTIONS}
## Decisions
Bullet points, only if decisions were made; otherwise leave this section out.`,
  },
  {
    id: "brainstorm",
    name: "Brainstorming",
    emoji: "💡",
    blurb: "Every idea, grouped into themes, favourites",
    outline: "## Problem\n\n## Ideas\n- \n",
    aiSections: `## The question
One or two sentences on the problem the group was solving.
## Ideas by theme
Group every idea mentioned under short "### Theme" sub-headings, as bullet points, crediting who suggested it when named. Keep every idea, even small ones.
## Favourites
The ideas the group liked most or chose to explore, if any were picked; otherwise leave this section out.
## Open questions
Bullet points, if any; otherwise leave this section out.
${ACTIONS}`,
  },
  {
    id: "decision",
    name: "Decision making",
    emoji: "⚖️",
    blurb: "Options, pros and cons, the decision and why",
    outline: "## Decision needed\n\n## Options\n\n## Decision\n",
    aiSections: `## Decision needed
One or two sentences on the question being decided.
## Options considered
For each option a "### Option" sub-heading with "Pros:" and "Cons:" bullet points as discussed.
## Decision
What was decided and by whom, or "No decision yet" if none was made.
## Why
Bullet points on the reasons given.
## Risks and what would change our mind
Only if discussed; otherwise leave this section out.
${ACTIONS}`,
  },
];

export function getTemplate(id: string | undefined): Template {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
