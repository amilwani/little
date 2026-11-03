// Google Calendar, Slack inbox, Google Docs export and email.

// ---- Google Calendar --------------------------------------------------------------

/** Events from the user's main calendar between two ISO times. */
function listEvents(fromIso, toIso) {
  const cal = CalendarApp.getDefaultCalendar();
  const calId = cal.getId();
  return cal.getEvents(new Date(fromIso), new Date(toIso))
    .filter(function (e) {
      try { return e.getMyStatus() !== CalendarApp.GuestStatus.NO; } catch (err) { return true; }
    })
    .map(function (e) {
      const allDay = e.isAllDayEvent();
      const id = e.getId();
      const start = allDay ? e.getAllDayStartDate() : e.getStartTime();
      const end = allDay ? e.getAllDayEndDate() : e.getEndTime();
      const eid = Utilities.base64EncodeWebSafe(id.split('@')[0] + ' ' + calId).replace(/=+$/, '');
      let description = '';
      try { description = e.getDescription(); } catch (err) { /* no access */ }
      const meetLink = function (d, ev) {
        const m = String(d + ' ' + (ev.getLocation() || '')).match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/);
        return m ? m[0] : undefined;
      };
      return {
        // Repeating meetings share one id, so add the start time.
        id: id + '_' + start.getTime(),
        eventId: id,
        title: String(e.getTitle() || '').trim() || '(No title)',
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: allDay,
        attendees: e.getGuestList(true).map(function (g) { return { email: g.getEmail(), name: g.getName() || undefined, self: g.getEmail() === me_() }; }),
        meetLink: meetLink(description, e),
        htmlLink: 'https://www.google.com/calendar/event?eid=' + eid,
        description: description,
      };
    });
}

// ---- Slack inbox -----------------------------------------------------------------
// The user pastes a Slack *user* token (xoxp-...) with the search:read scope, from a
// Slack app they create once. It's stored in their private UserProperties.

function slackStatus_() {
  const raw = props_().getProperty('slack');
  if (!raw) return { connected: false };
  const s = JSON.parse(raw);
  return { connected: true, team: s.team };
}

function slackCall_(token, method, params) {
  const res = UrlFetchApp.fetch('https://slack.com/api/' + method, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    payload: params || {},
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 429) throw new Error('Slack asked us to slow down. Try again in a minute.');
  return JSON.parse(res.getContentText() || '{}');
}

function connectSlack(token) {
  token = String(token || '').trim();
  if (!/^xox[pe]-/.test(token)) throw new Error('Paste the "User OAuth Token". It starts with xoxp-.');
  const who = slackCall_(token, 'auth.test');
  if (!who.ok) throw new Error('Slack rejected that token (' + who.error + ').');
  const probe = slackCall_(token, 'search.messages', { query: 'a', count: '1' });
  if (!probe.ok && probe.error === 'missing_scope') throw new Error('Add the search:read user scope to your Slack app, reinstall it, and copy the new token.');
  props_().setProperty('slack', JSON.stringify({ token: token, userId: who.user_id, team: who.team || 'Slack' }));
  return slackStatus_();
}

