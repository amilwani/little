// AI features. Calls run on Google's servers with the user's own key, straight to
// Google (Gemini), OpenAI or Anthropic (Claude). Keys never leave this user's
// private properties.

const MODELS = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-5-mini',
  openaiTranscribe: 'whisper-1',
  anthropic: 'claude-opus-5-5',
};
const PROVIDER_NAMES = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' };
const GEMINI_MAX_BYTES = 14 * 1024 * 1024;
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;

// ---- Meeting templates ------------------------------------------------------------

const TEMPLATE_ACTIONS = `## Action items
A task list using "- [ ] " items, each with the owner's name in bold when the transcript names one, and a due date when one was mentioned. Write "- None mentioned" if there are none.`;

const TEMPLATES = [
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
${TEMPLATE_ACTIONS}
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
${TEMPLATE_ACTIONS}`,
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
${TEMPLATE_ACTIONS}`,
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
${TEMPLATE_ACTIONS}
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
${TEMPLATE_ACTIONS}`,
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
${TEMPLATE_ACTIONS}`,
  },
];

function getTemplate_(id) {
  return TEMPLATES.filter(function (t) { return t.id === id; })[0] || TEMPLATES[0];
}

// ---- Choosing a provider ---------------------------------------------------------

function pickTextAi_() {
  const s = getSettings_();
  if (s.aiProvider && getKey_(s.aiProvider)) return { provider: s.aiProvider, apiKey: getKey_(s.aiProvider) };
  const p = PROVIDERS.filter(function (x) { return getKey_(x); })[0];
  if (!p) throw new Error('NEED_KEY: Add a free Gemini key in Settings to use AI.');
  return { provider: p, apiKey: getKey_(p) };
}

/** Claude can't take audio, so only Gemini or OpenAI. */
function pickTranscriber_() {
  const s = getSettings_();
  const order = s.aiProvider === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai'];
  const p = order.filter(function (x) { return getKey_(x); })[0];
  if (!p) throw new Error('NEED_KEY: AI transcripts need a Gemini or OpenAI key. Add one in Settings.');
  return { provider: p, apiKey: getKey_(p) };
}

function languageForAi_(code) {
  const l = LANGUAGES.filter(function (x) { return x.code === code; })[0] || LANGUAGES[0];
  return l.code === 'en-IN' ? 'English' : l.name + ' (write it in ' + l.script + ' script; keep English words as spoken)';
}

function friendlyError_(provider, status, body) {
  const name = PROVIDER_NAMES[provider];
  if (status === 401 || status === 403) return new Error('Your ' + name + ' key was rejected. Check it in Settings.');
  if (status === 429) return new Error(name + " says you've hit a usage or rate limit. Try again in a minute.");
  if (status === 413) return new Error('This recording is too large for the AI service.');
  return new Error(name + ' returned an error (' + status + '). ' + String(body).slice(0, 200));
}

function stripFences_(s) {
  return String(s).replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// ---- Low-level calls -----------------------------------------------------------------

function fetchJson_(provider, url, options) {
  options.muteHttpExceptions = true;
  let res;
  try {
    res = UrlFetchApp.fetch(url, options);
  } catch (e) {
    throw new Error("Couldn't reach " + PROVIDER_NAMES[provider] + '. Try again.');
  }
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw friendlyError_(provider, code, text);
  return JSON.parse(text);
}

function gemini_(apiKey, system, parts, json) {
  const data = fetchJson_('gemini', 'https://generativelanguage.googleapis.com/v1beta/models/' + MODELS.gemini + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: parts }],
      generationConfig: json ? { responseMimeType: 'application/json' } : undefined,
    }),
  });
  const c = data.candidates && data.candidates[0];
  const text = ((c && c.content && c.content.parts) || []).map(function (p) { return p.text || ''; }).join('');
  if (!text) throw new Error('Gemini returned an empty answer. Try again.');
  return text;
}

