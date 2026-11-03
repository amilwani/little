// Notes, projects, sharing, to-dos, ideas and search.

const PROJECT_COLORS = ['#f07167', '#f4a261', '#e9c46a', '#2a9d8f', '#4d96ff', '#9b5de5', '#ef476f', '#6c757d'];
const TASK_RE = /^(\s*[-*]\s+\[)([ xX])(\]\s+)(.*)$/;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function me_() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
}

// ---- Projects -----------------------------------------------------------------

function listProjects_() {
  return readRows_(getDb_(), 'Projects').sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
}

function findProject_(id) {
  return getRow_(getDb_(), 'Projects', id);
}

function createProject(name, color) {
  name = String(name || '').trim() || 'Project';
  const count = listProjects_().length;
  const folder = getRoot_().createFolder(safeName_(name, 'Project'));
  const board = SpreadsheetApp.create(BOARD_NAME);
  DriveApp.getFileById(board.getId()).moveTo(folder);
  const project = {
    id: uuid_(),
    name: name,
    color: color || PROJECT_COLORS[count % PROJECT_COLORS.length],
    folderId: folder.getId(),
    boardId: board.getId(),
    createdAt: now_(),
    owner: me_(),
    shared: false,
    role: 'owner',
  };
  ['Meta', 'Notes', 'Todos'].forEach(function (n) { table_(board, n); });
  const first = board.getSheetByName('Sheet1');
  if (first) board.deleteSheet(first);
  writeMeta_(board, project);
  withLock_(function () { upsertRow_(getDb_(), 'Projects', project); });
  return project;
}

function writeMeta_(board, p) {
  ['id', 'name', 'color', 'owner', 'createdAt'].forEach(function (k) { upsertRow_(board, 'Meta', { key: k, value: p[k] }); });
}

function readMeta_(board) {
  const o = {};
  readRows_(board, 'Meta').forEach(function (r) { o[r.key] = r.value; });
  return o;
}

function updateProject(id, changes) {
  const p = findProject_(id);
  if (!p) throw new Error('Project not found');
  if (changes.name && changes.name !== p.name) {
    try { DriveApp.getFolderById(p.folderId).setName(safeName_(changes.name, 'Project')); } catch (e) { /* not ours to rename */ }
  }
  const next = Object.assign({}, p, { name: changes.name || p.name, color: changes.color || p.color });
  withLock_(function () {
    upsertRow_(getDb_(), 'Projects', next);
    try { writeMeta_(openBoard_(p.boardId), next); } catch (e) { /* board unreadable */ }
  });
  return next;
}

/** Deletes a project you own. Its notes and to-dos move back to "No project". */
function deleteProject(id) {
  const p = findProject_(id);
  if (!p) return bootstrap();
  if (p.role === 'member') return leaveProject(id);
  const board = openBoard_(p.boardId);
  const root = getRoot_();
  const db = getDb_();
  withLock_(function () {
    readRows_(board, 'Notes').forEach(function (n) {
      try { DriveApp.getFolderById(n.folderId).moveTo(root); } catch (e) { /* someone else's note folder stays */ }
      upsertRow_(db, 'Notes', n);
    });
    readRows_(board, 'Todos').forEach(function (t) { upsertRow_(db, 'Todos', t); });
    deleteRow_(db, 'Projects', id);
  });
  DriveApp.getFolderById(p.folderId).setTrashed(true);
  return bootstrap();
}

/** Stops showing a project someone shared with you. Their Drive is untouched. */
function leaveProject(id) {
  withLock_(function () { deleteRow_(getDb_(), 'Projects', id); });
  return bootstrap();
}

function parseEmails_(text) {
  const seen = {};
  return String(text || '').split(/[\s,;]+/).map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !seen[e] && (seen[e] = 1); });
}