function disconnectSlack() {
  props_().deleteProperty('slack');
  const db = getDb_();
  withLock_(function () {
    ['Inbox', 'SlackSeen'].forEach(function (n) {
      const sh = table_(db, n);
      if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
  });
  return slackStatus_();
}

/** Turns Slack's markup (<@U1>, <#C1|name>, <url|label>, &amp;) into plain text. */
function slackPlain_(text, names, me) {
  return String(text)
    .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, function (_, id, label) { return id === me ? '@you' : '@' + (label || names[id] || 'someone'); })
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** DMs, @mentions and your own messages from the last few days. */
function slackMessages_(s, days) {
  const since = Utilities.formatDate(new Date(Date.now() - days * 864e5), 'UTC', 'yyyy-MM-dd');
  const matches = [];
  for (let page = 1; page <= 3; page++) {
    const data = slackCall_(s.token, 'search.messages', {
      query: 'after:' + since, sort: 'timestamp', sort_dir: 'desc', count: '100', page: String(page), highlight: 'false',
    });
    if (!data.ok) {
      if (/invalid_auth|token_revoked|account_inactive/.test(data.error)) {
        props_().deleteProperty('slack');
        throw new Error('Slack signed you out. Connect again in the Inbox.');
      }
      throw new Error('Slack returned an error (' + data.error + ').');
    }
    Array.prototype.push.apply(matches, (data.messages && data.messages.matches) || []);
    if (page >= ((data.messages && data.messages.paging && data.messages.paging.pages) || 1)) break;
  }
  const names = {};
  matches.forEach(function (m) { if (m.user && m.username) names[m.user] = m.username; });
  return matches
    .filter(function (m) { return String(m.text || '').trim(); })
    .filter(function (m) {
      const dm = !!(m.channel && (m.channel.is_im || m.channel.is_mpim));
      return dm || m.user === s.userId || String(m.text).indexOf('<@' + s.userId) >= 0;
    })
    .slice(0, 150)
    .map(function (m) {
      const dm = !!(m.channel && (m.channel.is_im || m.channel.is_mpim));
      return {
        id: ((m.channel && m.channel.id) || '?') + ':' + m.ts,
        at: new Date(Number(m.ts) * 1000).toISOString(),
        from: m.user === s.userId ? 'you' : (m.username || names[m.user] || 'someone'),
        where: dm ? (m.channel.is_mpim ? 'Group DM' : 'DM') : '#' + ((m.channel && m.channel.name) || 'channel'),
        text: slackPlain_(m.text, names, s.userId).slice(0, 1200),
        link: m.permalink,
      };
    });
}

function inboxPending_() {
  return readRows_(getDb_(), 'Inbox').filter(function (i) { return i.status !== 'handled'; })
    .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
}

/** Fetches new Slack messages, has the AI pick out actionables, and returns what's waiting. */
function refreshInbox(days) {
  const raw = props_().getProperty('slack');
  if (!raw) return { connected: false, items: [] };
  const s = JSON.parse(raw);
  days = Math.min(7, Math.max(1, Number(days) || 2));
  const db = getDb_();
  const seen = {};
  readRows_(db, 'SlackSeen').forEach(function (r) { seen[r.id] = 1; });
  const fresh = slackMessages_(s, days).filter(function (m) { return !seen[m.id]; });
  let found = [];
  if (fresh.length) {
    // Oldest first, in batches, so long gaps still fit in one AI request each.
    fresh.reverse();
    for (let i = 0; i < fresh.length; i += 60) {
      const batch = fresh.slice(i, i + 60);
      found = found.concat(extractSlackActions_(batch).map(function (a) {
        const m = batch[a.ref - 1];
        return {
          key: m.id + '|' + a.title.toLowerCase().slice(0, 60), messageId: m.id, title: a.title, due: a.due, who: a.who,
          where: m.where, at: m.at, quote: m.text.slice(0, 300), link: m.link, mine: a.who === 'you', status: 'new',
        };
      }));
    }
    withLock_(function () {
      found.forEach(function (it) { if (!getRow_(db, 'Inbox', it.key)) upsertRow_(db, 'Inbox', it); });
      const sh = table_(db, 'SlackSeen');
      const rows = fresh.map(function (m) { return [m.id, m.at]; });
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
    });
  }
  return { connected: true, team: s.team, scanned: fresh.length, items: inboxPending_() };
}

function listInbox() {
  const st = slackStatus_();
  return { connected: st.connected, team: st.team, items: st.connected ? inboxPending_() : [] };
}

/** "todo" adds the item to your to-dos; "dismiss" just hides it. */
function handleInboxItem(key, action, projectId) {
  const db = getDb_();
  const item = getRow_(db, 'Inbox', key);
  if (!item) return listInbox();
  let todo = null;
  if (action === 'todo') {
    todo = saveTodo({ title: item.title, due: item.due, link: item.link, projectId: projectId || undefined });
  }
  withLock_(function () { upsertRow_(db, 'Inbox', Object.assign(item, { status: 'handled' })); });
  return { todo: todo, inbox: listInbox() };
}

/** Optional: run this once from the editor to check Slack every hour in the background. */
function installHourlyInbox() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'hourlyInbox') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('hourlyInbox').timeBased().everyHours(1).create();
}