function openaiChat_(apiKey, system, user) {
  const data = fetchJson_('openai', 'https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({ model: MODELS.openai, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  if (!text) throw new Error('OpenAI returned an empty answer. Try again.');
  return text;
}

// Apps Script has no Anthropic SDK, so this is the Messages API over plain HTTP.
function claude_(apiKey, system, user) {
  const data = fetchJson_('anthropic', 'https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // If Claude declines on a safety classifier, the API retries on a fallback model.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model: MODELS.anthropic,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      system: system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (data.stop_reason === 'refusal') throw new Error('Claude declined to process this text.');
  const text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  if (!text) throw new Error('Claude returned an empty answer. Try again.');
  return text;
}

function complete_(cfg, system, user) {
  if (cfg.provider === 'gemini') return gemini_(cfg.apiKey, system, [{ text: user }]);
  if (cfg.provider === 'openai') return openaiChat_(cfg.apiKey, system, user);
  return claude_(cfg.apiKey, system, user);
}

/** A tiny, free request to check a key before saving it. Returns 'ok' or a message. */
function verifyKey_(provider, key) {
  const req = {
    gemini: ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }],
    openai: ['https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key } }],
    anthropic: ['https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }],
  }[provider];
  if (provider === 'gemini' && !/^AIza[0-9A-Za-z_-]{30,}$/.test(key)) {
    return 'That doesn\'t look like a Gemini key. It should start with "AIza". Try copying it again.';
  }
  try {
    const res = UrlFetchApp.fetch(req[0], Object.assign({ muteHttpExceptions: true }, req[1]));
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return 'ok';
    if (code === 401 || code === 403 || code === 400) return 'That ' + PROVIDER_NAMES[provider] + ' key was rejected. Try copying it again.';
    return PROVIDER_NAMES[provider] + ' returned an error (' + code + ') while checking the key.';
  } catch (e) {
    return "Couldn't reach " + PROVIDER_NAMES[provider] + ' to check the key.';
  }
}

// ---- Meeting notes ----------------------------------------------------------------

function transcriptForAi_(t) {
  return ((t && t.segments) || []).map(function (s) {
    const sec = Math.round(s.startSec || 0);
    return '[' + Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2) + '] ' + (s.speaker ? s.speaker + ': ' : '') + s.text;
  }).join('\n');
}

function notesSystem_(template) {
  return 'You write meeting notes from a transcript and the attendee\'s own rough notes. This was a "' + template.name + '" meeting.\n' +
    'Return Markdown only, with these sections in this order:\n' + template.aiSections + '\n\n' +
    'Rules: use only what the transcript and notes say; never invent names, numbers or dates. The attendee\'s notes show what they cared about, so give those points weight. ' +
    'Write in the language the meeting mostly used: Hindi in Devanagari script, or English. Keep the section headings in English so the app can find them. Keep it concise.';
}

/** Writes AI notes for a note and saves them as ai-notes.md. */
function generateNotes(id, projectId) {
  const body = getNote(id, projectId);
  const meta = body.meta;
  if (!body.transcript.segments.length && !String(body.notes).trim()) throw new Error("There's no transcript or notes to work from yet.");
  const user = 'Meeting title: ' + meta.title + '\nMain language: ' + languageForAi_(meta.language) +
    '\nInvited: ' + ((meta.attendees || []).length ? meta.attendees.join(', ') : '(not known)') +
    "\n\nAttendee's own notes:\n" + (String(body.notes).trim() || '(none)') +
    '\n\nTranscript:\n' + (transcriptForAi_(body.transcript) || '(empty)');
  const md = stripFences_(complete_(pickTextAi_(), notesSystem_(getTemplate_(meta.template)), user));
  return { meta: saveAiNotes_(id, projectId, md), markdown: md };
}

// ---- Dictation clean-up --------------------------------------------------------------

const CLEANUP_SYSTEM = 'You turn raw dictation into clean, ready-to-send text.\n' +
  'Remove filler words (um, uh, like, you know, matlab, haan), false starts and repeated words. Fix punctuation, capitalization and paragraph breaks. Apply spoken corrections such as "no wait, make that Friday". Format lists as lists when the speaker lists things.\n' +
  "Keep the speaker's meaning, tone and language: keep Hindi in Devanagari, English in English, and mixed Hinglish as it was spoken. Do not add anything new, do not answer questions in the text, and do not add a preamble.\n" +
  'Return only the cleaned text.';

function cleanupDictation(text) {
  if (!String(text || '').trim()) throw new Error("I didn't catch any words. Try again a little closer to the mic.");
  return stripFences_(complete_(pickTextAi_(), CLEANUP_SYSTEM, text));
}

// ---- AI transcripts from the recording -------------------------------------------------

const TRANSCRIBE_SYSTEM = 'Transcribe this audio recording accurately, noting who is speaking.\n' +
  'Return JSON only: an array of objects {"startSec": number, "speaker": string, "text": string}, one per turn or short group of sentences by the same person, in order, where startSec is when it starts in whole seconds.\n' +
  'For "speaker", use the person\'s name when the conversation makes it clear (someone introduces themselves or is addressed by name, or it matches the invite list); otherwise "Speaker 1", "Speaker 2" and so on, consistently for the same voice.\n' +
  'Write Hindi in Devanagari script and English in Latin script; keep mixed Hinglish exactly as spoken. Do not translate, summarize or add anything. Return [] if nobody speaks.';

/** Re-transcribes a note's recording with Gemini (with speaker labels) or OpenAI Whisper. */
function transcribeNote(id, projectId) {
  const meta = noteRow_(id, projectId).meta;
  if (!meta.audioFileId) throw new Error('This note has no saved recording.');
  const blob = DriveApp.getFileById(meta.audioFileId).getBlob();
  const bytes = blob.getBytes();
  const mime = String(blob.getContentType() || 'audio/webm').split(';')[0];
  const cfg = pickTranscriber_();
  let segments;
  if (cfg.provider === 'gemini') {
    if (bytes.length > GEMINI_MAX_BYTES) throw new Error('This recording is too long for an AI transcript (about 75 minutes max). The live transcript is kept.');
    const raw = gemini_(cfg.apiKey, TRANSCRIBE_SYSTEM, [
      { inlineData: { mimeType: mime, data: Utilities.base64Encode(bytes) } },
      { text: 'Main language: ' + languageForAi_(meta.language) + '.' + ((meta.attendees || []).length ? ' Invited: ' + meta.attendees.join(', ') + '.' : '') },
    ], true);
    let list;
    try { list = JSON.parse(stripFences_(raw)); } catch (e) { throw new Error("Gemini's transcript came back in an unexpected format. Try again."); }
    segments = (Array.isArray(list) ? list : []).map(function (s) {
      return { startSec: Math.max(0, Math.round(Number(s.startSec) || 0)), text: String(s.text || '').trim(), speaker: s.speaker ? String(s.speaker).trim() : undefined };
    }).filter(function (s) { return s.text; });
  } else {
    if (bytes.length > OPENAI_MAX_BYTES) throw new Error('This recording is too long for an AI transcript. The live transcript is kept.');
    const data = fetchJson_('openai', 'https://api.openai.com/v1/audio/transcriptions', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + cfg.apiKey },
      payload: {
        file: Utilities.newBlob(bytes, mime, 'audio.' + audioExt_(mime)),
        model: MODELS.openaiTranscribe,
        response_format: 'verbose_json',
        language: String(meta.language).split('-')[0],
      },
    });
    segments = (data.segments && data.segments.length)
      ? data.segments.map(function (s) { return { startSec: Math.round(s.start), text: String(s.text).trim() }; }).filter(function (s) { return s.text; })
      : (data.text ? [{ startSec: 0, text: String(data.text).trim() }] : []);
  }
  const transcript = { language: meta.language, source: cfg.provider, segments: segments };
  return { meta: saveTranscript_(id, projectId, transcript), transcript: transcript };
}

