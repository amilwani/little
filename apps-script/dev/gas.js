// A small fake of the Apps Script services Little uses, so the .gs files can run in Node.
// State (Drive, Sheets, properties) lives across calls; each RPC runs the scripts in a
// fresh context, like a real Apps Script execution.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = process.env.GAS_SRC || path.join(__dirname, '..');
const log = { mail: [], fetch: [], triggers: [] };
let idn = 0;
const newId = (p) => (p || 'F') + crypto.randomBytes(14).toString('hex').slice(0, 26) + (++idn);

// ---- Drive -------------------------------------------------------------
const drive = { items: new Map() }; // id -> item
function mkItem(kind, name, parent, extra) {
  const it = Object.assign({ id: newId(kind === 'folder' ? 'D' : 'F'), kind, name, parent: parent || null, trashed: false, editors: [], owner: current.user }, extra || {});
  drive.items.set(it.id, it);
  return it;
}
function Blob(bytes, mime, name) {
  this._bytes = Buffer.from(bytes || []);
  this._mime = mime || 'application/octet-stream';
  this._name = name || 'blob';
}
Blob.prototype.getBytes = function () { return Array.from(this._bytes).map((b) => (b > 127 ? b - 256 : b)); };
Blob.prototype.getDataAsString = function () { return this._bytes.toString('utf8'); };
Blob.prototype.getContentType = function () { return this._mime; };
Blob.prototype.getName = function () { return this._name; };
function toBuf(x) { if (Buffer.isBuffer(x)) return x; if (Array.isArray(x)) return Buffer.from(x.map((b) => (b < 0 ? b + 256 : b))); return Buffer.from(String(x), 'utf8'); }

function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
function children(folderId, kind, name) {
  return [...drive.items.values()].filter((it) => it.parent === folderId && it.kind === kind && !it.trashed && (name == null || it.name === name));
}
function wrapFile(it) {
  if (!it || it.kind !== 'file') throw new Error('No item with the given ID could be found.');
  return {
    getId: () => it.id, getName: () => it.name, getUrl: () => 'https://drive.google.com/file/d/' + it.id + '/view',
    getBlob: () => new Blob(it.bytes, it.mime, it.name), getSize: () => it.bytes.length, getMimeType: () => it.mime,
    setContent: (c) => { it.bytes = toBuf(c); return wrapFile(it); }, isTrashed: () => it.trashed,
    setTrashed: (t) => { it.trashed = !!t; }, moveTo: (f) => { it.parent = f.getId(); return wrapFile(it); },
  };
}
function wrapFolder(it) {
  if (!it || it.kind !== 'folder') throw new Error('No item with the given ID could be found.');
  const self = {
    getId: () => it.id, getName: () => it.name, setName: (n) => { it.name = n; return self; },
    getUrl: () => 'https://drive.google.com/drive/folders/' + it.id, isTrashed: () => it.trashed,
    setTrashed: (t) => { it.trashed = !!t; }, moveTo: (f) => { it.parent = f.getId(); return self; },
    createFolder: (n) => wrapFolder(mkItem('folder', n, it.id)),
    createFile: (a, b, c) => {
      if (a instanceof Blob) return wrapFile(mkItem('file', a._name, it.id, { bytes: a._bytes, mime: a._mime }));
      return wrapFile(mkItem('file', a, it.id, { bytes: toBuf(b), mime: c || 'text/plain' }));
    },
    getFilesByName: (n) => iter(children(it.id, 'file', n).map(wrapFile)),
    getFoldersByName: (n) => iter(children(it.id, 'folder', n).map(wrapFolder)),
    addEditor: (e) => { if (!/@/.test(e)) throw new Error('Invalid email: ' + e); if (it.editors.indexOf(e) < 0) it.editors.push(e); return self; },
    removeEditor: (e) => { it.editors = it.editors.filter((x) => x !== (e.getEmail ? e.getEmail() : e)); return self; },
    getEditors: () => it.editors.map((e) => ({ getEmail: () => e, getName: () => e.split('@')[0] })),
    getOwner: () => ({ getEmail: () => it.owner, getName: () => it.owner.split('@')[0] }),
  };
  return self;
}
function rootId() {
  const id = 'ROOT:' + current.user;
  if (!drive.items.has(id)) drive.items.set(id, { id, kind: 'folder', name: 'My Drive', parent: null, trashed: false, editors: [], owner: current.user });
  return id;
}
const DriveApp = {
  getRootFolder: () => wrapFolder(drive.items.get(rootId())),
  getFolderById: (id) => wrapFolder(drive.items.get(id)),
  getFileById: (id) => wrapFile(drive.items.get(id)),
  createFolder: (n) => wrapFolder(mkItem('folder', n, rootId())),
};

