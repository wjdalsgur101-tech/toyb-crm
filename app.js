/* TOYB 영업 CRM — app.js (vanilla, no deps) */
'use strict';
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

const LS = {
  ov: 'toybCRM.ov.v1',
  add: 'toybCRM.new.v1',
  key: 'toybCRM.key.v1',
  hook: 'toybCRM.hook.v1',
  remember: 'toybCRM.remember.v1',
  hookLog: 'toybCRM.hooklog.v1'
};

const CAT_COLOR = {
  'VC_투자처': '#38BDF8', '공공_협회': '#A855F7', '식자재_유통사': '#22C55E',
  '지역_상인회': '#06B6D4', 'POS_VAN': '#F59E0B', '세무_배달_공유주방': '#F472B6',
  '프랜차이즈_본사': '#3B82F6', '전국_일반매장': '#EF4444', '운영_제휴': '#94A3B8',
  'TM_본사전화': '#0EA5E9'
};
const CAT_LABEL = {
  'VC_투자처': 'VC·투자처', '공공_협회': '공공·협회', '식자재_유통사': '식자재 유통',
  '지역_상인회': '지역 상인회', 'POS_VAN': 'POS·VAN', '세무_배달_공유주방': '세무·배달·공유주방',
  '프랜차이즈_본사': '프랜차이즈 본사', '전국_일반매장': '전국 일반매장', '운영_제휴': '운영·제휴',
  'TM_본사전화': 'TM 본사전화'
};
const RESULT_TAG = {
  '회신대기': 't-waitres', '회신수신': 't-reply', '미팅·검토': 't-meet', '재검토': 't-meet',
  '계약': 't-deal', '계약완료': 't-deal', '보류': 't-hold', '거절': 't-hold', '수신거부': 't-refuse'
};

const state = {
  data: null, base: [], added: [], ov: {}, leads: [],
  view: 'leads', cat: '전체', q: '', fState: '', fResult: '', sort: 'recent', quick: '',
  page: 40, cur: null, sessionKey: null, dirty: {}
};

