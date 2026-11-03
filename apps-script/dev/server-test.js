// Runs every public server function the way the front end calls it.
const G = require('./gas');
const assert = require('assert');
const A = 'aman@example.com', B = 'priya@example.com';
const c = (fn, ...args) => G.call(fn, args, A);
const cb = (fn, ...args) => G.call(fn, args, B);
let n = 0;
const ok = (name) => console.log('  ✓', ++n, name);
const throwsMsg = (f, re) => { try { f(); } catch (e) { assert.match(e.message, re); return; } throw new Error('expected throw ' + re); };

// doGet renders and includes resolve
const html = G.call('doGet', [{ parameter: { join: 'abc"<x' } }], A);
ok('doGet');
c('setup'); ok('setup');

let d = c('bootstrap');
assert.equal(d.user.email, A); assert.equal(d.user.name, 'Aman'); assert.equal(d.notes.length, 0); assert.equal(d.templates.length, 6); assert.equal(d.languages.length, 11);
assert.equal(d.keys.gemini, ''); assert.equal(d.slack.connected, false);
ok('bootstrap (fresh user)');
// running bootstrap twice must not create a second folder/spreadsheet
c('bootstrap');
const folders = [...G.drive.items.values()].filter((i) => i.name === 'Little' && i.kind === 'folder');
const dbs = [...G.drive.items.values()].filter((i) => i.name === 'Little data');
assert.equal(folders.length, 1); assert.equal(dbs.length, 1);
ok('one Little folder and one data sheet');