/** Gives each email edit access to the project folder and emails them a join link. */
function shareProject(id, emailsText) {
  const p = findProject_(id);
  if (!p) throw new Error('Project not found');
  const emails = parseEmails_(emailsText);
  if (!emails.length) throw new Error('Add at least one email address.');
  const folder = DriveApp.getFolderById(p.folderId);
  const link = ScriptApp.getService().getUrl() + '?join=' + encodeURIComponent(p.folderId);
  const failed = [];
  emails.forEach(function (email) {
    try {
      folder.addEditor(email);
      MailApp.sendEmail({
        to: email,
        subject: me_() + ' shared "' + p.name + '" with you in Little',
        body: nameFromEmail_(me_()) + ' shared the project "' + p.name + '" with you in Little, the meeting notes app.\n\n' +
          'Open this link and sign in with this Google account to join:\n' + link,
      });
    } catch (e) {
      failed.push(email);
    }
  });
  if (failed.length < emails.length && !p.shared) {
    withLock_(function () { upsertRow_(getDb_(), 'Projects', Object.assign(p, { shared: true })); });
  }
  return { failed: failed, members: listMembers(id) };
}

function listMembers(id) {
  const p = findProject_(id);
  const folder = DriveApp.getFolderById(p.folderId);
  const owner = folder.getOwner();
  const out = owner ? [{ email: owner.getEmail(), name: owner.getName(), role: 'owner' }] : [];
  folder.getEditors().forEach(function (u) { out.push({ email: u.getEmail(), name: u.getName(), role: 'writer' }); });
  return out;
}

function removeMember(id, email) {
  const p = findProject_(id);
  DriveApp.getFolderById(p.folderId).removeEditor(email);
  return listMembers(id);
}

/** Adds a project someone shared with you, from its join link or folder link. */
function joinProject(folderRef) {
  const m = String(folderRef || '').match(/[-\w]{25,}/);
  if (!m) throw new Error("That doesn't look like a Little join link.");
  let folder;
  try {
    folder = DriveApp.getFolderById(m[0]);
  } catch (e) {
    throw new Error("You don't have access to that project yet. Ask the owner to share it with this Google account.");
  }
  const files = folder.getFilesByName(BOARD_NAME);
  if (!files.hasNext()) throw new Error("That folder isn't a Little project.");
  const board = SpreadsheetApp.openById(files.next().getId());
  const meta = readMeta_(board);
  const existing = findProject_(meta.id);
  if (!existing) {
    withLock_(function () {
      upsertRow_(getDb_(), 'Projects', {
        id: meta.id, name: meta.name, color: meta.color || PROJECT_COLORS[0], folderId: folder.getId(),
        boardId: board.getId(), createdAt: meta.createdAt || now_(), owner: meta.owner, shared: true, role: 'member',
      });
    });
  }
  return { projectId: meta.id, data: bootstrap() };
}

// ---- Notes ----------------------------------------------------------------------

function stripSearch_(n) {
  delete n.search;
  return n;
}

function listNotes_(projects) {
  const notes = readRows_(getDb_(), 'Notes').map(stripSearch_);
  (projects || listProjects_()).forEach(function (p) {
    try {
      readRows_(openBoard_(p.boardId), 'Notes').forEach(function (n) {
        n.projectId = p.id;
        notes.push(stripSearch_(n));
      });
    } catch (e) {
      p.unavailable = true;
    }
  });
  return notes.sort(byNewest_);
}

function transcriptText_(t) {
  return ((t && t.segments) || []).map(function (s) { return (s.speaker ? s.speaker + ': ' : '') + s.text; }).join(' ');
}

function buildSearch_(title, notes, aiNotes, transcript) {
  return [title, notes, aiNotes, transcriptText_(transcript)].join('\n').slice(0, SEARCH_MAX);
}

function noteFolderParent_(projectId) {
  if (!projectId) return getRoot_();
  return DriveApp.getFolderById(findProject_(projectId).folderId);
}

function audioExt_(mime) {
  if (/mp4|m4a|aac/.test(mime)) return 'm4a';
  if (/ogg/.test(mime)) return 'ogg';
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  if (/wav/.test(mime)) return 'wav';
  return 'webm';
}

/**
 * Saves a new note. `n.audio` is optional: { mime, data } with data as base64.
 * Returns the saved note's metadata.
 */