// ---- Ask your notes -----------------------------------------------------------------------

const ASK_SYSTEM = "You answer questions about the user's own meetings, using only the meeting notes provided.\n" +
  'Each meeting is numbered like [3]. Cite the meetings you used with their numbers in square brackets right after the sentence, e.g. "The launch moved to the 15th [3]."\n' +
  "If the notes don't contain the answer, say so plainly and suggest what to search for instead. Never invent facts, names, dates or numbers.\n" +
  'Answer in the language of the question (Hindi in Devanagari, or English). Be concise: a short paragraph or a few bullet points. Markdown is fine.';

/** Answers a question from the most relevant notes, with numbered sources. */
function askNotes(question) {
  question = String(question || '').trim();
  if (!question) throw new Error('Type a question first.');
  const rows = allSearchRows_();
  if (!rows.length) throw new Error('There are no notes to search yet.');
  const terms = words_(question);
  const ranked = rows.map(function (n) {
    const hay = String(n.search || '').toLowerCase();
    let score = 0;
    terms.forEach(function (t) { let at = -1; let c = 0; while ((at = hay.indexOf(t, at + 1)) >= 0 && c < 20) c++; score += c; });
    return { n: n, score: score };
  }).sort(function (a, b) { return b.score - a.score || String(b.n.createdAt).localeCompare(String(a.n.createdAt)); });
  // The best matches, or the most recent notes when nothing matches (e.g. "what did I do this week?").
  const picked = (ranked[0].score ? ranked.filter(function (r) { return r.score; }) : ranked).slice(0, 12).map(function (r) { return r.n; });
  const sources = picked.map(function (n, i) {
    return { n: i + 1, id: n.id, projectId: n.projectId, title: n.title, date: String(n.createdAt).slice(0, 10), text: String(n.search || '').slice(0, 6000) };
  });
  const user = 'Today is ' + new Date().toDateString() + '.\n\n' +
    sources.map(function (s) { return '[' + s.n + '] ' + s.title + ' (' + s.date + ')\n' + s.text; }).join('\n\n---\n\n') +
    '\n\nQuestion: ' + question;
  const answer = stripFences_(complete_(pickTextAi_(), ASK_SYSTEM, user));
  return { answer: answer, sources: sources.map(function (s) { return { n: s.n, id: s.id, projectId: s.projectId, title: s.title, date: s.date }; }) };
}

