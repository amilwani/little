// Drives the whole UI in Chromium against the fake Apps Script server.
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const OUT = process.env.SHOTS || require('os').tmpdir() + '/little-shots';
fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:8787/';

const FAKE_SPEECH = `
(() => {
  class FakeRec {
    constructor() { this.lang = 'en-IN'; this.continuous = false; this.interimResults = false; }
    start() {
      if (this._t) return;
      const words = ['we will ship on friday', 'priya owns the checklist', 'aman sends the deck tomorrow'];
      let i = 0;
      this._t = setInterval(() => {
        if (i >= words.length) return;
        const r = [{ transcript: words[i++] }]; r.isFinal = true;
        const results = []; results.length = i; results[i - 1] = r;
        this.onresult && this.onresult({ resultIndex: i - 1, results });
      }, 300);
    }
    stop() { clearInterval(this._t); this._t = null; setTimeout(() => this.onend && this.onend(), 0); }
  }
  window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
})();`;

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(FAKE_SPEECH);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let n = 0;
  const ok = (s) => console.log('  ✓', ++n, s);
  const toast = async (re) => { await page.waitForFunction((src) => [...document.querySelectorAll('.toast')].some((t) => new RegExp(src).test(t.textContent)), re.source, { timeout: 8000 }); };
  const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250); };

  await page.goto(URL);
  await page.waitForSelector('h1.display');
  assert.match(await page.textContent('h1.display'), /, Aman$/);
  await page.screenshot({ path: OUT + '/01-home-first-run.png', fullPage: true });
  ok('home renders for a new user');

  // AI key in two steps
  await page.click('[data-act="openKey"]');
  await page.click('#modal-root [data-act="keyOpened"]').catch(() => {});
  await page.fill('#modal-root #gemini-key', 'AIzaSyBAD00000000000000000000000000000');
  await page.press('#modal-root #gemini-key', 'Enter');
  await page.waitForSelector('#modal-root .tiny[style*="accent"]');
  await page.fill('#modal-root #gemini-key', 'AIzaSyGOOD000000000000000000000000000000');
  await page.press('#modal-root #gemini-key', 'Enter');
  await toast(/AI is on/);
  await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
  ok('Gemini key: wrong key shows an error, right key saves and closes');

  // Write a note
  await go('/write');
  await page.fill('#w-title', 'Pricing thoughts');
  await page.fill('#w-notes', '# Plan\n- raise price\n- [ ] email Ravi');
  await page.click('[data-act="saveWritten"]');
  await page.waitForSelector('#note-title');
  assert.equal(await page.inputValue('#note-title'), 'Pricing thoughts');
  ok('write a note and open it');

  // Record a meeting with the fake mic and speech
  await go('/record');
  await page.fill('#rec-title', 'Launch sync');
  await page.selectOption('#rec-tpl', 'review');
  assert.match(await page.inputValue('#rec-notes'), /## Progress/);
  await page.click('[data-act="recStart"]');
  await page.waitForSelector('.rec-dot');
  await page.waitForFunction(() => document.querySelectorAll('#live-transcript .seg-line').length >= 3, null, { timeout: 5000 });
  await page.click('[data-act="recPause"]');
  await page.waitForSelector('.rec-dot.paused');
  await page.click('[data-act="recPause"]');
  await page.fill('#rec-notes', '## Progress\nGood\n## Risks\nNone');
  await page.screenshot({ path: OUT + '/02-recording.png' });
  await page.waitForTimeout(800);
  await page.click('[data-act="recStop"]');
  await page.waitForSelector('#note-title', { timeout: 10000 });
  await toast(/AI notes are ready/);
  await page.waitForTimeout(300);
  await page.waitForSelector('.md h3', { timeout: 3000 });
  assert.match(await page.textContent('.md'), /ship on Friday/);
  await page.screenshot({ path: OUT + '/03-note-ai.png', fullPage: true });
  ok('record → pause/resume → stop → saved note with automatic AI notes');

  // Action items: tick and add to to-dos
  await page.click('.md li.task input[data-task="1"]');
  await toast(/one less thing/);
  await page.click('[data-act="actionTodo"][data-i="0"]');
  await toast(/Added to to-dos/);
  await page.waitForSelector('.md .chip');
  ok('tick action item, add one to to-dos');

  // Transcript tab, play, AI transcript
  await page.click('[data-act="noteTab"][data-tab="transcript"]');
  assert.match(await page.textContent('.transcript'), /we will ship on friday/);
  await page.click('[data-act="loadAudio"]');
  await page.waitForSelector('audio#player');
  await page.click('[data-act="noteTab"][data-tab="transcript"]');
  await page.click('[data-act="transcribe"]');
  await toast(/New transcript saved/);
  assert.match(await page.textContent('.transcript'), /Priya:/);
  await page.click('.seg-line.play >> nth=1');
  ok('transcript tab, playback, AI transcript with speakers, tap to seek');

  // My notes autosave
  await page.click('[data-act="noteTab"][data-tab="notes"]');
  await page.fill('#note-body', 'Edited after the meeting');
  await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved', null, { timeout: 6000 });
  ok('my notes autosave');

  // Tags, pin, translate, share
  await page.click('[data-act="addTag"]');
  await page.fill('#pm-input', 'launch');
  await page.press('#pm-input', 'Enter');
  await page.waitForSelector('.chip:has-text("#launch")');
  await page.click('[data-act="pinNote"]');
  await page.click('[data-act="noteTab"][data-tab="ai"]');
  await page.selectOption('#tr-lang', 'hi-IN');
  await page.waitForSelector('text=सारांश');
  await page.click('[data-act="hideTranslation"]');
  await page.click('[data-act="shareNote"]');
  await page.click('#sn-doc');
  await page.waitForSelector('#sn-msg a');
  await page.fill('#sn-to', 'ravi@example.com');
  await page.click('#sn-mail button');
  await page.waitForSelector('#sn-msg:has-text("Sent")');
  await page.click('#sn-copy');
  await toast(/Copied/);
  await page.keyboard.press('Escape');
  ok('tag, pin, translate to Hindi, share as Doc, email, copy');

  // Project: create, move notes in, share
  await page.click('.sidebar [data-act="newProject"]');
  await page.fill('#pm-input', 'Launch');
  await page.press('#pm-input', 'Enter');
  await page.waitForSelector('h1.display:has-text("Launch")');
  await go('/notes');
  await page.click('[data-act="selectMode"]');
  await page.click('.item[data-act="toggleSelect"] >> nth=0');
  await page.click('.item[data-act="toggleSelect"] >> nth=1');
  await page.click('[data-act="moveSelected"]');
  await page.click('#modal-root [data-pick]:has-text("Launch")');
  await toast(/Moved/);
  await page.click('.sidebar a:has-text("Launch")');
  await page.waitForFunction(() => document.querySelectorAll('.main .list .item').length >= 2);
  await page.click('[data-act="shareProject"]');
  await page.waitForSelector('#sh-emails');
  await page.fill('#sh-emails', 'priya@example.com');
  await page.click('#sh-form button');
  await page.waitForSelector('#modal-root :text("Invited")');
  await page.waitForSelector('#modal-root :text("priya@example.com")');
  await page.screenshot({ path: OUT + '/04-share-project.png' });
  await page.keyboard.press('Escape');
  ok('create project, move two notes in, share by email');

  // Search
  await go('/notes');
  await page.fill('#notes-q', 'checklist');
  await page.waitForFunction(() => document.querySelectorAll('.main .list .item').length >= 1 && !document.querySelector('.main .spinner'), null, { timeout: 6000 });
  assert.match(await page.textContent('.main .list'), /Launch sync/);
  ok('full-text search finds AI-notes text');

  // To-dos
  await go('/todos');
  await page.click('.spread [data-act="newTodo"]');
  await page.fill('#td-title', 'Book the venue');
  await page.fill('#td-owner', 'Aman');
  await page.fill('#td-due', '2026-11-05');
  await page.check('#td-urgent');
  await page.click('#td-form button.primary');
  await toast(/Added/);
  const card = page.locator('.todo:has-text("Book the venue")');
  await card.locator('select').selectOption('review');
  await page.waitForSelector('.col[data-status="review"] .todo:has-text("Book the venue")');
  await page.dragAndDrop('.todo:has-text("Book the venue")', '.col[data-status="done"]');
  await page.waitForSelector('.col[data-status="done"] .todo:has-text("Book the venue")');
  await page.click('[data-act="todoScope"][data-s="team"]');
  await page.click('[data-act="todoScope"][data-s="all"]');
  await page.click('.todo:has-text("Book the venue") .t-title');
  await page.click('#td-del');
  await toast(/Deleted/);
  await page.screenshot({ path: OUT + '/05-todos.png', fullPage: true });
  ok('to-dos: add, change status, drag to Complete, filters, delete');

  // Meetings → record with event
  await go('/meetings');
  await page.waitForSelector('[data-act="recordEvent"]');
  await page.locator('.item:has-text("Priya / Aman 1:1") [data-act="recordEvent"]').click();
  await page.waitForSelector('#rec-title');
  assert.equal(await page.inputValue('#rec-title'), 'Priya / Aman 1:1');
  assert.equal(await page.inputValue('#rec-tpl'), 'one-on-one');
  ok('meetings from calendar → record with title and 1:1 template');

  // Dictate
  await go('/dictate');
  await page.click('[data-act="dicToggle"]');
  await page.waitForFunction(() => document.querySelector('#dic-raw').value.length > 5, null, { timeout: 4000 });
  await page.click('[data-act="dicToggle"]');
  await page.waitForSelector('#dic-clean:has-text("Friday")');
  await page.click('[data-act="dicSave"]');
  await page.waitForSelector('#note-title');
  ok('dictate: talk → clean text → save as note');

  // Ask
  await go('/ask');
  await page.fill('#ask-q', 'When do we ship?');
  await page.press('#ask-q', 'Enter');
  await page.waitForSelector('a.cite');
  ok('ask your notes with cited sources');

  // Ideas
  await go('/ideas');
  await page.click('[data-act="ideaColor"][data-c="sky"]');
  await page.fill('#idea-new', 'Voice notes for doctors');
  await page.click('[data-act="addIdea"]');
  await toast(/Idea saved/);
  await page.click('[data-act="riffIdea"]');
  await page.waitForSelector('.riff h4, .riff h3');
  await page.click('[data-act="pinIdea"]');
  await page.screenshot({ path: OUT + '/06-ideas.png' });
  ok('ideas: add with color, riff, pin');

  // Slack inbox
  await go('/inbox');
  await page.fill('#slack-token', 'xoxp-nope');
  await page.press('#slack-token', 'Enter');
  await page.waitForTimeout(1500);
  await toast(/rejected/);
  await page.fill('#slack-token', 'xoxp-good-123');
  await page.press('#slack-token', 'Enter');
  await toast(/Slack connected/);
  await page.click('[data-act="refreshInbox"]');
  await page.waitForSelector('[data-act="inboxTodo"]');
  assert.match(await page.textContent('.main'), /Review the pricing doc/);
  await page.screenshot({ path: OUT + '/07-inbox.png', fullPage: true });
  await page.click('[data-act="inboxTodo"] >> nth=0');
  await toast(/Added to to-dos/);
  await page.click('[data-act="inboxDismiss"]');
  await page.waitForSelector('text=All clear');
  ok('Slack inbox: connect, find asks/promises, add to to-dos, dismiss');

  // Settings
  await go('/settings');
  await page.selectOption('#set-lang', 'hi-IN');
  await toast(/Saved/);
  await page.fill('[data-keyform="anthropic"] input', 'sk-ant-1');
  await page.press('[data-keyform="anthropic"] input', 'Enter');
  await toast(/Key saved/);
  await page.selectOption('#set-provider', 'anthropic');
  await toast(/Saved/);
  await page.screenshot({ path: OUT + '/08-settings.png', fullPage: true });
  ok('settings: language, Claude key, provider');

  // Command palette
  await page.keyboard.press('Control+k');
  await page.fill('#pal', 'launch');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#note-title');
  ok('Ctrl+K palette opens a note');

  // Delete a note
  await page.click('[data-act="noteMenu"]');
  await page.click('#nm-del');
  await page.click('#cm-ok');
  await toast(/Deleted/);
  ok('delete note');

  // Phone + dark mode
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true, permissions: ['microphone'] });
  await phone.addInitScript(FAKE_SPEECH);
  const pp = await phone.newPage();
  pp.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  await pp.goto(URL);
  await pp.waitForSelector('.tabbar');
  await pp.screenshot({ path: OUT + '/09-phone-home-dark.png', fullPage: true });
  await pp.click('[data-act="moreMenu"]');
  await pp.screenshot({ path: OUT + '/10-phone-more.png' });
  await pp.click('#modal-root a:has-text("To-dos"), #modal-root a:has-text("Ideas")');
  const sw = await pp.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 391, 'no sideways scroll on phone, got ' + sw);
  ok('phone layout in dark mode, no sideways scroll');

  // Mic blocked → upload fallback
  const nomic = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await nomic.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
  const np = await nomic.newPage();
  np.on('pageerror', (e) => errors.push('nomic pageerror: ' + e.message));
  await np.goto(URL + '#/record');
  await np.waitForSelector('[data-act="recStart"]');
  await np.click('[data-act="recStart"]');
  await np.waitForSelector('text=The microphone isn\'t available here');
  const wav = Buffer.alloc(44 + 8000);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + 8000, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(8000, 40);
  await np.setInputFiles('#upload-audio', { name: 'Call with Ravi.wav', mimeType: 'audio/wav', buffer: wav });
  await np.waitForSelector('#note-title', { timeout: 10000 });
  assert.equal(await np.inputValue('#note-title'), 'Call with Ravi');
  await np.screenshot({ path: OUT + '/11-uploaded.png' });
  ok('mic blocked → upload a recording instead');

  await browser.close();
  if (errors.length) { console.log('\nBrowser errors:\n' + errors.join('\n')); process.exit(1); }
  console.log('\nAll ' + n + ' UI checks passed, no browser errors.');
})().catch((e) => { console.error(e); process.exit(1); });