function hourlyInbox() {
  try { refreshInbox(1); } catch (e) { console.warn(e); }
}

// ---- Share a note: Google Doc, email ---------------------------------------------------

function inline_(text) {
  return String(text).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
}

function appendMarkdown_(body, md) {
  String(md || '').replace(/\r/g, '').split('\n').forEach(function (raw) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const task = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) {
      body.appendParagraph(inline_(h[2])).setHeading([DocumentApp.ParagraphHeading.HEADING2, DocumentApp.ParagraphHeading.HEADING3, DocumentApp.ParagraphHeading.HEADING4][h[1].length - 1]);
    } else if (task) {
      body.appendListItem((task[1] === ' ' ? '☐ ' : '☑ ') + inline_(task[2])).setGlyphType(DocumentApp.GlyphType.BULLET);
    } else if (bullet) {
      body.appendListItem(inline_(bullet[1])).setGlyphType(DocumentApp.GlyphType.BULLET);
    } else if (num) {
      body.appendListItem(inline_(num[1])).setGlyphType(DocumentApp.GlyphType.NUMBER);
    } else {
      body.appendParagraph(inline_(line));
    }
  });
}

function fmtTime_(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = ('0' + (sec % 60)).slice(-2);
  return h ? h + ':' + ('0' + m).slice(-2) + ':' + s : m + ':' + s;
}

function noteHeader_(meta) {
  const when = Utilities.formatDate(new Date(meta.createdAt), Session.getScriptTimeZone(), 'd MMM yyyy, h:mm a');
  return when + (meta.kind === 'written' ? '' : ' · ' + fmtTime_(meta.durationSec)) +
    ((meta.attendees || []).length ? ' · With ' + meta.attendees.join(', ') : '');
}

/** Saves the note as a Google Doc in the note's folder and returns its link. */
function exportToDoc(id, projectId) {
  const n = getNote(id, projectId);
  const doc = DocumentApp.create(n.meta.title);
  const body = doc.getBody();
  body.appendParagraph(n.meta.title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(noteHeader_(n.meta)).setItalic(true);
  if (n.aiNotes) appendMarkdown_(body, n.aiNotes);
  if (String(n.notes).trim()) {
    body.appendParagraph('My notes').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    appendMarkdown_(body, n.notes);
  }
  if (n.transcript.segments.length) {
    body.appendParagraph('Transcript').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    n.transcript.segments.forEach(function (s) {
      body.appendParagraph(fmtTime_(s.startSec) + '  ' + (s.speaker ? s.speaker + ': ' : '') + s.text);
    });
  }
  const first = body.getChild(0);
  if (first && first.getType() === DocumentApp.ElementType.PARAGRAPH && !first.asParagraph().getText()) first.removeFromParent();
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(DriveApp.getFolderById(n.meta.folderId));
  return doc.getUrl();
}

/** Plain text of a note, for WhatsApp, email or any app. */
function noteAsText_(n) {
  const toText = function (md) {
    return String(md).replace(/^#{1,3}\s+(.*)$/gm, function (_, t) { return t.toUpperCase(); })
      .replace(/^(\s*)[-*]\s+\[ \]\s+/gm, '$1☐ ').replace(/^(\s*)[-*]\s+\[[xX]\]\s+/gm, '$1☑ ')
      .replace(/^(\s*)[-*]\s+/gm, '$1• ').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim();
  };
  const parts = [n.meta.title, noteHeader_(n.meta), ''];
  if (n.aiNotes) parts.push(toText(n.aiNotes), '');
  if (String(n.notes).trim()) parts.push('MY NOTES', toText(n.notes), '');
  parts.push('— Written with Little');
  return parts.join('\n');
}

function noteText(id, projectId) {
  return noteAsText_(getNote(id, projectId));
}

/** Emails the note from the user's own Gmail. */
function emailNote(id, projectId, to) {
  const emails = parseEmails_(to);
  if (!emails.length) throw new Error('Add an email address.');
  const n = getNote(id, projectId);
  MailApp.sendEmail({ to: emails.join(','), subject: n.meta.title, body: noteAsText_(n) });
  return emails.length;
}