// ---- Translation and ideas ------------------------------------------------------------------

function translateMarkdown(markdown, toLang) {
  const system = "Translate the user's Markdown meeting notes into " + languageForAi_(toLang) + '.\n' +
    'Keep the Markdown structure exactly: headings, bullets, "- [ ]" task boxes, bold names. Keep people\'s names, product names and numbers as they are. Return only the translated Markdown.';
  return stripFences_(complete_(pickTextAi_(), system, markdown));
}

const RIFF_SYSTEM = 'You are a warm, sharp creative partner. Someone has jotted down a raw idea. Help them think it through, briefly.\n' +
  'Reply in Markdown with exactly these short sections:\n### Sharper version\nOne or two sentences that state the idea more clearly and boldly.\n' +
  '### Ways to take it\n3 bullet points: different directions, twists or angles, each one line.\n### First step\nOne concrete thing they could do in the next 30 minutes.\n' +
  '### A question to sit with\nOne honest question that tests the idea.\n' +
  'Write in the same language and script as the idea (keep Hindi in Devanagari, Hinglish as Hinglish). Be specific to their idea, never generic. No preamble.';

/** Expands a raw idea into angles, a first step and a hard question, and saves it on the idea. */
function riffIdea(id) {
  const idea = getRow_(getDb_(), 'Ideas', id);
  if (!idea || !String(idea.text || '').trim()) throw new Error('Write the idea first.');
  idea.riff = stripFences_(complete_(pickTextAi_(), RIFF_SYSTEM, idea.text));
  return saveIdea(idea);
}

// ---- Slack actionables ------------------------------------------------------------------------

const SLACK_SYSTEM = "You read a person's recent Slack messages and pick out things they need to do.\n" +
  'Each message is numbered and shows when it was sent, who sent it, and where. "you" is the person.\n\n' +
  'Return a JSON array only. Each item: {"ref": message number, "title": short task in the imperative, "due": "YYYY-MM-DD" or null, "who": who asked (or "you" if it is the person\'s own promise)}.\n\n' +
  'Include:\n- Clear asks to the person ("can you send...", "please review...", "@you deck bhej dena").\n- Promises the person made ("I\'ll send it tomorrow", "kal tak kar dunga").\n' +
  'Skip greetings, FYIs, questions already answered, things clearly done, and asks aimed at someone else.\n' +
  'Messages may be in English, Hindi or Hinglish; write titles in English. Work out due dates from words like "today", "tomorrow", "kal", "Friday", "EOD" relative to when the message was sent. Never invent tasks. If nothing is actionable, return [].';

function extractSlackActions_(messages) {
  if (!messages.length) return [];
  const cfg = pickTextAi_();
  const tz = Session.getScriptTimeZone();
  const user = messages.map(function (m, i) {
    return '[' + (i + 1) + '] ' + Utilities.formatDate(new Date(m.at), tz, 'EEE d MMM yyyy, h:mm a') + ' · ' + m.from + ' in ' + m.where + ':\n' + m.text;
  }).join('\n\n');
  const raw = cfg.provider === 'gemini' ? gemini_(cfg.apiKey, SLACK_SYSTEM, [{ text: user }], true) : complete_(cfg, SLACK_SYSTEM, user);
  let parsed;
  try {
    const text = stripFences_(raw);
    parsed = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  } catch (e) {
    throw new Error("The AI's answer came back in an unexpected format. Try again.");
  }
  return (Array.isArray(parsed) ? parsed : []).map(function (x) {
    return {
      ref: Number(x.ref),
      title: String(x.title || '').trim(),
      due: typeof x.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.due) ? x.due : undefined,
      who: String(x.who || '').trim() || 'someone',
    };
  }).filter(function (x) { return x.title && x.ref >= 1 && x.ref <= messages.length; });
}