function createNote(n) {
  const projectId = n.projectId || null;
  const createdAt = n.createdAt || now_();
  const title = String(n.title || '').trim() || 'Untitled';
  const folder = noteFolderParent_(projectId).createFolder(createdAt.slice(0, 10) + ' ' + safeName_(title, 'Untitled'));
  const notes = String(n.notes || '');
  const transcript = n.transcript || { language: n.language || 'en-IN', source: 'browser', segments: [] };
  const meta = {
    id: n.id || uuid_(),
    title: title,
    createdAt: createdAt,
    updatedAt: now_(),
    durationSec: Math.round(n.durationSec || 0),
    kind: n.kind || undefined,
    language: n.language || 'en-IN',
    template: n.template || 'general',
    tags: n.tags || [],
    pinned: false,
    attendees: n.attendees || [],
    calendarEventId: n.calendarEventId || undefined,
    folderId: folder.getId(),
    createdBy: me_(),
  };
  meta.notesFileId = folder.createFile('notes.md', '# ' + title + '\n\n' + notes.trim() + '\n', 'text/markdown').getId();
  meta.transcriptFileId = folder.createFile('transcript.json', JSON.stringify(transcript, null, 2), 'application/json').getId();
  if (n.audio && n.audio.data && getSettings_().saveAudio) {
    const bytes = Utilities.base64Decode(n.audio.data);
    if (bytes.length > MAX_AUDIO_BYTES) throw new Error('This recording is too large to save (25 MB max).');
    const mime = String(n.audio.mime || 'audio/webm').split(';')[0];
    meta.audioFileId = folder.createFile(Utilities.newBlob(bytes, mime, 'audio.' + audioExt_(mime))).getId();
  }
  meta.search = buildSearch_(title, notes, '', transcript);
  withLock_(function () { upsertRow_(storeFor_(projectId), 'Notes', meta); });
  meta.projectId = projectId || undefined;
  return stripSearch_(meta);
}

function noteRow_(id, projectId) {
  const store = storeFor_(projectId);
  const meta = getRow_(store, 'Notes', id);
  if (!meta) throw new Error('This note was deleted or moved.');
  meta.projectId = projectId || undefined;
  return { store: store, meta: meta };
}

/** The whole note: typed notes, transcript, AI notes and recording info. */
function getNote(id, projectId) {
  const r = noteRow_(id, projectId);
  const meta = r.meta;
  const notesMd = readFile_(meta.notesFileId).replace(/^# .*\n+/, '');
  let transcript = { language: meta.language, source: 'browser', segments: [] };
  try { if (meta.transcriptFileId) transcript = JSON.parse(readFile_(meta.transcriptFileId)); } catch (e) { /* keep empty */ }
  let audio = null;
  if (meta.audioFileId) {
    try {
      const f = DriveApp.getFileById(meta.audioFileId);
      audio = { size: f.getSize(), mime: f.getMimeType(), url: f.getUrl(), previewUrl: 'https://drive.google.com/file/d/' + f.getId() + '/preview' };
    } catch (e) { /* recording deleted */ }
  }
  return {
    meta: stripSearch_(meta),
    notes: notesMd,
    transcript: transcript,
    aiNotes: meta.aiNotesFileId ? readFile_(meta.aiNotesFileId) : null,
    audio: audio,
    folderUrl: 'https://drive.google.com/drive/folders/' + meta.folderId,
  };
}

/** The recording as base64, for playback with tap-to-seek. Large files play from Drive instead. */
function getAudio(id, projectId) {
  const meta = noteRow_(id, projectId).meta;
  const blob = DriveApp.getFileById(meta.audioFileId).getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > 20 * 1024 * 1024) return { tooLarge: true };
  return { mime: blob.getContentType(), data: Utilities.base64Encode(bytes) };
}

function updateNote(id, projectId, changes) {
  const r = noteRow_(id, projectId);
  const meta = r.meta;
  const title = String(changes.title || meta.title).trim() || 'Untitled';
  const folder = DriveApp.getFolderById(meta.folderId);
  meta.notesFileId = writeFile_(folder, 'notes.md', 'text/markdown', '# ' + title + '\n\n' + String(changes.notes || '').trim() + '\n', meta.notesFileId);
  meta.title = title;
  meta.updatedAt = now_();
  const body = getNote(id, projectId);
  meta.search = buildSearch_(title, changes.notes, body.aiNotes || '', body.transcript);
  withLock_(function () { upsertRow_(r.store, 'Notes', meta); });
  return stripSearch_(meta);
}

