/**
 * Little for Google Apps Script
 * ------------------------------------------------------------------
 * A Granola / Wispr Flow style notes app that runs as an Apps Script web app.
 *
 * Storage, all in the signed-in user's own Google account:
 *   Drive:  a "Little" folder. Each note gets a folder with notes.md,
 *           transcript.json, ai-notes.md and the recording.
 *   Sheets: a "Little data" spreadsheet inside that folder with tabs
 *           Notes, Projects, Todos, Ideas, Inbox, SlackSeen.
 *           Each project also gets a "Little board" spreadsheet in its own
 *           folder (its notes and team to-dos), so sharing the folder
 *           shares the board.
 *   Keys:   AI keys and the Slack token live in this user's private
 *           UserProperties. Nobody else using the web app can read them.
 *
 * Files in this project:
 *   Code.gs          web app entry, setup, storage helpers, settings
 *   Notes.gs         notes, projects, sharing, to-dos, ideas, search
 *   Ai.gs            Gemini / OpenAI / Claude calls and AI features
 *   Integrations.gs  Google Calendar, Slack inbox, Google Docs, email
 *   Index.html, Styles.html, App.html   the front end
 */

const ROOT_NAME = 'Little';
const DB_NAME = 'Little data';
const BOARD_NAME = 'Little board';

const COLUMNS = {
  Notes: ['id', 'title', 'createdAt', 'updatedAt', 'durationSec', 'kind', 'language', 'template', 'tags', 'pinned',
    'attendees', 'calendarEventId', 'folderId', 'notesFileId', 'transcriptFileId', 'audioFileId', 'aiNotesFileId',
    'actions', 'createdBy', 'search'],
  Projects: ['id', 'name', 'color', 'folderId', 'boardId', 'createdAt', 'owner', 'shared', 'role'],
  Todos: ['id', 'title', 'status', 'noteId', 'owner', 'due', 'urgent', 'link', 'createdBy', 'createdAt', 'updatedAt'],
  Ideas: ['id', 'text', 'color', 'pinned', 'riff', 'createdAt', 'updatedAt'],
  Inbox: ['key', 'messageId', 'title', 'due', 'who', 'where', 'at', 'quote', 'link', 'mine', 'status'],
  SlackSeen: ['id', 'at'],
  Meta: ['key', 'value'],
};
const JSON_COLS = { tags: 1, attendees: 1, actions: 1 };
const BOOL_COLS = { pinned: 1, urgent: 1, shared: 1, mine: 1 };
const NUM_COLS = { durationSec: 1 };
const SEARCH_MAX = 45000; // a Sheets cell holds 50,000 characters

const LANGUAGES = [
  { code: 'en-IN', name: 'English', native: 'English', script: 'Latin' },
  { code: 'hi-IN', name: 'Hindi', native: 'हिंदी', script: 'Devanagari' },
  { code: 'mr-IN', name: 'Marathi', native: 'मराठी', script: 'Devanagari' },
  { code: 'bn-IN', name: 'Bengali', native: 'বাংলা', script: 'Bengali' },
  { code: 'ta-IN', name: 'Tamil', native: 'தமிழ்', script: 'Tamil' },
  { code: 'te-IN', name: 'Telugu', native: 'తెలుగు', script: 'Telugu' },
  { code: 'gu-IN', name: 'Gujarati', native: 'ગુજરાતી', script: 'Gujarati' },
  { code: 'kn-IN', name: 'Kannada', native: 'ಕನ್ನಡ', script: 'Kannada' },
  { code: 'ml-IN', name: 'Malayalam', native: 'മലയാളം', script: 'Malayalam' },
  { code: 'pa-IN', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'Gurmukhi' },
  { code: 'ur-IN', name: 'Urdu', native: 'اردو', script: 'Urdu (Nastaliq)' },
];

const DEFAULT_SETTINGS = { saveAudio: true, defaultLanguage: 'en-IN', aiProvider: null };
const PROVIDERS = ['gemini', 'openai', 'anthropic'];

