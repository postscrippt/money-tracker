'use strict';

/* Photos and bank slips.
   - Pics: pictures are shrunk and kept in this device's IndexedDB. An entry only stores their ids, so
     the pictures are NOT synced to other devices (and are not part of the JSON backup).
   - PicForm / Viewer: attach photos in the add/edit box and look at them from the lists.
   - Bulk: pick many slip photos, read the amount and date from each on this device (Tesseract OCR,
     downloaded the first time it's used), review them in a list, then add them all at once. */

/* ================= picture store ================= */
const Pics = (() => {
  const STORE = 'pics', MAX_SIDE = 1600;
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
    const r = indexedDB.open('money-tracker-pics', 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req.result);
    t.onerror = t.onabort = () => rej(t.error);
  }));

  const put = (id, blob) => run('readwrite', s => s.put(blob, id));
  const get = id => run('readonly', s => s.get(id)).then(b => b || null, () => null);

  // Delete every stored picture no entry refers to (run once at startup, so Undo keeps working while the app is open).
  async function sweep() {
    const keep = new Set([...state.expenses, ...state.income].flatMap(e => e.pics || []));
    const ids = await run('readonly', s => s.getAllKeys());
    const drop = ids.filter(id => !keep.has(id));
    if (drop.length) await run('readwrite', s => { drop.forEach(id => s.delete(id)); return s.count(); });
  }

  // Shrink a photo to a JPEG of at most 1600px so slips stay small on disk.
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('Not a picture'));
        i.src = url;
      });
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not encode'))), 'image/jpeg', 0.8));
    } finally { URL.revokeObjectURL(url); }
  }

  const urls = new Map();
  const url = async id => {
    if (urls.has(id)) return urls.get(id);
    const b = await get(id);
    const u = b ? URL.createObjectURL(b) : null;
    if (u) urls.set(id, u);
    return u;
  };

  return { put, get, sweep, shrink, url };
})();

/* ================= photos in the add / edit box ================= */
const PicForm = (() => {
  let ids = [], drawn = 0;
  const strip = $('#picsStrip');

  async function draw() {
    const mine = ++drawn;
    const urls = await Promise.all(ids.map(id => Pics.url(id).catch(() => null)));
    if (mine !== drawn) return;
    strip.innerHTML = ids.map((id, i) => urls[i]
      ? `<span class="pic"><button type="button" class="pic-img" data-view="${i}" aria-label="View photo ${i + 1}"><img src="${urls[i]}" alt=""></button><button type="button" class="pic-x" data-rm="${i}" aria-label="Remove photo ${i + 1}">${ICON.xSmall}</button></span>`
      :`<span class="pic missing" title="This photo is saved on another device"><span>On another device</span><button type="button" class="pic-x" data-rm="${i}" aria-label="Remove photo ${i + 1}">${ICON.xSmall}</button></span>`
    ).join('');
  }

  strip.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.rm !== undefined) { ids.splice(Number(b.dataset.rm), 1); draw(); }
    else if (b.dataset.view !== undefined) Viewer.show(ids, Number(b.dataset.view));
  };

  $('#picInput').onchange = async e => {
    const files = [...e.target.files];
    e.target.value = '';
    let failed = 0;
    for (const f of files) {
      if (ids.length >= 8) { toast('Up to 8 photos per entry'); break; }
      try {
        const blob = await Pics.shrink(f), id = uid();
        await Pics.put(id, blob);
        ids.push(id);
      } catch (err) { failed++; }
    }
    if (failed) toast(failed === 1 ? "Couldn't add that photo" : `Couldn't add ${failed} photos`);
    draw();
  };

  return {
    ids: () => ids.slice(),
    set(list) { ids = (list || []).slice(); draw(); },
  };
})();

/* ================= photo viewer ================= */
const Viewer = (() => {
  const dlgEl = $('#viewer');
  $('#viewerClose').onclick = () => dlgEl.close();
  dlgEl.addEventListener('click', e => { if (e.target === dlgEl) dlgEl.close(); });
  return {
    async show(ids, start = 0) {
      const urls = await Promise.all(ids.map(id => Pics.url(id).catch(() => null)));
      const found = urls.filter(Boolean);
      $('#viewerBody').innerHTML = found.length
        ? found.map(u => `<img src="${u}" alt="Attached photo">`).join('')
        : '<p class="muted">These photos are saved on another device, so they can\'t be shown here.</p>';
      dlgEl.showModal();
      const target = $('#viewerBody').children[Math.min(start, found.length - 1)];
      if (target && target.scrollIntoView) target.scrollIntoView({ block: 'start' });
    },
  };
})();