/** Small fields: pinned, tags, template, title. */
function patchNote(id, projectId, patch) {
  return withLock_(function () {
    const r = noteRow_(id, projectId);
    ['pinned', 'tags', 'template', 'title'].forEach(function (k) { if (k in patch) r.meta[k] = patch[k]; });
    r.meta.updatedAt = now_();
    upsertRow_(r.store, 'Notes', r.meta); // r.meta still carries its search text
    return stripSearch_(r.meta);
  });
}

/** Moves the note's folder to the Drive trash, so it can still be restored. */
function deleteNote(id, projectId) {
  const r = noteRow_(id, projectId);
  try { DriveApp.getFolderById(r.meta.folderId).setTrashed(true); } catch (e) { /* already gone */ }
  withLock_(function () { deleteRow_(r.store, 'Notes', id); });
  return true;
}

function extractActions_(md) {
  return String(md || '').split('\n').map(function (l) { return l.match(TASK_RE); }).filter(Boolean)
    .map(function (m) { return { text: m[4].trim(), done: m[2] !== ' ' }; });
}

function setTaskDone_(md, n, done) {
  let i = -1;
  return String(md).split('\n').map(function (line) {
    const m = line.match(TASK_RE);
    if (!m || ++i !== n) return line;
    return m[1] + (done ? 'x' : ' ') + m[3] + m[4];
  }).join('\n');
}

function saveAiNotes_(id, projectId, markdown) {
  const r = noteRow_(id, projectId);
  const meta = r.meta;
  meta.aiNotesFileId = writeFile_(DriveApp.getFolderById(meta.folderId), 'ai-notes.md', 'text/markdown', markdown, meta.aiNotesFileId);
  meta.actions = extractActions_(markdown);
  meta.updatedAt = now_();
  const body = getNote(id, projectId);
  meta.search = buildSearch_(meta.title, body.notes, markdown, body.transcript);
  withLock_(function () { upsertRow_(r.store, 'Notes', meta); });
  return stripSearch_(meta);
}

/** Saves edits to the AI notes. */
function saveAiNotes(id, projectId, markdown) {
  return saveAiNotes_(id, projectId, markdown);
}

function saveTranscript_(id, projectId, transcript) {
  const r = noteRow_(id, projectId);
  const meta = r.meta;
  meta.transcriptFileId = writeFile_(DriveApp.getFolderById(meta.folderId), 'transcript.json', 'application/json', JSON.stringify(transcript, null, 2), meta.transcriptFileId);
  meta.updatedAt = now_();
  const body = getNote(id, projectId);
  meta.search = buildSearch_(meta.title, body.notes, body.aiNotes || '', transcript);
  withLock_(function () { upsertRow_(r.store, 'Notes', meta); });
  return stripSearch_(meta);
}

/** Ticks or unticks the n-th action item in the AI notes. */
function toggleAction(id, projectId, n, done) {
  const meta = noteRow_(id, projectId).meta;
  const md = setTaskDone_(readFile_(meta.aiNotesFileId), n, done);
  return { meta: saveAiNotes_(id, projectId, md), markdown: md };
}

/** Moves notes into a project, or out of all projects when target is null. */
function moveNotes(items, target) {
  target = target || null;
  const dest = storeFor_(target);
  const destFolder = noteFolderParent_(target);
  withLock_(function () {
    items.forEach(function (it) {
      const from = it.projectId || null;
      if (from === target) return;
      const src = storeFor_(from);
      const row = getRow_(src, 'Notes', it.id);
      if (!row) return;
      try { DriveApp.getFolderById(row.folderId).moveTo(destFolder); } catch (e) { /* can't move a teammate's folder; the row still moves */ }
      upsertRow_(dest, 'Notes', row);
      deleteRow_(src, 'Notes', it.id);
    });
  });
  return listNotes_();
}

// ---- Search -----------------------------------------------------------------------

function allSearchRows_() {
  const rows = readRows_(getDb_(), 'Notes');
  listProjects_().forEach(function (p) {
    try {
      readRows_(openBoard_(p.boardId), 'Notes').forEach(function (n) { n.projectId = p.id; rows.push(n); });
    } catch (e) { /* unavailable */ }
  });
  return rows;
}