// ---- Web app entry ------------------------------------------------------------

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.joinFolder = (e && e.parameter && e.parameter.join) || '';
  return t.evaluate()
    .setTitle('Little')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Lets Index.html pull in Styles.html and App.html. */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Run this once from the editor to create the folder and spreadsheet and approve permissions. */
function setup() {
  const root = getRoot_();
  const db = getDb_();
  Logger.log('Little is ready. Folder: %s  Data: %s', root.getUrl(), db.getUrl());
}

/** Everything the app needs on first paint, in one round trip. */
function bootstrap() {
  const email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  const projects = listProjects_();
  return {
    user: { email: email, name: nameFromEmail_(email) },
    settings: getSettings_(),
    keys: keyStatus_(),
    slack: slackStatus_(),
    projects: projects,
    notes: listNotes_(projects),
    todos: listTodos_(projects),
    ideas: readRows_(getDb_(), 'Ideas').sort(byNewest_),
    inboxCount: inboxPending_().length,
    templates: TEMPLATES.map(function (t) { return { id: t.id, name: t.name, emoji: t.emoji, blurb: t.blurb, outline: t.outline }; }),
    languages: LANGUAGES,
    folderUrl: getRoot_().getUrl(),
    dataUrl: getDb_().getUrl(),
    appUrl: ScriptApp.getService().getUrl(),
  };
}

function nameFromEmail_(email) {
  const local = String(email || '').split('@')[0].split(/[._-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there';
}

// ---- Settings and keys (private to each user) ----------------------------------

function props_() {
  return PropertiesService.getUserProperties();
}

function getSettings_() {
  const raw = props_().getProperty('settings');
  const s = Object.assign({}, DEFAULT_SETTINGS, raw ? JSON.parse(raw) : {});
  // Use a provider that actually has a key.
  if (s.aiProvider && !getKey_(s.aiProvider)) s.aiProvider = null;
  return s;
}

function saveSettings(patch) {
  const s = Object.assign(getSettings_(), patch || {});
  props_().setProperty('settings', JSON.stringify({ saveAudio: !!s.saveAudio, defaultLanguage: s.defaultLanguage, aiProvider: s.aiProvider || null }));
  return { settings: getSettings_(), keys: keyStatus_() };
}

function getKey_(provider) {
  return props_().getProperty('key_' + provider) || '';
}

function keyStatus_() {
  const out = {};
  PROVIDERS.forEach(function (p) {
    const k = getKey_(p);
    out[p] = k ? '••••' + k.slice(-4) : '';
  });
  return out;
}

/** Checks a key with a tiny request, then saves it. */
function saveKey(provider, key) {
  if (PROVIDERS.indexOf(provider) < 0) throw new Error('Unknown provider');
  key = String(key || '').trim();
  if (!key) {
    props_().deleteProperty('key_' + provider);
    return saveSettings({});
  }
  const check = verifyKey_(provider, key);
  if (check !== 'ok') throw new Error(check);
  props_().setProperty('key_' + provider, key);
  const s = getSettings_();
  return saveSettings({ aiProvider: s.aiProvider || provider });
}

// ---- Drive and Sheets storage ------------------------------------------------

function getRoot_() {
  const p = props_();
  const id = p.getProperty('rootFolderId');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* deleted: make a new one */ }
  }
  const found = DriveApp.getRootFolder().getFoldersByName(ROOT_NAME);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(ROOT_NAME);
  p.setProperty('rootFolderId', folder.getId());
  return folder;
}