/* ================= reading slips ================= */
const SlipText = (() => {
  const EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const TH = ['มกราคม|มค', 'กุมภาพันธ์|กพ', 'มีนาคม|มีค', 'เมษายน|เมย', 'พฤษภาคม|พค', 'มิถุนายน|มิย',
    'กรกฎาคม|กค', 'สิงหาคม|สค', 'กันยายน|กย', 'ตุลาคม|ตค', 'พฤศจิกายน|พย', 'ธันวาคม|ธค'];
  const MONTH_RES = EN.map((en, i) => new RegExp(`(\\d{1,2})\\s*(${TH[i]}|${en}[a-z]*)\\s*(\\d{2,4})`, 'i'));

  // Thai OCR output tends to put spaces and stray dots between letters; close those up.
  const tidy = t => t.replace(/([฀-๿])\./g, '$1').replace(/([฀-๿])[ \t]+(?=[฀-๿])/g, '$1');

  function year(y, thai) {
    if (y >= 2400) return y - 543;       // Buddhist era
    if (y < 100) return thai ? 2500 + y - 543 : 2000 + y;
    return y;
  }
  function valid(y, m, d) {
    if (y < 2000 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m - 1)) return null;
    const dt = new Date(y, m - 1, d);
    if (dt > addDays(new Date(), 1)) return null;
    return ymd(dt);
  }

  function findDate(text) {
    let best = null;
    MONTH_RES.forEach((re, i) => {
      const m = re.exec(text);
      if (m && (!best || m.index < best.index)) best = { index: m.index, m, month: i + 1 };
    });
    if (best) {
      const thai = /[฀-๿]/.test(best.m[2]);
      const d = valid(year(Number(best.m[3]), thai), best.month, Number(best.m[1]));
      if (d) return d;
    }
    const n = /\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/.exec(text);
    if (n) return valid(year(Number(n[3]), false), Number(n[2]), Number(n[1]));
    return null;
  }

  function findAmount(text) {
    const NUM = /(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\b/g;
    const nums = line => (line.match(NUM) || []).map(s => parseFloat(s.replace(/,/g, ''))).filter(n => n > 0);
    const skip = /fee|charge|balance|ค่าธรรมเนียม|คงเหลือ/i;
    const key = /amount|total|จำนวน|ยอด|thb|baht|บาท/i;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!key.test(lines[i]) || skip.test(lines[i])) continue;
      const here = nums(lines[i]);
      if (here.length) return here[0];
      const next = lines[i + 1] && !skip.test(lines[i + 1]) ? nums(lines[i + 1]) : [];
      if (next.length) return next[0];
    }
    const all = lines.filter(l => !skip.test(l)).flatMap(nums);
    return all.length ? Math.max(...all) : null;
  }

  function findNote(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const m = /^(?:to\b|ไปยัง|ผู้รับ|รับเงิน)[:\s]*(.*)$/i.exec(lines[i]);
      if (!m) continue;
      const cand = (m[1].length >= 2 ? m[1] : lines[i + 1] || '').replace(/\s+/g, ' ').trim();
      if (cand.length >= 2 && !/\d{5,}|x{3,}/i.test(cand)) return cand.slice(0, 80);
    }
    return '';
  }

  return {
    parse(raw) {
      const text = String(raw || ''), tight = tidy(text);
      return { amount: findAmount(tight), date: findDate(tight), note: findNote(text) };
    },
  };
})();

/* Guess a category for a slip. First choice is memory: any vendor (note) already used on a past
   payment maps to the category it was last filed under, so correcting one slip teaches the next.
   Failing that, common words on the slip are matched to category names. */