// ---- Sheets ------------------------------------------------------------
const sheets = new Map(); // spreadsheet id -> { name, tabs: Map(name -> {rows: [][], frozen, formats}) }
function wrapSheet(ssid, name) {
  const tab = () => { const t = sheets.get(ssid).tabs.get(name); if (!t) throw new Error('Sheet deleted'); return t; };
  const self = {
    getName: () => name,
    getMaxRows: () => Math.max(1000, tab().rows.length),
    getLastRow: () => { const r = tab().rows; for (let i = r.length - 1; i >= 0; i--) if (r[i] && r[i].some((v) => v !== '' && v != null)) return i + 1; return 0; },
    setFrozenRows: () => self,
    getRange: (row, col, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      if (row < 1 || col < 1) throw new Error('Range out of bounds');
      const range = {
        setValues: (vals) => {
          if (vals.length !== nr || vals.some((v) => v.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range. Data ' + vals.length + 'x' + (vals[0] || []).length + ', range ' + nr + 'x' + nc);
          const rows = tab().rows;
          for (let i = 0; i < nr; i++) {
            rows[row - 1 + i] = rows[row - 1 + i] || [];
            for (let j = 0; j < nc; j++) {
              const v = vals[i][j];
              if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
              if (typeof v === 'object' && v !== null) throw new Error('Unsupported cell value ' + v);
              rows[row - 1 + i][col - 1 + j] = v;
            }
          }
          return range;
        },
        getValues: () => {
          const rows = tab().rows; const out = [];
          for (let i = 0; i < nr; i++) { const r = []; for (let j = 0; j < nc; j++) { const v = (rows[row - 1 + i] || [])[col - 1 + j]; r.push(v == null ? '' : v); } out.push(r); }
          return out;
        },
        setNumberFormat: () => range, setFontWeight: () => range,
      };
      return range;
    },
    deleteRow: (i) => { tab().rows.splice(i - 1, 1); },
    deleteRows: (i, n) => { tab().rows.splice(i - 1, n); },
  };
  return self;
}
function wrapSS(id) {
  const ss = sheets.get(id);
  if (!ss || drive.items.get(id).trashed) throw new Error('Unexpected error while getting the method or property openById on object SpreadsheetApp.');
  return {
    getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
    getSheetByName: (n) => (ss.tabs.has(n) ? wrapSheet(id, n) : null),
    insertSheet: (n) => { if (ss.tabs.has(n)) throw new Error('A sheet with the name "' + n + '" already exists.'); ss.tabs.set(n, { rows: [] }); return wrapSheet(id, n); },
    deleteSheet: (sh) => { if (ss.tabs.size === 1) throw new Error("You can't remove all the sheets in a document."); ss.tabs.delete(sh.getName()); },
  };
}
const SpreadsheetApp = {
  create: (name) => { const f = mkItem('file', name, rootId(), { bytes: Buffer.from(''), mime: 'application/vnd.google-apps.spreadsheet' }); sheets.set(f.id, { name, tabs: new Map([['Sheet1', { rows: [] }]]) }); return wrapSS(f.id); },
  openById: (id) => wrapSS(id),
  flush: () => {},
};

// ---- Docs --------------------------------------------------------------
const docs = new Map();
const DocumentApp = {
  ParagraphHeading: { TITLE: 'TITLE', HEADING2: 'H2', HEADING3: 'H3', HEADING4: 'H4' },
  GlyphType: { BULLET: 'BULLET', NUMBER: 'NUMBER' },
  ElementType: { PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM' },
  create: (name) => {
    const f = mkItem('file', name, rootId(), { bytes: Buffer.from(''), mime: 'application/vnd.google-apps.document' });
    const items = [{ type: 'PARAGRAPH', text: '' }];
    docs.set(f.id, items);
    const el = (o) => {
      const e = {
        setHeading: (h) => { o.heading = h; return e; }, setItalic: () => e, setGlyphType: (g) => { o.glyph = g; return e; },
        getType: () => o.type, asParagraph: () => ({ getText: () => o.text }), removeFromParent: () => { items.splice(items.indexOf(o), 1); },
      };
      return e;
    };
    const body = {
      appendParagraph: (t) => { if (typeof t !== 'string') throw new Error('appendParagraph needs text'); const o = { type: 'PARAGRAPH', text: t }; items.push(o); return el(o); },
      appendListItem: (t) => { const o = { type: 'LIST_ITEM', text: t }; items.push(o); return el(o); },
      getChild: (i) => (items[i] ? el(items[i]) : null),
    };
    return { getBody: () => body, saveAndClose: () => {}, getId: () => f.id, getUrl: () => 'https://docs.google.com/document/d/' + f.id + '/edit' };
  },
};

// ---- Properties, session, misc ----------------------------------------
const props = {}; // user -> {k: v}
const current = { user: 'aman@example.com' };
const PropertiesService = {
  getUserProperties: () => {
    const p = (props[current.user] = props[current.user] || {});
    return {
      getProperty: (k) => (k in p ? p[k] : null),
      setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('Property value too large'); p[k] = String(v); },
      deleteProperty: (k) => { delete p[k]; },
    };
  },
};
const Session = {
  getActiveUser: () => ({ getEmail: () => current.user }),
  getEffectiveUser: () => ({ getEmail: () => current.user }),
  getScriptTimeZone: () => 'Asia/Kolkata',
};
const LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };

function fmtDate(d, tz, f) {
  const pad = (n) => String(n).padStart(2, '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours();
  return f.replace(/yyyy|MMM|MM|dd|EEE|d|h|mm|a/g, (t) => ({
    yyyy: d.getFullYear(), MMM: months[d.getMonth()], MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), EEE: days[d.getDay()],
    d: d.getDate(), h: h % 12 || 12, mm: pad(d.getMinutes()), a: h < 12 ? 'AM' : 'PM',
  })[t]);
}
const Utilities = {
  getUuid: () => crypto.randomUUID(),
  newBlob: (data, mime, name) => new Blob(toBuf(data), mime, name),
  base64Encode: (x) => toBuf(x).toString('base64'),
  base64EncodeWebSafe: (x) => toBuf(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64Decode: (s) => Array.from(Buffer.from(s, 'base64')).map((b) => (b > 127 ? b - 256 : b)),
  formatDate: fmtDate,
};

// ---- Network: fake AI providers and Slack --------------------------------
const fake = { geminiKeyOk: true };
function resp(code, obj) { const t = typeof obj === 'string' ? obj : JSON.stringify(obj); return { getResponseCode: () => code, getContentText: () => t }; }
const UrlFetchApp = {
  fetch: (url, opt) => {
    opt = opt || {};
    const h = opt.headers || {};
    log.fetch.push({ url, method: opt.method || 'get', headers: h, payloadType: typeof opt.payload, payload: typeof opt.payload === 'string' ? opt.payload.slice(0, 3000) : opt.payload ? Object.keys(opt.payload) : null });
    if (url.indexOf('generativelanguage.googleapis.com') >= 0) {
      if (!/^AIza/.test(h['x-goog-api-key'] || '') || h['x-goog-api-key'].indexOf('BAD') >= 0) return resp(400, { error: { message: 'API key not valid' } });
      if (url.indexOf('/models?') >= 0) return resp(200, { models: [{ name: 'models/gemini-2.5-flash' }] });
      const body = JSON.parse(opt.payload);
      if (opt.contentType !== 'application/json') throw new Error('gemini contentType');
      const sys = body.systemInstruction.parts[0].text;
      let text;
      if (/Transcribe this audio/.test(sys)) {
        if (!body.contents[0].parts[0].inlineData.data) throw new Error('no audio');
        text = JSON.stringify([{ startSec: 0, speaker: 'Priya', text: 'Let us ship on Friday.' }, { startSec: 7, speaker: 'Aman', text: 'I will send the deck tomorrow.' }]);
      } else if (/Slack messages/.test(sys)) {
        text = JSON.stringify([{ ref: 1, title: 'Review the pricing doc', due: '2026-11-04', who: 'Ravi' }, { ref: 2, title: 'Send the deck', due: null, who: 'you' }]);
      } else if (/meeting notes from a transcript/.test(sys)) {
        text = '```markdown\n## Summary\nThe team agreed to **ship on Friday**.\n## Key points\n- Launch Friday\n## Action items\n- [ ] **Priya**: update the launch checklist\n- [ ] **Aman**: send the deck by tomorrow\n## Decisions\n- Ship on Friday\n```';
      } else if (/raw dictation/.test(sys)) {
        text = 'Hi team, the launch moves to Friday.';
      } else if (/answer questions about the user/.test(sys)) {
        text = 'You agreed to ship on Friday [1].';
      } else if (/Translate the user/.test(sys)) {
        text = '## सारांश\nशुक्रवार को लॉन्च।\n## Action items\n- [ ] **Priya**: चेकलिस्ट अपडेट करें';
      } else if (/creative partner/.test(sys)) {
        text = '### Sharper version\nA bold idea.\n### Ways to take it\n- One\n- Two\n- Three\n### First step\nDo it.\n### A question to sit with\nWhy?';
      } else text = 'ok';
      return resp(200, { candidates: [{ content: { parts: [{ text }] } }] });
    }
    if (url.indexOf('api.anthropic.com') >= 0) {
      if (!h['x-api-key'] || h['anthropic-version'] !== '2023-06-01') return resp(401, { error: { message: 'bad auth' } });
      if (url.indexOf('/v1/models') >= 0) return resp(200, { data: [] });
      const b = JSON.parse(opt.payload);
      if (b.model !== 'claude-opus-5-5' || h['anthropic-beta'] !== 'server-side-fallback-2026-07-01' || b.fallbacks !== 'default' || !b.output_config) return resp(400, { error: { message: 'bad request shape' } });
      return resp(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: '## Summary\nFrom Claude.\n## Action items\n- [ ] **Aman**: follow up' }] });
    }
    if (url.indexOf('api.openai.com') >= 0) {
      if (!/^Bearer sk-/.test(h.Authorization || '')) return resp(401, { error: { message: 'bad key' } });
      if (url.indexOf('/v1/models') >= 0) return resp(200, { data: [] });
      if (url.indexOf('audio/transcriptions') >= 0) {
        if (!opt.payload || !(opt.payload.file instanceof Blob)) throw new Error('whisper needs a blob');
        return resp(200, { text: 'hello', segments: [{ start: 0.2, text: ' hello there ' }] });
      }
      return resp(200, { choices: [{ message: { content: 'From OpenAI' } }] });
    }
    if (url.indexOf('slack.com/api/') >= 0) {
      const auth = h.Authorization || '';
      if (auth.indexOf('xoxp-good') < 0) return resp(200, { ok: false, error: 'invalid_auth' });
      if (/auth\.test/.test(url)) return resp(200, { ok: true, user_id: 'U1', team: 'Acme' });
      if (/search\.messages/.test(url)) {
        if (opt.payload.query === 'a') return resp(200, { ok: true, messages: { matches: [] } });
        const now = Math.floor(Date.now() / 1000);
        return resp(200, { ok: true, messages: { paging: { pages: 1 }, matches: [
          { ts: String(now - 3600), text: '<@U1> can you review the pricing doc by tomorrow? &amp; thanks', user: 'U2', username: 'ravi', permalink: 'https://acme.slack.com/p1', channel: { id: 'C1', name: 'pricing' } },
          { ts: String(now - 1800), text: "I'll send the deck", user: 'U1', username: 'aman', permalink: 'https://acme.slack.com/p2', channel: { id: 'D1', is_im: true } },
          { ts: String(now - 900), text: 'lunch?', user: 'U3', username: 'zoe', channel: { id: 'C2', name: 'random' } },
        ].reverse() } });
      }
    }
    return resp(404, 'not mocked: ' + url);
  },
};