let dbCache_ = null;
function getDb_() {
  if (dbCache_) return dbCache_;
  const p = props_();
  const id = p.getProperty('dbId');
  if (id) {
    try {
      const file = DriveApp.getFileById(id);
      if (!file.isTrashed()) return (dbCache_ = SpreadsheetApp.openById(id));
    } catch (e) { /* make a new one */ }
  }
  const root = getRoot_();
  const existing = root.getFilesByName(DB_NAME);
  let ss;
  if (existing.hasNext()) {
    ss = SpreadsheetApp.openById(existing.next().getId());
  } else {
    ss = SpreadsheetApp.create(DB_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    ['Notes', 'Projects', 'Todos', 'Ideas', 'Inbox', 'SlackSeen'].forEach(function (n) { table_(ss, n); });
    const first = ss.getSheetByName('Sheet1');
    if (first) ss.deleteSheet(first);
  }
  p.setProperty('dbId', ss.getId());
  return (dbCache_ = ss);
}

const boardCache_ = {};
function openBoard_(boardId) {
  if (!boardCache_[boardId]) boardCache_[boardId] = SpreadsheetApp.openById(boardId);
  return boardCache_[boardId];
}

/** The spreadsheet that holds a project's notes and to-dos, or the personal one. */
function storeFor_(projectId) {
  if (!projectId) return getDb_();
  const p = findProject_(projectId);
  if (!p) throw new Error('Project not found');
  return openBoard_(p.boardId);
}

function table_(ss, name) {
  let sh = ss.getSheetByName(name);
  const cols = COLUMNS[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Plain text everywhere, so Sheets never turns ids, dates or "=..." into something else.
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  }
  return sh;
}

function toCell_(col, v) {
  if (v === undefined || v === null) return '';
  if (JSON_COLS[col]) return JSON.stringify(v);
  if (BOOL_COLS[col]) return v ? 'TRUE' : '';
  return String(v);
}

function fromCell_(col, v) {
  if (v instanceof Date) return col === 'due' ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : v.toISOString();
  if (JSON_COLS[col]) {
    if (!v) return col === 'tags' || col === 'actions' || col === 'attendees' ? [] : null;
    try { return JSON.parse(v); } catch (e) { return []; }
  }
  if (BOOL_COLS[col]) return v === true || v === 'TRUE';
  if (NUM_COLS[col]) return Number(v) || 0;
  return v === '' ? undefined : String(v);
}

function readRows_(ss, name) {
  const sh = table_(ss, name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = COLUMNS[name];
  return sh.getRange(2, 1, last - 1, cols.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) {
      const o = {};
      cols.forEach(function (c, i) {
        const v = fromCell_(c, r[i]);
        if (v !== undefined) o[c] = v;
      });
      return o;
    });
}

function rowIndex_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

/** Inserts or replaces a row, keyed on the first column. */
function upsertRow_(ss, name, obj) {
  const sh = table_(ss, name);
  const cols = COLUMNS[name];
  const row = cols.map(function (c) { return toCell_(c, obj[c]); });
  let at = rowIndex_(sh, obj[cols[0]]);
  if (at < 0) at = sh.getLastRow() + 1;
  sh.getRange(at, 1, 1, cols.length).setNumberFormat('@').setValues([row]);
  return obj;
}

function getRow_(ss, name, id) {
  const sh = table_(ss, name);
  const at = rowIndex_(sh, id);
  if (at < 0) return null;
  const cols = COLUMNS[name];
  const r = sh.getRange(at, 1, 1, cols.length).getValues()[0];
  const o = {};
  cols.forEach(function (c, i) { const v = fromCell_(c, r[i]); if (v !== undefined) o[c] = v; });
  return o;
}

function deleteRow_(ss, name, id) {
  const sh = table_(ss, name);
  const at = rowIndex_(sh, id);
  if (at > 0) sh.deleteRow(at);
}

/** One writer at a time, across everyone using the app (shared boards need it). */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function uuid_() {
  return Utilities.getUuid();
}

function now_() {
  return new Date().toISOString();
}

function byNewest_(a, b) {
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}

function safeName_(name, fallback) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, ' ').trim() || fallback;
}

function writeFile_(folder, name, mime, content, fileId) {
  if (fileId) {
    try {
      const f = DriveApp.getFileById(fileId);
      f.setContent(content);
      return fileId;
    } catch (e) { /* recreate below */ }
  }
  return folder.createFile(name, content, mime).getId();
}

function readFile_(fileId) {
  if (!fileId) return '';
  try {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  } catch (e) {
    return '';
  }
}