const Vendors = (() => {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9฀-๿]+/g, '');
  const WORDS = [
    [/food|eat|dining|restaurant|cafe|coffee|meal|อาหาร/i, /restaurant|7-?eleven|cafe|coffee|kfc|mcdonald|starbucks|pizza|sushi|bistro|kitchen|noodle|bakery|ร้านอาหาร|ก๋วยเตี๋ยว|กาแฟ|ข้าว/i],
    [/transport|travel|taxi|commut|car/i, /grab|bolt|taxi|bts|mrt|airport|shell|ptt|petrol|fuel|gas station|parking|toll|แท็กซี่|น้ำมัน|ทางด่วน/i],
    [/grocer|market|supermarket/i, /lotus|big ?c|tesco|makro|villa market|gourmet|supermarket|top.?s|foodland|ท็อปส์|โลตัส/i],
    [/shop|cloth|retail/i, /lazada|shopee|central|uniqlo|h&m|zara|robinson|mall|ช้อปปี้|ลาซาด้า/i],
    [/fun|entertain|leisure|movie/i, /cinema|major|netflix|spotify|steam|karaoke|concert|ticket|โรงหนัง/i],
    [/health|medic|pharm|doctor/i, /hospital|clinic|pharmacy|boots|watsons|dental|โรงพยาบาล|คลินิก|ร้านยา/i],
    [/bill|util|phone|electric|water|rent|internet/i, /electric|waterworks|\bais\b|\bdtac\b|\btrue\b|truemove|\bmea\b|\bpea\b|\bpwa\b|internet|invoice|bill pay|การไฟฟ้า|ประปา/i],
  ];

  function memory() {
    const map = new Map();
    [...state.expenses].sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(e => {
      const k = norm(e.note);
      if (k.length >= 3 && state.categories.some(c => c.id === e.categoryId)) map.set(k, e.categoryId);
    });
    return map;
  }

  // Returns { cat, why } or null.
  function guess(text, note, mem = memory()) {
    const nk = norm(note), tk = norm(text);
    if (nk.length >= 3 && mem.has(nk)) return { cat: mem.get(nk), why: 'remembered vendor' };
    if (nk.length >= 3) for (const [k, cat] of mem) if (k.includes(nk) || nk.includes(k)) return { cat, why: 'remembered vendor' };
    for (const [k, cat] of mem) if (k.length >= 4 && tk.includes(k)) return { cat, why: 'remembered vendor' };
    const hay = `${note} ${text}`;
    for (const [catRe, wordRe] of WORDS) {
      if (!wordRe.test(hay)) continue;
      const c = state.categories.find(x => catRe.test(x.name));
      if (c) return { cat: c.id, why: 'matched wording' };
    }
    return null;
  }
  return { guess, memory };
})();

const Ocr = (() => {
  const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let loading;
  const load = () => window.Tesseract ? Promise.resolve(window.Tesseract) : (loading || (loading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => res(window.Tesseract);
    s.onerror = () => { loading = null; rej(new Error('Could not load the reader')); };
    document.head.appendChild(s);
  })));

  // English plus Thai, so Thai slips and month names work; falls back to English only.
  async function worker(onProgress) {
    const T = await load();
    const opts = { logger: m => { if (m && m.status && onProgress) onProgress(m); } };
    try { return await T.createWorker('eng+tha', 1, opts); }
    catch (e) { return await T.createWorker('eng', 1, opts); }
  }
  return { worker };
})();