function words_(q) {
  return String(q || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(function (w) { return w.length > 1; });
}

/** Full-text search inside notes, transcripts and AI notes. */
function searchNotes(q) {
  const terms = words_(q);
  if (!terms.length) return [];
  return allSearchRows_().map(function (n) {
    const hay = String(n.search || '').toLowerCase();
    let score = 0;
    let first = -1;
    terms.forEach(function (t) {
      const at = hay.indexOf(t);
      if (at >= 0) { score += 1 + (String(n.title).toLowerCase().indexOf(t) >= 0 ? 2 : 0); if (first < 0) first = at; }
    });
    if (!score) return null;
    const s = Math.max(0, first - 60);
    return { id: n.id, projectId: n.projectId, score: score, snippet: (s ? '…' : '') + String(n.search).slice(s, s + 180).replace(/\s+/g, ' ') + '…' };
  }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 50);
}

// ---- To-dos ------------------------------------------------------------------------
// Personal to-dos live in "Little data". A project's to-dos live in its board, so
// everyone the project is shared with sees the same team board.

function listTodos_(projects) {
  const todos = readRows_(getDb_(), 'Todos');
  (projects || listProjects_()).forEach(function (p) {
    if (p.unavailable) return;
    try {
      readRows_(openBoard_(p.boardId), 'Todos').forEach(function (t) { t.projectId = p.id; todos.push(t); });
    } catch (e) { p.unavailable = true; }
  });
  return todos.sort(byNewest_);
}

function listTodos() {
  return listTodos_();
}

/** Adds or updates a to-do. Pass prevProjectId when it moves between projects. */
function saveTodo(todo, prevProjectId) {
  const t = Object.assign({}, todo);
  t.id = t.id || uuid_();
  t.title = String(t.title || '').trim();
  if (!t.title) throw new Error('Give the to-do a name.');
  t.status = t.status || 'todo';
  t.createdAt = t.createdAt || now_();
  t.createdBy = t.createdBy || me_();
  t.updatedAt = now_();
  const target = t.projectId || null;
  withLock_(function () {
    if (prevProjectId !== undefined && (prevProjectId || null) !== target) deleteRow_(storeFor_(prevProjectId || null), 'Todos', t.id);
    upsertRow_(storeFor_(target), 'Todos', t);
  });
  return t;
}

function deleteTodo(id, projectId) {
  withLock_(function () { deleteRow_(storeFor_(projectId || null), 'Todos', id); });
  return true;
}

/** "**Priya**: send the deck by Friday" -> owner Priya, title "Send the deck by Friday". */
function parseAction_(text) {
  const clean = function (s) { return String(s).replace(/\*\*/g, '').trim(); };
  const m = String(text).match(/^\*\*([^*]+)\*\*\s*[:\-–]\s*(.+)$/);
  if (!m) return { title: clean(text) };
  const title = clean(m[2]);
  return { owner: clean(m[1]), title: title.charAt(0).toUpperCase() + title.slice(1) };
}

/** Adds one action item from a meeting to the board. */
function addActionToTodo(noteId, projectId, text) {
  const a = parseAction_(text);
  const store = storeFor_(projectId || null);
  const dup = readRows_(store, 'Todos').filter(function (t) { return t.noteId === noteId && t.title.toLowerCase() === a.title.toLowerCase(); })[0];
  if (dup) { dup.projectId = projectId || undefined; return dup; }
  return saveTodo({ title: a.title, owner: a.owner, noteId: noteId, projectId: projectId || undefined });
}

// ---- Ideas (private, never shared) ----------------------------------------------------

function saveIdea(idea) {
  const i = Object.assign({ color: 'plain' }, idea);
  i.id = i.id || uuid_();
  i.text = String(i.text || '').trim();
  i.createdAt = i.createdAt || now_();
  i.updatedAt = now_();
  withLock_(function () { upsertRow_(getDb_(), 'Ideas', i); });
  return i;
}

function deleteIdea(id) {
  withLock_(function () { deleteRow_(getDb_(), 'Ideas', id); });
  return true;
}