/* ───────── storage ───────── */
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('저장 공간이 부족합니다'); } };
const b64 = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/* ───────── crypto ───────── */
async function deriveKey(pass, saltB64, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}
async function importRawKey(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}
async function decryptPayload(enc, key) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(enc.cipher.iv), additionalData: new TextEncoder().encode('toyb-crm-v1') },
    key, unb64(enc.ct));
  if (enc.gz) {
    const stream = new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  }
  return JSON.parse(new TextDecoder().decode(pt));
}
async function fetchEnc() {
  if (window.__DATA_ENC) return window.__DATA_ENC;      // 단일 파일 배포본
  const r = await fetch('data.enc.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('데이터를 불러오지 못했습니다 (' + r.status + ')');
  return r.json();
}

/* ───────── init ───────── */
async function boot() {
  state.ov = readJSON(LS.ov, {});
  state.added = readJSON(LS.add, []);
  try {
    const enc = await fetchEnc();
    window.__enc = enc;
    const saved = readJSON(LS.key, null);
    if (saved && saved.k && localStorage.getItem(LS.remember) !== '0') {
      try {
        state.sessionKey = await importRawKey(unb64(saved.k));
        state.data = await decryptPayload(enc, state.sessionKey);
        return unlockDone();
      } catch (e) { localStorage.removeItem(LS.key); }
    }
    $('#lock').classList.remove('hide');
    $('#pass').focus();
  } catch (e) {
    $('#lockMsg').textContent = e.message;
  }
}

async function tryUnlock(pass) {
  const enc = window.__enc || await fetchEnc();
  const key = await deriveKey(pass, enc.kdf.salt, enc.kdf.iter);
  const data = await decryptPayload(enc, key);   // throws on wrong password
  state.sessionKey = key;
  state.data = data;
  if ($('#remember').checked) {
    try {
      const raw = await crypto.subtle.exportKey('raw', key);
      writeJSON(LS.key, { k: b64(raw), at: new Date().toISOString() });
      localStorage.setItem(LS.remember, '1');
    } catch (e) {}
  } else {
    localStorage.removeItem(LS.key);
    localStorage.setItem(LS.remember, '0');
  }
  unlockDone();
}

function unlockDone() {
  $('#lock').classList.add('hide');
  $('#shell').classList.remove('hide');
  rebuild();
  initAddForm();
  renderAll();
  window.scrollTo(0, 0);
  if ($('#remember').checked === false) $('#remember').checked = localStorage.getItem(LS.remember) !== '0';
  const tgl = $('#rememberTgl');
  if (tgl) tgl.classList.toggle('on', localStorage.getItem(LS.remember) !== '0');
}

/* ───────── data merge ───────── */
function baseHist(l) {
  if (l.histArr) return l.histArr;
  if (!l.hist) return [];
  return [{
    d: (l.recent || (l.sent || '').slice(0, 10) || '').slice(0, 10),
    ch: shortCh(l.ch), dir: '발신', text: l.hist, next: l.next || ''
  }];
}
function shortCh(ch) {
  const c = String(ch || '');
  if (c.includes('Resend')) return '이메일(Resend)';
  if (c.includes('Gmail')) return '이메일(Gmail)';
  if (c.includes('폼')) return '접수 폼';
  if (c.includes('도전')) return '도전의IR';
  if (c.includes('thevc')) return '플랫폼';
  if (c.includes('스레드')) return '스레드';
  if (c.includes('방문')) return '방문·전화';
  return c || '—';
}
function hydrate(l) {
  const e = Object.assign({}, l);
  e.histArr = baseHist(l);
  e.refuse = !!l.refuse;
  return e;
}
function rebuild() {
  const ov = state.ov || {};
  const base = (state.data.leads || []).map(l => {
    const p = ov[l.id];
    return hydrate(p ? Object.assign({}, l, p) : l);
  });
  const added = (state.added || []).map(l => {
    const p = ov[l.id];
    return hydrate(p ? Object.assign({}, l, p) : l);
  });
  state.base = base;
  state.leads = base.concat(added);
}
const isSent = l => l.state === '발송완료';
const isReplied = l => ['회신수신', '미팅·검토', '재검토', '계약', '계약완료'].includes(l.result);
const isMeet = l => ['미팅·검토', '재검토'].includes(l.result);

/* ───────── render ───────── */
function renderAll() {
  renderTop(); renderKPI(); renderChips(); renderList();
  renderSummary(); renderSync(); renderSettings();
}

function renderTop() {
  const n = state.leads.length;
  const d = state.data.meta ? state.data.meta.builtAt : '';
  $('#topSub').textContent = n.toLocaleString() + '곳 · 기준 ' + d;
}

function renderKPI() {
  const L = state.leads;
  const sent = L.filter(isSent).length;
  const replied = L.filter(isReplied).length;
  const wait = L.filter(l => l.result === '회신대기').length;
  const meet = L.filter(isMeet).length;
  const deal = L.filter(l => l.result === '계약').length;
  const refuse = L.filter(l => l.refuse).length;
  const conv = sent ? (deal / sent * 100).toFixed(1) : '0.0';
  const items = [
    ['b1', '전체 DB', L.length.toLocaleString(), '8개 카테고리'],
    ['b2', '발송완료', sent.toLocaleString(), '미발송 ' + (L.length - sent).toLocaleString()],
    ['b3', '회신수신', replied.toLocaleString(), '회신대기 ' + wait.toLocaleString()],
    ['b4', '미팅·검토', meet.toLocaleString(), '재검토 포함'],
    ['b5', '계약', deal.toLocaleString(), '전환율 ' + conv + '%'],
    ['b6', '수신거부', refuse.toLocaleString(), '영구 제외']
  ];
  const action = { '전체 DB': 'all', '발송완료': 'sent', '회신수신': 'replied', '미팅·검토': 'meet', '계약': 'deal', '수신거부': 'refuse' };
  $('#kpis').innerHTML = items.map(([c, k, v, s]) =>
    `<div class="kpi ${c}" data-kpi="${action[k]}" role="button" tabindex="0"><div class="k">${k}</div><div class="v mono">${v}</div><div class="s">${s}</div></div>`).join('');
}

function renderChips() {
  const counts = {};
  state.base.concat(state.added).forEach(l => { counts[l.cat] = (counts[l.cat] || 0) + 1; });
  const cats = state.data.cats || Object.keys(CAT_LABEL);
  const all = state.base.length + state.added.length;
  let html = `<button class="chip ${state.cat === '전체' ? 'on' : ''}" data-cat="전체">전체 <span class="n">${all}</span></button>`;
  html += cats.map(c => `<button class="chip ${state.cat === c ? 'on' : ''}" data-cat="${c}">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${CAT_COLOR[c] || '#3B82F6'}"></span>
      ${CAT_LABEL[c] || c} <span class="n">${(counts[c] || 0).toLocaleString()}</span></button>`).join('');
  $('#chips').innerHTML = html;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  let out = state.leads.filter(l => {
    if (state.cat !== '전체' && l.cat !== state.cat) return false;
    if (state.fState && l.state !== state.fState) return false;
    if (state.fResult) {
      if (state.fResult === '수신거부') { if (!l.refuse) return false; }
      else if (l.result !== state.fResult) return false;
    }
    if (state.quick === 'replied' && !isReplied(l)) return false;
    if (state.quick === 'meet' && !isMeet(l)) return false;
    if (q) {
      const hay = [l.name, l.email, l.phone, l.sub, l.memo, l.owner, l.next, l.hist].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
  const key = l => (l.recent && l.recent !== '—' ? l.recent : (l.sent || '')) || '';
  out.sort((a, b) => {
    if (state.sort === 'name') return String(a.name).localeCompare(String(b.name), 'ko');
    if (state.sort === 'cat') return (a.cat + a.name).localeCompare(b.cat + b.name, 'ko');
    if (state.sort === 'sent') return String(b.sent).localeCompare(String(a.sent));
    return key(b).localeCompare(key(a));
  });
  return out;
}

function tagFor(l) {
  let t = '';
  if (l.refuse) t += '<span class="tag t-refuse">수신거부</span>';
  else if (l.result) t += `<span class="tag ${RESULT_TAG[l.result] || 't-hold'}">${l.result}</span>`;
  if (l.state === '발송완료') t += '<span class="tag t-sent">발송</span>';
  else t += '<span class="tag t-wait">미발송</span>';
  return t;
}

function renderList() {
  const rows = filtered();
  $('#listCount').textContent = rows.length.toLocaleString() + '곳' + (state.q ? ' · "' + state.q + '"' : '')
    + (state.quick === 'replied' ? ' · 회신 온 건' : state.quick === 'meet' ? ' · 미팅·검토' : '');
  $('#listHint').textContent = state.cat === '전체' ? '' : (CAT_LABEL[state.cat] || state.cat);
  if (!rows.length) {
    $('#rows').innerHTML = '<div class="empty">조건에 맞는 리드가 없습니다.<br>필터를 초기화하거나 검색어를 바꿔 보세요.</div>';
    $('#btnMore').classList.add('hide');
    return;
  }
  const slice = rows.slice(0, state.page);
  const frag = document.createDocumentFragment();
  slice.forEach(l => {
    const d = document.createElement('div');
    d.className = 'row';
    d.dataset.id = l.id;
    const c = CAT_COLOR[l.cat] || '#3B82F6';
    const contact = l.email || l.phone || '';
    d.innerHTML = `<span class="dot" style="--c:${c};background:${c};box-shadow:0 0 0 3px ${c}22"></span>
      <div class="mid">
        <div class="nm"><b>${esc(l.name)}</b></div>
        <div class="meta">${esc(l.sub || CAT_LABEL[l.cat] || '')}${contact ? ' · <em>' + esc(contact) + '</em>' : ''}${l.recent && l.recent !== '—' ? ' · ' + esc(l.recent) : ''}</div>
      </div>
      <div class="tags">${tagFor(l)}</div>`;
    frag.appendChild(d);
  });
  $('#rows').innerHTML = '';
  $('#rows').appendChild(frag);
  $('#btnMore').classList.toggle('hide', rows.length <= state.page);
  if (rows.length > state.page) $('#btnMore').textContent = '더 보기 (' + (rows.length - state.page).toLocaleString() + '곳 남음)';
}

function renderSummary() {
  const L = state.leads;
  const sent = L.filter(isSent).length;
  const replied = L.filter(isReplied).length;
  const active = L.filter(l => ['회신대기', '회신수신', '미팅·검토', '재검토'].includes(l.result)).length;
  $('#sumMini').innerHTML = [
    ['응답률', sent ? (replied / sent * 100).toFixed(1) + '%' : '—', '회신 / 발송'],
    ['진행 중', active.toLocaleString(), '회신대기+검토'],
    ['즉시 발송 가능', L.filter(l => l.state === '미발송' && !l.refuse && l.email).length.toLocaleString(), '이메일 보유']
  ].map(([k, v, s]) => `<div class="b"><div class="k">${k}</div><div class="v mono">${v}</div><div class="k">${s}</div></div>`).join('');

  const cats = state.data.cats || [];
  const maxC = Math.max(1, ...cats.map(c => L.filter(l => l.cat === c).length));
  $('#sumCats').innerHTML = cats.map(c => {
    const n = L.filter(l => l.cat === c).length;
    return `<div class="bar"><div class="lbl">${CAT_LABEL[c] || c}</div>
      <div class="track"><div class="fill" style="width:${Math.max(2, n / maxC * 100)}%;background:linear-gradient(90deg,${CAT_COLOR[c]}88,${CAT_COLOR[c]})"></div></div>
      <div class="val">${n.toLocaleString()}</div></div>`;
  }).join('');

  const funnel = [
    ['발송완료', L.filter(isSent).length],
    ['회신대기', L.filter(l => l.result === '회신대기').length],
    ['회신수신', L.filter(l => l.result === '회신수신').length],
    ['미팅·검토', L.filter(isMeet).length],
    ['계약', L.filter(l => l.result === '계약').length],
    ['보류·거절', L.filter(l => ['보류', '거절'].includes(l.result)).length],
    ['수신거부', L.filter(l => l.refuse).length]
  ];
  const maxF = Math.max(1, ...funnel.map(f => f[1]));
  $('#sumFunnel').innerHTML = funnel.map(([k, n]) =>
    `<div class="bar"><div class="lbl">${k}</div><div class="track"><div class="fill" style="width:${Math.max(2, n / maxF * 100)}%"></div></div><div class="val">${n}</div></div>`).join('');

  const acts = L.filter(l => l.next && ['회신대기', '미팅·검토', '재검토', '회신수신'].includes(l.result))
    .sort((a, b) => String(b.recent).localeCompare(String(a.recent))).slice(0, 8);
  $('#sumActs').innerHTML = acts.length ? acts.map(l =>
    `<div class="a" data-id="${l.id}"><b>${esc((l.recent || '').slice(5) || '—')}</b><span><b style="color:#E9EFF8">${esc(l.name)}</b> · ${esc(l.next)}</span></div>`).join('')
    : '<div class="note">등록된 다음 액션이 없습니다.</div>';

  const tl = timelineItems().slice(0, 12);
  $('#sumTl').innerHTML = tl.map(t => `<div class="it">
      <div class="d">${esc(t.d)} · ${esc(t.ch || '')}</div>
      <div class="t">${esc(t.text)}</div>
      ${t.who ? `<div class="who">${esc(t.who)}</div>` : ''}
      ${t.next ? `<div class="x">→ ${esc(t.next)}</div>` : ''}
    </div>`).join('') || '<div class="note">기록이 없습니다.</div>';
}

function timelineItems() {
  const out = (state.data.timeline || []).map(t => ({
    d: t.date, ch: t.ch, text: t.text, next: t.next, who: t.name, cat: t.cat
  }));
  state.leads.forEach(l => {
    (l.histArr || []).forEach(h => {
      const isUser = !!h.user;
      if (!isUser) return;               // 원본 hist는 타임라인에 중복되지 않게 사용자 기록만
      out.push({ d: h.d, ch: h.ch + (h.dir ? ' · ' + h.dir : ''), text: h.text, next: h.next, who: l.name });
    });
  });
  return out.sort((a, b) => String(b.d).localeCompare(String(a.d)));
}

function renderSync() {
  const ovN = Object.keys(state.ov).length;
  $('#syncStats').innerHTML = [
    ['원본 DB', (state.data.leads || []).length.toLocaleString() + '건'],
    ['내가 추가', state.added.length + '건'],
    ['내가 수정', ovN + '건'],
    ['기준일', state.data.meta ? state.data.meta.builtAt : '—']
  ].map(([k, v]) => `<div class="b"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const hook = localStorage.getItem(LS.hook) || '';
  $('#hookUrl').value = hook;
  const log = readJSON(LS.hookLog, null);
  $('#hookState').textContent = hook
    ? (log ? `웹훅 연결됨 · 마지막 전송 ${log.at} (${log.ok}건 성공${log.fail ? ', ' + log.fail + '건 실패' : ''})` : '웹훅 URL이 저장되어 있습니다. [연결 테스트]로 확인하세요.')
    : '설정된 웹훅이 없습니다. 아래 코드를 구글 시트의 [확장 프로그램 → Apps Script]에 붙여 넣고 웹 앱으로 배포하면 URL이 나옵니다.';
}

function renderSettings() {
  const ovN = Object.keys(state.ov).length;
  $('#mineStats').innerHTML = [
    ['추가한 리드', state.added.length + '건'],
    ['수정한 리드', ovN + '건'],
    ['기록한 히스토리', state.leads.reduce((n, l) => n + (l.histArr || []).filter(h => h.user).length, 0) + '건'],
    ['자동 열기', localStorage.getItem(LS.remember) === '0' ? '꺼짐' : '켜짐']
  ].map(([k, v]) => `<div class="b"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const m = state.data.meta || {};
  $('#aboutInfo').innerHTML = `TOYB 영업 CRM · 대표자 전용<br>
    데이터 ${(state.data.leads || []).length.toLocaleString()}건 (프랜차이즈 본사 ${(m.counts ? m.counts.franchise : 0).toLocaleString()}건 · TM 본사전화 ${(m.counts && m.counts.tmPhone ? m.counts.tmPhone : 0).toLocaleString()}건 포함) · 기준 ${m.builtAt || '—'}<br>
    빌드 ${new Date().toISOString().slice(0, 10)} · v1.0`;
}

/* ───────── detail sheet ───────── */
function openDetail(id) {
  const l = state.leads.find(x => x.id === id);
  if (!l) return;
  state.cur = l;
  $('#dName').textContent = l.name;
  $('#dSub').textContent = (CAT_LABEL[l.cat] || l.cat) + (l.sub ? ' · ' + l.sub : '');
  const contact = [];
  const copyable = v => /@/.test(v) || /^[0-9()\-+\s]{7,}$/.test(v);
  if (l.email) contact.push(`<div class="k">이메일</div><div class="v">${esc(l.email)}${copyable(l.email) ? ` <button class="copy" data-copy="${esc(l.email)}">복사</button>` : ''}</div>`);
  if (l.phone) contact.push(`<div class="k">연락처</div><div class="v">${esc(l.phone)}${copyable(l.phone) ? ` <button class="copy" data-copy="${esc(l.phone)}">복사</button>` : ''}</div>`);
  if (l.owner) contact.push(`<div class="k">담당자</div><div class="v">${esc(l.owner)}</div>`);
  if (l.ch && l.ch !== '—') contact.push(`<div class="k">발신 경로</div><div class="v">${esc(shortCh(l.ch))}</div>`);
  if (l.rid) contact.push(`<div class="k">Resend ID</div><div class="v mono" style="font-size:11.5px">${esc(l.rid)}</div>`);
  if (l.src && /^https?:/.test(l.src)) contact.push(`<div class="k">출처</div><div class="v"><a href="${esc(l.src)}" target="_blank" rel="noopener">${esc(l.src.replace(/^https?:\/\//, '').slice(0, 42))} ↗</a></div>`);

  const hist = (l.histArr || []).map(histHtml).join('') || '<div class="note" style="margin-bottom:10px">아직 히스토리가 없습니다. 첫 소통을 기록해 보세요.</div>';

  $('#dBody').innerHTML = `
    <div class="kv">${contact.join('')}</div>
    <div class="switch" id="refuseWrap" role="switch" aria-checked="${l.refuse}" tabindex="0">
      <div class="lb"><b>수신거부 (영구 제외)</b><span>켜면 발송 목록·KPI에서 제외로 집계됩니다</span></div>
      <div class="tgl ${l.refuse ? 'on' : ''}" id="refuseTgl"></div>
    </div>
    <div class="sect">영업 상태</div>
    <div class="grid2">
      <div class="field"><label>발송일</label><input type="date" id="fSent" value="${esc((l.sent || '').slice(0, 10))}"></div>
      <div class="field"><label>발송 상태</label><select id="fStateSel">
        <option ${l.state === '미발송' ? 'selected' : ''}>미발송</option>
        <option ${l.state === '발송완료' ? 'selected' : ''}>발송완료</option></select></div>
      <div class="field"><label>영업 결과</label><select id="fResultSel">
        ${['', '회신대기', '회신수신', '미팅·검토', '재검토', '계약', '보류', '거절'].map(v =>
          `<option value="${v}" ${l.result === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}
      </select></div>
      <div class="field"><label>최근 소통일</label><input type="date" id="fRecent" value="${esc((l.recent || '').slice(0, 10))}"></div>
    </div>
    <div class="field"><label>담당자</label><input id="fOwner" value="${esc(l.owner || '')}" placeholder="예: 김○○ 과장"></div>
    <div class="field"><label>다음 액션</label><input id="fNext" value="${esc(l.next || '')}" placeholder="예: 11-22 팔로업 메일"></div>
    <div class="field"><label>메모</label><textarea id="fMemo" placeholder="발굴 경로·관찰 포인트·주의사항">${esc(l.memo || '')}</textarea></div>
    <div class="sect">소통 히스토리 <span id="histCount" style="font-size:11px;color:#6E8199;margin-left:auto">${(l.histArr || []).length}건</span></div>
    <div class="hist" id="histList">${hist}</div>
    <div class="addhist">
      <div class="grid2">
        <div class="field"><label>날짜</label><input type="date" id="hDate" value="${today()}"></div>
        <div class="field"><label>채널</label><select id="hCh">
          <option>이메일</option><option>전화</option><option>플랫폼</option><option>방문</option><option>스레드·카톡</option><option>기타</option></select></div>
        <div class="field"><label>구분</label><select id="hDir"><option>발신</option><option>수신</option><option>결과</option></select></div>
        <div class="field"><label>내용</label><input id="hText" placeholder="예: 회신 — 12월 재검토 요청"></div>
      </div>
      <div class="field"><label>다음 액션 (선택)</label><input id="hNext" placeholder="예: 12-20 재접촉"></div>
      <button class="btn ghost sm" id="btnAddHist" style="width:100%">+ 히스토리 추가</button>
    </div>`;
  $('#sheetDetail').classList.add('on');
  $('#sheetDetail').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
  document.body.style.overflow = 'hidden';

  $('#refuseWrap').onclick = () => {
    const t = $('#refuseTgl');
    t.classList.toggle('on');
    $('#refuseWrap').setAttribute('aria-checked', t.classList.contains('on'));
  };
  $('#btnAddHist').onclick = addHist;
}

function histHtml(h) {
  return `<div class="h ${h.user ? 'new' : ''}">
      <div class="h1"><b style="color:#93C5FD">${esc(h.d || '—')}</b> · ${esc(h.ch || '')} · ${esc(h.dir || '발신')}${h.user ? ' · 내 기록' : ''}</div>
      <div class="h2">${esc(h.text || '')}</div>
      ${h.next ? `<div class="h3">→ ${esc(h.next)}</div>` : ''}
    </div>`;
}

function addHist() {
  const l = state.cur;
  const text = $('#hText').value.trim();
  if (!text) { toast('히스토리 내용을 입력하세요'); $('#hText').focus(); return; }
  const entry = { d: $('#hDate').value || today(), ch: $('#hCh').value, dir: $('#hDir').value, text, next: $('#hNext').value.trim(), user: true };
  const arr = (l.histArr || []).slice();
  arr.push(entry);
  l.histArr = arr;
  const patch = state.ov[l.id] || {};
  patch.histArr = arr;
  patch.recent = entry.d;
  if (entry.next) patch.next = entry.next;
  state.ov[l.id] = patch;
  writeJSON(LS.ov, state.ov);
  $('#hText').value = ''; $('#hNext').value = '';
  const list = $('#histList');
  if (list) {
    list.insertAdjacentHTML('beforeend', histHtml(entry));
    const cnt = $('#histCount');
    if (cnt) cnt.textContent = arr.length + '건';
    const last = list.lastElementChild;
    if (last) last.scrollIntoView({ block: 'nearest' });
    $('#fRecent').value = entry.d;
    if (entry.next) $('#fNext').value = entry.next;
  }
  toast('히스토리를 추가했습니다');
  sendHook('hist', l);
}

function saveDetail() {
  const l = state.cur;
  if (!l) return;
  const patch = state.ov[l.id] || {};
  patch.sent = $('#fSent').value;
  patch.state = $('#fStateSel').value;
  patch.result = $('#fResultSel').value;
  patch.recent = $('#fRecent').value;
  patch.owner = $('#fOwner').value.trim();
  patch.next = $('#fNext').value.trim();
  patch.memo = $('#fMemo').value;
  patch.refuse = $('#refuseTgl').classList.contains('on');
  patch.histArr = l.histArr;
  if (patch.refuse) patch.result = '수신거부';
  state.ov[l.id] = patch;
  writeJSON(LS.ov, state.ov);
  rebuild(); renderAll();
  closeSheet();
  toast('저장했습니다');
  sendHook('upsert', state.leads.find(x => x.id === l.id));
}

function closeSheet() {
  $('#sheetDetail').classList.remove('on');
  $('#sheetDetail').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('on');
  document.body.style.overflow = '';
  state.cur = null;
}

/* ───────── new lead ───────── */
function initAddForm() {
  const cats = state.data.cats || [];
  $('#addCat').innerHTML = cats.map(c => `<option value="${c}">${CAT_LABEL[c] || c}</option>`).join('');
  $('#addForm').onsubmit = ev => {
    ev.preventDefault();
    const f = ev.target;
    const lead = {
      id: 'u' + Date.now().toString(36),
      cat: f.cat.value, sub: f.sub.value.trim(), name: f.name.value.trim(),
      email: f.email.value.trim(), phone: f.phone.value.trim(), owner: f.owner.value.trim(),
      sent: f.sent.value, ch: '직접 등록', state: f.state.value, result: f.result.value,
      recent: f.sent.value || today(), hist: '', histArr: [], next: '', memo: f.memo.value.trim(),
      rid: '', refuse: f.result.value === '수신거부', src: '', mine: true
    };
    state.added.push(lead);
    writeJSON(LS.add, state.added);
    f.reset();
    rebuild(); renderAll();
    toast('등록했습니다 · ' + lead.name);
    go('leads');
    state.q = lead.name; $('#q').value = lead.name; $('#qClear').classList.remove('hide');
    renderList();
    sendHook('create', lead);
  };
}

/* ───────── export / import ───────── */
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function exportJSON() {
  const out = {
    app: 'toyb-crm', version: 1, exportedAt: new Date().toISOString(),
    meta: state.data.meta, leads: state.leads.map(l => ({
      id: l.id, cat: l.cat, sub: l.sub, name: l.name, email: l.email, phone: l.phone,
      owner: l.owner, sent: l.sent, ch: l.ch, state: l.state, result: l.result,
      recent: l.recent, next: l.next, memo: l.memo, rid: l.rid, refuse: l.refuse,
      histArr: l.histArr, mine: !!l.mine
    }))
  };
  download('TOYB_영업CRM_' + today() + '.json', JSON.stringify(out, null, 1));
  toast('JSON을 내보냈습니다');
}
const CSV_COLS = ['카테고리', '세부구분', '업체명', '이메일', '연락처', '담당자', '발송일', '발송상태', '영업결과', '최근소통일', '다음액션', '메모', '수신거부', '출처'];
function exportCSV() {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [CSV_COLS.join(',')];
  state.leads.forEach(l => lines.push([
    CAT_LABEL[l.cat] || l.cat, l.sub, l.name, l.email, l.phone, l.owner, l.sent, l.state,
    l.refuse ? '수신거부' : l.result, l.recent, l.next, l.memo, l.refuse ? 'Y' : '', l.src
  ].map(q).join(',')));
  download('TOYB_영업CRM_' + today() + '.csv', '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV를 내보냈습니다');
}
async function importJSON(file) {
  const text = await file.text();
  let d; try { d = JSON.parse(text); } catch (e) { toast('JSON 형식이 아닙니다'); return; }
  const arr = Array.isArray(d) ? d : d.leads;
  if (!Array.isArray(arr)) { toast('leads 배열을 찾지 못했습니다'); return; }
  const baseIds = new Set(state.base.map(l => l.id));
  let upd = 0, add = 0;
  arr.forEach(l => {
    if (!l || !l.id) return;
    if (baseIds.has(l.id) || state.added.some(x => x.id === l.id)) {
      state.ov[l.id] = Object.assign({}, state.ov[l.id], {
        sent: l.sent, state: l.state, result: l.result, recent: l.recent, next: l.next,
        memo: l.memo, owner: l.owner, refuse: l.refuse, histArr: l.histArr
      });
      upd++;
    } else {
      state.added.push(Object.assign({}, l, { mine: true }));
      add++;
    }
  });
  writeJSON(LS.ov, state.ov); writeJSON(LS.add, state.added);
  rebuild(); renderAll();
  toast(`가져오기 완료 · 수정 ${upd}건, 추가 ${add}건`);
}

/* ───────── webhook ───────── */
const GAS = `// TOYB 영업 CRM — 수신 웹훅 (구글 시트)
// 1) 새 스프레드시트 > 확장 프로그램 > Apps Script 에 붙여넣기
// 2) 배포 > 새 배포 > 유형: 웹 앱 / 실행: 나 / 액세스: 모든 사용자
// 3) 나온 /exec URL을 앱 [동기화]에 붙여넣기
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('앱_수신') || ss.insertSheet('앱_수신');
  if (sh.getLastRow() === 0) {
    sh.appendRow(['수신시각','이벤트','리드ID','카테고리','업체명','이메일','연락처','발송일','발송상태','영업결과','최근소통일','다음액션','메모','수신거부']);
  }
  var b = JSON.parse(e.postData.contents);
  if (b.event === 'test') return ContentService.createTextOutput(JSON.stringify({ok:true, test:true})).setMimeType(ContentService.MimeType.JSON);
  var l = b.lead || {};
  sh.appendRow([new Date(), b.event || '', l.id || '', l.cat || '', l.name || '', l.email || '', l.phone || '',
    l.sent || '', l.state || '', l.result || '', l.recent || '', l.next || '', l.memo || '', l.refuse ? 'Y' : '']);
  return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
}`;
async function sendHook(event, lead) {
  const url = localStorage.getItem(LS.hook) || '';
  if (!url || !lead) return;
  try {
    await fetch(url, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ event, lead: slim(lead), at: new Date().toISOString() })
    });
  } catch (e) { /* no-cors 응답은 읽을 수 없음 */ }
}
function slim(l) {
  return {
    id: l.id, cat: l.cat, sub: l.sub, name: l.name, email: l.email, phone: l.phone, owner: l.owner,
    sent: l.sent, state: l.state, result: l.refuse ? '수신거부' : l.result, recent: l.recent,
    next: l.next, memo: l.memo, refuse: !!l.refuse
  };
}

/* ───────── nav / misc ───────── */
function go(view) {
  state.view = view;
  ['leads', 'summary', 'add', 'sync', 'settings'].forEach(v => {
    $('#view-' + v).classList.toggle('hide', v !== view);
  });
  $$('#nav button, #deskTabs button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'instant' });
}
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

/* ───────── events ───────── */
$('#lockForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = $('#unlockBtn'), msg = $('#lockMsg');
  const pass = $('#pass').value.trim();
  if (!pass) { msg.textContent = '비밀번호를 입력하세요'; return; }
  btn.disabled = true; btn.textContent = '여는 중'; msg.textContent = '';
  try {
    await tryUnlock(pass);
  } catch (e) {
    msg.textContent = '비밀번호가 맞지 않습니다';
    $('#pass').select();
  } finally { btn.disabled = false; btn.textContent = '열기'; }
});

$('#btnLock').onclick = $('#btnLock2').onclick = () => {
  state.sessionKey = null; state.data = null;
  $('#shell').classList.add('hide');
  $('#lock').classList.remove('hide');
  $('#pass').value = '';
  $('#pass').focus();
};

$('#btnRefresh').onclick = async () => {
  if (!state.sessionKey) return;
  try {
    const enc = await fetchEnc();
    window.__enc = enc;
    state.data = await decryptPayload(enc, state.sessionKey);
    rebuild(); initAddForm(); renderAll();
    toast('원본 데이터를 새로 받았습니다');
  } catch (e) { toast('새로고침 실패: 잠금을 풀고 다시 시도하세요'); }
};

$('#q').addEventListener('input', e => {
  state.q = e.target.value; state.page = 40;
  $('#qClear').classList.toggle('hide', !state.q);
  renderList();
});
$('#qClear').onclick = () => { state.q = ''; $('#q').value = ''; $('#qClear').classList.add('hide'); renderList(); };
$('#fState').onchange = e => { state.fState = e.target.value; state.quick = ''; state.page = 40; renderList(); };
$('#fResult').onchange = e => { state.fResult = e.target.value; state.quick = ''; state.page = 40; renderList(); };
$('#fSort').onchange = e => { state.sort = e.target.value; state.page = 40; renderList(); };
$('#btnFilterReset').onclick = () => {
  state.cat = '전체'; state.q = ''; state.fState = ''; state.fResult = ''; state.sort = 'recent'; state.page = 40; state.quick = '';
  $('#q').value = ''; $('#qClear').classList.add('hide');
  $('#fState').value = ''; $('#fResult').value = ''; $('#fSort').value = 'recent';
  renderChips(); renderList();
};
$('#kpis').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-kpi]')) { e.preventDefault(); e.target.closest('[data-kpi]').click(); }
});
$('#kpis').addEventListener('click', e => {
  const k = e.target.closest('[data-kpi]');
  if (!k) return;
  state.cat = '전체'; state.q = ''; state.fState = ''; state.fResult = ''; state.page = 40;
  $('#q').value = ''; $('#qClear').classList.add('hide'); $('#fState').value = ''; $('#fResult').value = '';
  const v = k.dataset.kpi;
  if (v === 'sent') state.fState = '발송완료';
  if (v === 'replied') { state.fResult = ''; state.quick = 'replied'; }
  if (v === 'meet') { state.quick = 'meet'; }
  if (v === 'deal') state.fResult = '계약';
  if (v === 'refuse') state.fResult = '수신거부';
  if (v === 'all') state.quick = '';
  go('leads'); renderChips(); renderList();
  toast(k.querySelector('.k').textContent + ' 기준으로 걸렀습니다');
});

$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  state.cat = b.dataset.cat; state.quick = ''; state.page = 40;
  renderChips(); renderList();
});
$('#rows').addEventListener('click', e => {
  const r = e.target.closest('.row');
  if (r) openDetail(r.dataset.id);
});
$('#sumActs').addEventListener('click', e => {
  const a = e.target.closest('.a');
  if (a) openDetail(a.dataset.id);
});
$('#btnMore').onclick = () => { state.page += 80; renderList(); };
$('#scrim').onclick = closeSheet;
$$('[data-close]').forEach(b => b.onclick = closeSheet);
$('#dSave').onclick = saveDetail;
$('#dBody').addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  if (c) {
    navigator.clipboard.writeText(c.dataset.copy).then(() => toast('복사했습니다')).catch(() => toast('복사 실패'));
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#sheetDetail').classList.contains('on')) closeSheet();
  if (e.key === '/' && state.view === 'leads' && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault(); $('#q').focus();
  }
});
$$('#nav button, #deskTabs button').forEach(b => b.onclick = () => go(b.dataset.view));

/* sync view */
$('#btnExportJson').onclick = exportJSON;
$('#btnExportCsv').onclick = exportCSV;
$('#btnImport').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  const f = e.target.files[0];
  if (f) await importJSON(f);
  e.target.value = '';
};
$('#gasCode').textContent = GAS;
$('#btnCopyGas').onclick = () => navigator.clipboard.writeText(GAS).then(() => toast('코드를 복사했습니다')).catch(() => toast('복사 실패'));
$('#btnHookSave').onclick = () => {
  const v = $('#hookUrl').value.trim();
  if (v && !/^https:\/\//.test(v)) { toast('https:// 주소를 입력하세요'); return; }
  localStorage.setItem(LS.hook, v);
  renderSync();
  toast(v ? '웹훅 URL을 저장했습니다' : '웹훅을 해제했습니다');
};
$('#btnHookTest').onclick = async () => {
  const v = $('#hookUrl').value.trim();
  if (!v) { toast('웹훅 URL이 없습니다'); return; }
  localStorage.setItem(LS.hook, v);
  try {
    await fetch(v, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ event: 'test', at: new Date().toISOString() }) });
    writeJSON(LS.hookLog, { at: new Date().toLocaleString('ko-KR'), ok: 1, fail: 0 });
    renderSync();
    toast('테스트를 보냈습니다 · 시트의 앱_수신 탭을 확인하세요');
  } catch (e) { toast('전송 실패: URL을 확인하세요'); }
};
$('#btnHookPush').onclick = async () => {
  const v = $('#hookUrl').value.trim();
  if (!v) { toast('웹훅 URL이 없습니다'); return; }
  localStorage.setItem(LS.hook, v);
  const changed = state.leads.filter(l => state.ov[l.id] || l.mine);
  if (!changed.length) { toast('전송할 변경분이 없습니다'); return; }
  toast(changed.length + '건 전송 중…');
  let ok = 0, fail = 0;
  for (const l of changed.slice(0, 200)) {
    try {
      await fetch(v, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ event: 'upsert', lead: slim(l), at: new Date().toISOString() }) });
      ok++;
    } catch (e) { fail++; }
    await new Promise(r => setTimeout(r, 120));
  }
  writeJSON(LS.hookLog, { at: new Date().toLocaleString('ko-KR'), ok, fail });
  renderSync();
  toast('전송 완료 · ' + ok + '건' + (fail ? ' / 실패 ' + fail : ''));
};

/* settings */
$('#btnResetMine').onclick = () => {
  if (!confirm('이 기기에서 추가·수정한 기록을 모두 지웁니다. 계속할까요?')) return;
  state.ov = {}; state.added = [];
  localStorage.removeItem(LS.ov); localStorage.removeItem(LS.add);
  rebuild(); renderAll();
  toast('내 기록을 초기화했습니다');
};
$('#rememberWrap').onclick = () => {
  const cur = localStorage.getItem(LS.remember) === '0';
  localStorage.setItem(LS.remember, cur ? '1' : '0');
  $('#rememberTgl').classList.toggle('on', cur);
  if (!cur) localStorage.removeItem(LS.key);
  renderSettings();
  toast(cur ? '이 기기에서 자동 열기를 켰습니다 (다음 잠금 해제 때 저장)' : '자동 열기를 껐습니다');
};
$('#btnInstall').onclick = async () => {
  if (window.__deferredPrompt) { window.__deferredPrompt.prompt(); window.__deferredPrompt = null; return; }
  alert('아이폰: Safari 공유(⬆︎) → 홈 화면에 추가\n안드로이드: Chrome 메뉴(⋮) → 앱 설치');
};

/* PWA */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__deferredPrompt = e; });

/* start */
boot();