// AI keys
throwsMsg(() => c('saveKey', 'gemini', 'nope'), /doesn't look like a Gemini key/);
throwsMsg(() => c('saveKey', 'gemini', 'AIzaBAD0000000000000000000000000000000'), /rejected/);
let r = c('saveKey', 'gemini', 'AIzaSyGOOD000000000000000000000000000000');
assert.equal(r.settings.aiProvider, 'gemini'); assert.ok(r.keys.gemini.endsWith('0000'));
ok('saveKey gemini verifies and saves');
r = c('saveSettings', { defaultLanguage: 'hi-IN', saveAudio: true });
assert.equal(r.settings.defaultLanguage, 'hi-IN');
ok('saveSettings');

// Notes
const audio = Buffer.from('fake-webm-audio-bytes').toString('base64');
let note = c('createNote', { title: 'Team sync', notes: 'Launch = Friday\n- check', transcript: { language: 'en-IN', source: 'browser', segments: [{ text: 'we ship friday', startSec: 3 }] }, durationSec: 62.4, language: 'en-IN', template: 'general', projectId: null, attendees: ['Priya'], calendarEventId: 'evt1@google.com', audio: { mime: 'audio/webm;codecs=opus', data: audio } });
assert.ok(note.id && note.audioFileId && note.notesFileId); assert.equal(note.durationSec, 62); assert.equal(note.search, undefined);
ok('createNote with audio');
let full = c('getNote', note.id, null);
assert.equal(full.notes.trim(), 'Launch = Friday\n- check'); assert.equal(full.transcript.segments[0].text, 'we ship friday'); assert.equal(full.audio.mime, 'audio/webm'); assert.equal(full.aiNotes, null);
assert.deepEqual(full.meta.attendees, ['Priya']); assert.deepEqual(full.meta.tags, []);
ok('getNote (formula-looking text stays text)');
const au = c('getAudio', note.id, null);
assert.equal(Buffer.from(au.data, 'base64').toString(), 'fake-webm-audio-bytes');
ok('getAudio');
let gen = c('generateNotes', note.id, null);
assert.match(gen.markdown, /^## Summary/); assert.equal(gen.meta.actions.length, 2);
ok('generateNotes (fences stripped, actions extracted)');
let tg = c('toggleAction', note.id, null, 1, true);
assert.equal(tg.meta.actions[1].done, true); assert.match(tg.markdown, /- \[x\] \*\*Aman\*\*/);
ok('toggleAction');
let tr = c('transcribeNote', note.id, null);
assert.equal(tr.transcript.source, 'gemini'); assert.equal(tr.transcript.segments[0].speaker, 'Priya');
ok('transcribeNote (Gemini, speakers)');
let up = c('updateNote', note.id, null, { title: 'Team sync (edited)', notes: 'New notes about pricing' });
assert.equal(up.title, 'Team sync (edited)');
assert.equal(c('getNote', note.id, null).notes.trim(), 'New notes about pricing');
ok('updateNote');
let pn = c('patchNote', note.id, null, { pinned: true, tags: ['launch'] });
assert.equal(pn.pinned, true); assert.deepEqual(pn.tags, ['launch']);
let s = c('searchNotes', 'pricing');
assert.equal(s.length, 1); assert.equal(s[0].id, note.id);
ok('patchNote keeps search text; searchNotes finds body text');
const written = c('createNote', { title: 'Grocery =SUM(A1)', notes: '+91 phone 0042', kind: 'written', language: 'en-IN' });
assert.equal(c('getNote', written.id, null).meta.title, 'Grocery =SUM(A1)');
ok('written note');
const t2 = c('translateMarkdown', gen.markdown, 'hi-IN'); assert.match(t2, /सारांश/); ok('translateMarkdown');
const cl = c('cleanupDictation', 'um so like the launch'); assert.match(cl, /Friday/); ok('cleanupDictation');
const ask = c('askNotes', 'when do we ship?'); assert.match(ask.answer, /\[1\]/); assert.ok(ask.sources.length >= 1 && ask.sources[0].title); ok('askNotes');
const txt = c('noteText', note.id, null); assert.match(txt, /Written with Little/); ok('noteText');
const docUrl = c('exportToDoc', note.id, null); assert.match(docUrl, /docs.google.com\/document/); ok('exportToDoc');
c('emailNote', note.id, null, 'x@y.com'); assert.equal(G.log.mail.slice(-1)[0].to, 'x@y.com'); ok('emailNote');
throwsMsg(() => c('emailNote', note.id, null, 'bad'), /Add an email/);

// Projects and sharing
const p = c('createProject', 'Launch', null);
assert.ok(p.boardId && p.folderId); assert.equal(p.role, 'owner');
ok('createProject');
let moved = c('moveNotes', [{ id: note.id, projectId: null }], p.id);
const mn = moved.find((x) => x.id === note.id);
assert.equal(mn.projectId, p.id);
full = c('getNote', note.id, p.id); assert.match(full.aiNotes, /Summary/);
assert.equal(G.drive.items.get(full.meta.folderId).parent, p.folderId);
ok('moveNotes into project (row + folder move)');
const pnote = c('createNote', { title: 'Project kickoff', notes: 'hi', projectId: p.id, language: 'en-IN' });
assert.equal(pnote.projectId, p.id);
ok('createNote inside project');
const upd = c('updateProject', p.id, { name: 'Launch v2', color: '#4d96ff' }); assert.equal(upd.name, 'Launch v2'); ok('updateProject');
const sh = c('shareProject', p.id, 'priya@example.com, bad');
assert.equal(sh.failed.length, 0); assert.ok(sh.members.some((m) => m.email === B));
assert.match(G.log.mail.slice(-1)[0].body, /\?join=/);
ok('shareProject');
// Priya joins with the link
const joinLink = G.log.mail.slice(-1)[0].body.match(/https:\S+/)[0];
const pd = cb('bootstrap'); assert.equal(pd.projects.length, 0);
const j = cb('joinProject', joinLink);
assert.equal(j.projectId, p.id); assert.equal(j.data.projects[0].role, 'member');
assert.ok(j.data.notes.some((x) => x.id === note.id));
ok('joinProject (teammate sees project notes)');
// team to-do from Priya visible to Aman; personal to-do not
const teamTodo = cb('saveTodo', { title: 'Book venue', projectId: p.id, owner: 'Priya' });
const privTodo = cb('saveTodo', { title: 'Priya private thing' });
d = c('bootstrap');
assert.ok(d.todos.some((t) => t.id === teamTodo.id && t.projectId === p.id));
assert.ok(!d.todos.some((t) => t.id === privTodo.id));
ok('team to-dos shared, personal to-dos private');
const act = c('addActionToTodo', note.id, p.id, '**Priya**: update the launch checklist');
assert.equal(act.owner, 'Priya'); assert.equal(act.title, 'Update the launch checklist'); assert.equal(act.projectId, p.id);
const act2 = c('addActionToTodo', note.id, p.id, '**Priya**: update the launch checklist');
assert.equal(act2.id, act.id);
ok('addActionToTodo (deduped)');
// move a to-do from project to personal
let tmove = c('saveTodo', Object.assign({}, act, { projectId: undefined, status: 'review', due: '2026-11-05' }), p.id);
d = c('bootstrap');
const found = d.todos.filter((t) => t.id === act.id);
assert.equal(found.length, 1); assert.equal(found[0].projectId, undefined); assert.equal(found[0].due, '2026-11-05'); assert.equal(found[0].status, 'review');
ok('saveTodo moves between stores');
c('deleteTodo', act.id, null); assert.ok(!c('listTodos').some((t) => t.id === act.id)); ok('deleteTodo');
const mem = c('removeMember', p.id, B); assert.ok(!mem.some((m) => m.email === B)); ok('removeMember');
cb('leaveProject', p.id); assert.equal(cb('bootstrap').projects.length, 0); ok('leaveProject');

// Ideas
let idea = c('saveIdea', { text: 'Voice notes for doctors', color: 'sun' });
idea = c('riffIdea', idea.id); assert.match(idea.riff, /Sharper version/);
c('saveIdea', Object.assign(idea, { pinned: true }));
assert.equal(c('bootstrap').ideas[0].pinned, true);
c('deleteIdea', idea.id); assert.equal(c('bootstrap').ideas.length, 0);
ok('ideas: save, riff, pin, delete');

// Calendar
const evs = c('listEvents', new Date(Date.now() - 7 * 864e5).toISOString(), new Date(Date.now() + 8 * 864e5).toISOString());
assert.equal(evs.length, 2); assert.equal(evs[0].meetLink, 'https://meet.google.com/abc-defg-hij'); assert.equal(evs[0].attendees.length, 3); assert.match(evs[0].htmlLink, /eid=/);
ok('listEvents');

// Slack
throwsMsg(() => c('connectSlack', 'abc'), /xoxp/);
throwsMsg(() => c('connectSlack', 'xoxp-bad'), /rejected/);
const st = c('connectSlack', 'xoxp-good-1'); assert.equal(st.team, 'Acme');
let inbox = c('refreshInbox', 2);
assert.equal(inbox.scanned, 2); assert.equal(inbox.items.length, 2);
const ravi = inbox.items.find((i) => i.who === 'Ravi'); assert.match(ravi.quote, /@you can you review/); assert.match(ravi.quote, /& thanks/);
inbox = c('refreshInbox', 2); assert.equal(inbox.scanned, 0); assert.equal(inbox.items.length, 2);
ok('refreshInbox (DMs + mentions + own, seen messages skipped)');
const h = c('handleInboxItem', ravi.key, 'todo', null);
assert.equal(h.todo.title, 'Review the pricing doc'); assert.equal(h.todo.link, 'https://acme.slack.com/p1'); assert.equal(h.inbox.items.length, 1);
c('handleInboxItem', h.inbox.items[0].key, 'dismiss');
assert.equal(c('listInbox').items.length, 0); assert.equal(c('bootstrap').inboxCount, 0);
ok('handleInboxItem todo + dismiss');
c('installHourlyInbox'); ok('installHourlyInbox');
assert.equal(c('disconnectSlack').connected, false); ok('disconnectSlack');

// Other providers
r = c('saveKey', 'anthropic', 'sk-ant-xyz'); c('saveSettings', { aiProvider: 'anthropic' });
const claudeNotes = c('generateNotes', pnote.id, p.id); assert.match(claudeNotes.markdown, /From Claude/);
ok('Claude via Messages API (headers, fallbacks, effort)');
r = c('saveKey', 'openai', 'sk-proj-1'); c('saveSettings', { aiProvider: 'openai' });
assert.equal(c('cleanupDictation', 'x'), 'From OpenAI');
const wt = c('transcribeNote', note.id, p.id); assert.equal(wt.transcript.source, 'openai'); assert.equal(wt.transcript.segments[0].text, 'hello there');
ok('OpenAI chat + Whisper multipart');
c('saveKey', 'gemini', ''); c('saveKey', 'openai', ''); c('saveKey', 'anthropic', '');
throwsMsg(() => c('generateNotes', pnote.id, p.id), /^NEED_KEY/);
throwsMsg(() => c('transcribeNote', note.id, p.id), /^NEED_KEY/);
ok('NEED_KEY errors without keys');

// Delete flows
c('deleteNote', written.id, null); assert.ok(!c('bootstrap').notes.some((x) => x.id === written.id)); ok('deleteNote');
d = c('deleteProject', p.id);
assert.equal(d.projects.length, 0);
assert.ok(d.notes.some((x) => x.id === note.id && !x.projectId));
assert.ok(d.notes.some((x) => x.id === pnote.id && !x.projectId));
assert.ok(d.todos.some((x) => x.id === teamTodo.id && !x.projectId));
full = c('getNote', note.id, null); assert.match(full.aiNotes, /Summary/);
ok('deleteProject keeps notes and to-dos');

// private functions can't be called
throwsMsg(() => c('getDb_'), /private/);
ok('private functions hidden');
console.log('\nAll ' + n + ' server checks passed.');