// ---- Calendar, mail, script --------------------------------------------
function ev(title, startH, durMin, guests) {
  const s = new Date(); s.setHours(startH, 0, 0, 0);
  const e = new Date(s.getTime() + durMin * 60000);
  return {
    getId: () => 'evt' + title.replace(/\W/g, '') + '@google.com', getTitle: () => title, isAllDayEvent: () => false,
    getStartTime: () => s, getEndTime: () => e, getAllDayStartDate: () => s, getAllDayEndDate: () => e,
    getMyStatus: () => 'YES', getDescription: () => 'Join https://meet.google.com/abc-defg-hij', getLocation: () => '',
    getGuestList: () => guests.map((g) => ({ getEmail: () => g, getName: () => g.split('@')[0] })),
  };
}
const CalendarApp = {
  GuestStatus: { NO: 'NO', YES: 'YES' },
  getDefaultCalendar: () => ({
    getId: () => current.user,
    getEvents: (from, to) => {
      if (Object.prototype.toString.call(from) !== '[object Date]' || isNaN(from)) throw new Error('bad date');
      return [ev('Weekly review', 23, 30, ['priya@example.com', 'aman@example.com', 'ravi@example.com']), ev('Priya / Aman 1:1', 22, 30, ['priya@example.com', 'aman@example.com'])];
    },
  }),
};
const MailApp = { sendEmail: (o) => { if (!o.to || !o.subject) throw new Error('mail needs to and subject'); log.mail.push(o); } };
const ScriptApp = {
  getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }),
  getProjectTriggers: () => log.triggers.slice(),
  deleteTrigger: () => {},
  newTrigger: (fn) => { const b = { timeBased: () => b, everyHours: () => b, create: () => { log.triggers.push({ getHandlerFunction: () => fn }); } }; return b; },
};
const HtmlService = {
  XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
  createTemplateFromFile: (n) => { const t = { evaluate: () => { const o = { setTitle: () => o, addMetaTag: () => o, setFaviconUrl: () => o, setXFrameOptionsMode: () => o, getContent: () => renderTemplate(n, t) }; return o; } }; return t; },
  createHtmlOutputFromFile: (n) => ({ getContent: () => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8') }),
};
function renderTemplate(name, vars) {
  return fs.readFileSync(path.join(SRC, name + '.html'), 'utf8')
    .replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (_, n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8'))
    .replace(/<\?=\s*(\w+)\s*\?>/g, (_, v) => String(vars[v] == null ? '' : vars[v]).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'));
}

// ---- Running server functions ------------------------------------------
const code = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort().map((f) => '// ' + f + '\n' + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n');
const script = new vm.Script(code, { filename: 'apps-script.gs' });

function checkSerializable(v, where) {
  if (Object.prototype.toString.call(v) === '[object Date]') throw new Error('Date in return value at ' + where + ' (google.script.run drops it)');
  if (typeof v === 'function') throw new Error('Function in return value at ' + where);
  if (v && typeof v === 'object') for (const k of Object.keys(v)) checkSerializable(v[k], where + '.' + k);
}

function call(fn, args, user) {
  if (user) current.user = user;
  if (/_$/.test(fn)) throw new Error('Script function not found: ' + fn + ' (private functions end with _)');
  const ctx = { DriveApp, SpreadsheetApp, DocumentApp, PropertiesService, Session, LockService, Utilities, UrlFetchApp, CalendarApp, MailApp, ScriptApp, HtmlService, Logger: { log: () => {} }, console };
  vm.createContext(ctx);
  script.runInContext(ctx);
  if (typeof ctx[fn] !== 'function') {
    // top-level function declarations become globals; const/let do not, so fall back to evaluating the name
    const f = vm.runInContext('typeof ' + fn + " === 'function' ? " + fn + ' : null', ctx);
    if (!f) throw new Error('Script function not found: ' + fn);
    ctx[fn] = f;
  }
  const out = ctx[fn].apply(null, JSON.parse(JSON.stringify(args || [])));
  if (fn === 'doGet') return out.getContent();
  checkSerializable(out, fn);
  return out === undefined ? null : JSON.parse(JSON.stringify(out));
}

module.exports = { call, log, drive, sheets, props, current, fake, renderTemplate, Blob };