/* ================= bulk add from slips ================= */
const Bulk = (() => {
  const dlgEl = $('#bulk'), list = $('#bulkList');
  const MAX = 40;
  let rows = [], running = false, seq = 0;

  const catOptions = sel => state.categories.map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  const defaultCat = () => (state.categories.some(c => c.id === chosenCat) ? chosenCat : state.categories[0].id);
  const find = li => rows.find(r => r.key === li.dataset.key);
  const liOf = r => list.querySelector(`[data-key="${r.key}"]`);

  function stateText(r) {
    if (r.status === 'queued') return 'Waiting…';
    if (r.status === 'reading') return 'Reading…';
    const amt = calc(r.amount);
    if (r.status === 'failed' && !r.touched) return "Couldn't read this one. Fill it in.";
    if (isDup(r)) return r.addAnyway ? 'Possible duplicate. Will be added anyway.' : 'Possible duplicate. Skipped unless you tick Add anyway.';
    if (r.dateGuessed && !r.touched) return 'Date not found on the slip. Check it.';
    if (!(amt > 0)) return 'Enter the amount.';
    return r.why ? `Check the details. Category: ${r.why}.` : 'Check the details.';
  }

  // Same amount on the same day as a saved payment, or as an earlier slip in this batch.
  function isDup(r) {
    const amt = calc(r.amount);
    if (!(amt > 0) || !isDate(r.date)) return false;
    if (state.expenses.some(e => e.date === r.date && e.amount === amt)) return true;
    return rows.some(x => x !== r && rows.indexOf(x) < rows.indexOf(r) && x.date === r.date && calc(x.amount) === amt);
  }

  function rowHtml(r) {
    return `<li class="slip" data-key="${r.key}">
      <button type="button" class="slip-img" data-view aria-label="View slip"><img src="${r.url}" alt=""></button>
      <div class="slip-f">
        <div class="slip-state muted"></div>
        <div class="row">
          <input data-f="amount" inputmode="decimal" placeholder="฿ Amount" aria-label="Amount" value="${esc(r.amount)}">
          <input data-f="date" type="date" aria-label="Date" value="${esc(r.date)}">
        </div>
        <select data-f="cat" aria-label="Category">${catOptions(r.cat)}</select>
        <input data-f="note" placeholder="Vendor / note (remembered for next time)" maxlength="80" aria-label="Note" value="${esc(r.note)}">
        <label class="check slip-dup" hidden><input type="checkbox" data-f="addAnyway"> Add anyway</label>
      </div>
      <button type="button" class="icon-btn" data-rm aria-label="Remove slip">${ICON.x}</button>
    </li>`;
  }

  function paint(r) {
    const li = liOf(r);
    if (!li) return;
    li.querySelector('.slip-state').textContent = stateText(r);
    li.classList.toggle('busy', r.status === 'queued' || r.status === 'reading');
    const dup = r.status !== 'queued' && r.status !== 'reading' && isDup(r);
    li.querySelector('.slip-dup').hidden = !dup;
    li.classList.toggle('dup', dup && !r.addAnyway);
  }

  function draw() {
    list.innerHTML = rows.map(rowHtml).join('');
    rows.forEach(paint);
    summary();
  }

  function summary() {
    const ok = rows.filter(r => r.status !== 'queued' && r.status !== 'reading' && !skipped(r));
    const total = ok.reduce((a, r) => a + (calc(r.amount) > 0 ? calc(r.amount) : 0), 0);
    const n = rows.filter(r => !skipped(r)).length;
    const btn = $('#bulkGo');
    btn.disabled = !n || running;
    btn.textContent = n ? `Add ${n} payment${n === 1 ? '' : 's'}${total ? ' · ' + money(total) : ''}` : 'Add payments';
  }
  const skipped = r => !r.addAnyway && isDup(r);

  function say(msg) {
    $('#bulkStatus').hidden = !msg;
    $('#bulkStatus').textContent = msg || '';
  }

  // Put what was read into a row's fields, unless the person has already typed in them.
  function fill(r, found) {
    if (found.amount && !r.touched) r.amount = String(found.amount);
    if (found.date && !r.touched) { r.date = found.date; r.dateGuessed = false; }
    if (found.note && !r.touched && !r.note) r.note = found.note;
    if (!r.catTouched) {
      const g = Vendors.guess(found.text, r.note, mem);
      if (g) { r.cat = g.cat; r.why = g.why; }
    }
    const li = liOf(r);
    if (!li) return;
    li.querySelector('[data-f=cat]').value = r.cat;
    li.querySelector('[data-f=amount]').value = r.amount;
    li.querySelector('[data-f=date]').value = r.date;
    li.querySelector('[data-f=note]').value = r.note;
  }

  let mem;
  async function readAll() {
    if (running) return;
    running = true;
    mem = Vendors.memory();
    summary();
    let worker;
    try {
      say('Loading the slip reader… The first time this downloads some data, so it can take a minute.');
      worker = await Ocr.worker(m => { if (m.status === 'recognizing text') say(`Reading slips… ${Math.round((m.progress || 0) * 100)}%`); });
      for (;;) {
        const r = rows.find(x => x.status === 'queued');
        if (!r) break;
        r.status = 'reading';
        paint(r);
        say(`Reading slips… (${rows.filter(x => x.status === 'done' || x.status === 'failed').length + 1} of ${rows.length})`);
        try {
          const { data } = await worker.recognize(r.blob);
          const found = { ...SlipText.parse(data.text), text: data.text };
          r.status = found.amount ? 'done' : 'failed';
          if (!rows.includes(r)) continue;
          fill(r, found);
        } catch (err) { r.status = 'failed'; }
        paint(r);
        summary();
      }
      say('');
    } catch (err) {
      rows.filter(x => x.status === 'queued' || x.status === 'reading').forEach(x => { x.status = 'failed'; paint(x); });
      say("Couldn't start the slip reader (it needs an internet connection the first time). You can still fill in each slip by hand.");
    } finally {
      if (worker) worker.terminate().catch(() => {});
      running = false;
      summary();
    }
  }

  async function addFiles(files) {
    const room = MAX - rows.length;
    if (files.length > room) toast(`Up to ${MAX} slips at a time`);
    let failed = 0;
    for (const f of files.slice(0, Math.max(room, 0))) {
      try {
        const blob = await Pics.shrink(f);
        const d = f.lastModified ? ymd(new Date(f.lastModified)) : selected;
        rows.push({
          key: 's' + (++seq), blob, url: URL.createObjectURL(blob), status: 'queued',
          amount: '', date: d, dateGuessed: true, cat: defaultCat(), note: '', touched: false,
        });
      } catch (err) { failed++; }
    }
    if (failed) toast(`${failed} file${failed === 1 ? ' was' : 's were'} not a picture`);
    draw();
    readAll();
  }

  function reset() {
    rows.forEach(r => URL.revokeObjectURL(r.url));
    rows = [];
    list.innerHTML = '';
    say('');
    summary();
  }

  function close() { if (dlgEl.open) dlgEl.close(); }

  async function commit() {
    const bad = rows.findIndex(r => !(calc(r.amount) > 0) || !isDate(r.date));
    if (bad >= 0) {
      const li = liOf(rows[bad]);
      toast(`Check the amount and date on slip ${bad + 1}`);
      if (li) { li.scrollIntoView({ block: 'center' }); li.querySelector('[data-f=amount]').focus(); }
      return;
    }
    const keep = rows.filter(r => !skipped(r)), dropped = rows.length - keep.length;
    if (!keep.length) return;
    $('#bulkGo').disabled = true;
    const snap = snapshot();
    let lost = 0, total = 0, latest = '';
    for (const r of keep) {
      const id = uid(), pid = uid(), amount = calc(r.amount);
      let pics = {};
      try { await Pics.put(pid, r.blob); pics = { pics: [pid] }; } catch (err) { lost++; }
      state.expenses.push({ id, date: r.date, amount, categoryId: r.cat, note: r.note.trim(), u: Date.now(), ...pics });
      total += amount;
      if (r.date > latest) latest = r.date;
    }
    const n = keep.length, skip = dropped ? ` (${dropped} duplicate${dropped === 1 ? '' : 's'} skipped)` : '';
    save();
    close();
    selectDay(latest);
    if (lost) toast(`Added ${n} payments, but the slip pictures couldn't be saved on this device`);
    else toast(`Added ${n} payment${n === 1 ? '' : 's'} · ${money(total)}${skip}`, undoTo(snap));
  }

  $('#scanSlips').onclick = () => { reset(); $('#bulkCatAll').innerHTML = catOptions(defaultCat()); dlgEl.showModal(); };
  $('#bulkInput').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  $('#bulkClose').onclick = $('#bulkCancel').onclick = close;
  dlgEl.addEventListener('close', reset);
  $('#bulkGo').onclick = commit;
  $('#bulkCatAll').onchange = e => {
    rows.forEach(r => { r.cat = e.target.value; r.catTouched = true; r.why = ''; });
    list.querySelectorAll('[data-f=cat]').forEach(s => { s.value = e.target.value; });
  };

  list.addEventListener('input', e => {
    const li = e.target.closest('.slip'), f = e.target.dataset.f;
    const r = li && find(li);
    if (!r || !f) return;
    r[f] = f === 'addAnyway' ? e.target.checked : e.target.value;
    if (f === 'amount' || f === 'date') { r.touched = true; r.dateGuessed = false; }
    if (f === 'cat') { r.catTouched = true; r.why = ''; }
    if (f === 'note' && !r.catTouched) {
      const g = Vendors.guess('', r.note);
      if (g) { r.cat = g.cat; r.why = g.why; li.querySelector('[data-f=cat]').value = g.cat; }
    }
    rows.forEach(paint);
    summary();
  });
  list.addEventListener('click', e => {
    const li = e.target.closest('.slip'), r = li && find(li);
    if (!r) return;
    if (e.target.closest('[data-rm]')) {
      URL.revokeObjectURL(r.url);
      rows = rows.filter(x => x !== r);
      li.remove();
      rows.forEach(paint);
      summary();
    } else if (e.target.closest('[data-view]')) {
      $('#viewerBody').innerHTML = `<img src="${r.url}" alt="Slip">`;
      $('#viewer').showModal();
    }
  });

  return {};
})();

/* ================= start ================= */
Pics.sweep().catch(() => {});
