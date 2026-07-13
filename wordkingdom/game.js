/* ================= 단어 왕국 v3 — game logic (portal edition) ================= */
"use strict";

/* ---------- profile ---------- */
const PROFILE = (window.Cloud && Cloud.getActiveProfile()) ||
                { pid:'local', name:'친구', avatar:'👧', uid:null, guest:true };
const WORDS = window.WK_WORDS;

/* ---------- audio lazy loading (유닛별 청크) ---------- */
const _audioLoading = {};
function ensureAudioUnit(u){
  window.WK_AUDIO_LOADED = window.WK_AUDIO_LOADED || {};
  if (window.WK_AUDIO_LOADED[u]) return Promise.resolve();
  if (_audioLoading[u]) return _audioLoading[u];
  _audioLoading[u] = new Promise((res) => {
    const s = document.createElement('script');
    s.src = '../data/audio/u' + String(u).padStart(2,'0') + '.js';
    s.onload = () => res(); s.onerror = () => res(); // 실패해도 TTS 폴백
    document.head.appendChild(s);
  });
  return _audioLoading[u];
}
function ensureAudioFor(words){
  const units = [...new Set(words.map(w => w.u))];
  return Promise.all(units.map(ensureAudioUnit));
}

/* ---------- word list flattening ---------- */
const ALL = []; // {k, u, i, w, pos, kor, eng, ex, e}
(function(){
  for (let u = 1; u <= 30; u++) {
    const arr = WORDS[String(u)] || [];
    arr.forEach((w, i) => {
      ALL.push({ k: `u${String(u).padStart(2,'0')}_${String(i).padStart(2,'0')}`,
                 u, i, w: w.w, pos: w.pos, kor: cleanKor(w.kor), eng: w.eng, ex: w.ex, e: w.e || null });
    });
  }
})();
function cleanKor(s){ return (s||'').replace(/\s*\n\s*/g,' ').replace(/^[a-z]+\.\s*/,'').trim(); }
const BYKEY = {}; ALL.forEach(w => BYKEY[w.k] = w);

/* ---------- state (프로필별 저장 + 클라우드 동기화) ---------- */
const SKEY = 'wk_v3_' + PROFILE.pid;
let S = null;
function defState(){ return {
  stars: 0, sessions: 0,
  words: {},                 // k -> {lv, ok, ng, seen}
  days: {},                  // 'YYYY-MM-DD' -> {q, ok, stars, unit, udone, advDone}
  stickers: {},              // stickerId -> count
  mini: { bal:0, mem:0, spd:0 },   // best scores
  miniSinceTest: 0,          // 마지막 깜짝시험 이후 미니게임 횟수 (3회마다 시험 필수)
  quest: null,
  cfg: { uFrom:1, uTo:30, dailyNew:6, qPer:12, introEach:true, order:'seq', reviewN:3, testQ:30, testMin:20 },
}; }
function load(){ try { S = JSON.parse(localStorage.getItem(SKEY)) || defState(); } catch(e){ S = defState(); }
  const d = defState();
  S.cfg = Object.assign(d.cfg, S.cfg || {});
  S.stickers = S.stickers || {}; S.mini = Object.assign(d.mini, S.mini || {});
  S.miniSinceTest = Math.max(0, parseInt(S.miniSinceTest, 10) || 0); }
let _syncShown = null;
function save(){
  S._ts = Date.now();
  try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch(e){}
  if (window.Cloud && Cloud.enabled && !PROFILE.guest && Cloud.user){
    Cloud.saveProgress(PROFILE.pid, 'wordKingdom', S);
    const dot = document.getElementById('sync-dot');
    dot.classList.remove('hidden');
    clearTimeout(_syncShown); _syncShown = setTimeout(() => dot.classList.add('hidden'), 1500);
  }
}
function today(){ const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function dayRec(){ const t = today(); if (!S.days[t]) S.days[t] = {q:0, ok:0, stars:0}; return S.days[t]; }
function wRec(k){ if (!S.words[k]) S.words[k] = {lv:0, ok:0, ng:0, seen:0}; return S.words[k]; }
function streak(){
  let n = 0; const d = new Date();
  if (!S.days[today()] || S.days[today()].q === 0) d.setDate(d.getDate()-1);
  for(;;){ const key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    if (S.days[key] && S.days[key].q > 0){ n++; d.setDate(d.getDate()-1); } else break; }
  return n;
}

/* ---------- 오늘의 유닛 (하루 모험 = 유닛 1개 전체) ---------- */
function unitWords(u){ return ALL.filter(w => w.u === u); }
function todayUnit(){
  const d = dayRec();
  if (d.unit && d.unit >= S.cfg.uFrom && d.unit <= S.cfg.uTo) return d.unit;
  let u0 = null;
  for (let u = S.cfg.uFrom; u <= S.cfg.uTo; u++){
    if (unitWords(u).some(w => wRec(w.k).seen === 0)){ u0 = u; break; }
  }
  if (u0 === null){ // 모든 유닛을 본 경우: 가장 약한 유닛으로 복습
    let best = S.cfg.uFrom, bestSum = Infinity;
    for (let u = S.cfg.uFrom; u <= S.cfg.uTo; u++){
      const s = unitWords(u).reduce((a,w) => a + wRec(w.k).lv, 0);
      if (s < bestSum){ bestSum = s; best = u; }
    }
    u0 = best;
  }
  d.unit = u0;
  return u0;
}
function advDoneToday(){ return !!dayRec().advDone; }
function testOwed(){ return (S.miniSinceTest || 0) >= 3; }

/* ---------- audio ---------- */
let AC = null;
function ac(){ if (!AC) AC = new (window.AudioContext||window.webkitAudioContext)(); if (AC.state==='suspended') AC.resume(); return AC; }
let curAudio = null;
function playWord(k){
  const b64 = (window.WK_AUDIO || {})[k];
  if (b64) {
    try { if (curAudio) { curAudio.pause(); }
      curAudio = new Audio('data:audio/mpeg;base64,' + b64);
      curAudio.play().catch(()=>{});
      return; } catch(e){}
  }
  const w = BYKEY[k];
  if (w && window.speechSynthesis) {
    const u = new SpeechSynthesisUtterance(w.w); u.lang = 'en-US'; u.rate = .85;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
}
function tone(freq, t0, dur, type, vol){
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type||'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + t0);
  g.gain.linearRampToValueAtTime(vol||.18, c.currentTime + t0 + .02);
  g.gain.exponentialRampToValueAtTime(.001, c.currentTime + t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + .05);
}
function sfxOk(){ try { [523,659,784,1047].forEach((f,i)=>tone(f, i*.07, .25, 'triangle')); } catch(e){} }
function sfxNo(){ try { tone(220,0,.25,'sine',.1); tone(185,.12,.3,'sine',.1); } catch(e){} }
function sfxFanfare(){ try { [523,659,784,1047,1319,1568].forEach((f,i)=>tone(f, i*.09, .4, 'triangle', .15)); } catch(e){} }
function sfxPop(){ try { tone(880,0,.08,'square',.06); } catch(e){} }

/* ---------- fx particles ---------- */
const fxc = document.getElementById('fx'); const fx = fxc.getContext('2d');
let parts = [];
function fxSize(){ fxc.width = innerWidth; fxc.height = innerHeight; }
addEventListener('resize', fxSize); fxSize();
const P_STARS = ['⭐','🌟','✨','💖','💜'], P_RAIN = ['🌈','⭐','🦄','✨','💖','🌸'];
function burst(x, y, big){
  const glyphs = big ? P_RAIN : P_STARS, n = big ? 34 : 20;
  for (let i = 0; i < n; i++){
    const a = Math.random()*Math.PI*2, sp = (big?7:5)*(.5+Math.random());
    parts.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 3, g: .18,
      life: 1, dec: .012 + Math.random()*.012, s: (big?30:22) + Math.random()*18,
      ch: glyphs[Math.floor(Math.random()*glyphs.length)], rot: Math.random()*6, vr: (Math.random()-.5)*.2 });
  }
}
function fxLoop(){
  fx.clearRect(0,0,fxc.width,fxc.height);
  parts = parts.filter(p => p.life > 0);
  for (const p of parts){
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= p.dec; p.rot += p.vr;
    fx.save(); fx.globalAlpha = Math.max(0, p.life); fx.translate(p.x, p.y); fx.rotate(p.rot);
    fx.font = p.s + 'px serif'; fx.textAlign = 'center'; fx.fillText(p.ch, 0, 0); fx.restore();
  }
  requestAnimationFrame(fxLoop);
}
fxLoop();

/* ---------- background deco ---------- */
(function(){
  const host = document.getElementById('bgDeco');
  const glyphs = ['✨','⭐','🌸','💖','🦄','🌈','👑','🫧'];
  for (let i = 0; i < 16; i++){
    const s = document.createElement('div'); s.className = 'floaty';
    s.textContent = glyphs[i % glyphs.length];
    s.style.left = Math.random()*96 + 'vw';
    s.style.fontSize = (2 + Math.random()*3.5) + 'vmin';
    s.style.animationDuration = (14 + Math.random()*18) + 's';
    s.style.animationDelay = (-Math.random()*20) + 's';
    host.appendChild(s);
  }
})();

/* ---------- screens ---------- */
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function uniTap(){ sfxPop(); const el = document.getElementById('home-uni');
  burst(el.getBoundingClientRect().left + el.offsetWidth/2, el.getBoundingClientRect().top + el.offsetHeight/2, false); }

/* ---------- unicorn friends / castle ---------- */
const FRIENDS = [
  {e:'🦄', n:'루나', c:150},   {e:'🐴', n:'별님이', c:350},  {e:'🧚', n:'반짝요정', c:600},
  {e:'🐇', n:'솜사탕', c:900}, {e:'🦢', n:'백조공주', c:1250},{e:'🐬', n:'바다별', c:1650},
  {e:'🦋', n:'나비여왕', c:2100},{e:'🐉', n:'무지개용', c:2600},{e:'🦩', n:'핑크핑크', c:3150},
  {e:'🐿️', n:'도토리', c:3750}, {e:'🦉', n:'지혜부엉이', c:4400},{e:'👸', n:'공주님', c:5100},
];
FRIENDS[11].n = PROFILE.name + ' 공주';
/* 왕궁 건설 단계 — 모험을 3번 완료할 때마다 한 단계씩 자란다 */
const CASTLE_LEVELS = [
  {e:'🌱',            n:'왕국의 씨앗'},
  {e:'⛺',            n:'모험가의 천막'},
  {e:'🛖',            n:'아늑한 오두막'},
  {e:'🏠',            n:'예쁜 벽돌집'},
  {e:'🏡',            n:'정원 딸린 집'},
  {e:'🏰',            n:'작은 성'},
  {e:'✨🏰✨',         n:'반짝이는 성'},
  {e:'👑🏰👑',         n:'공주의 왕궁'},
  {e:'🌈👑🏰👑🌈',     n:'무지개 대왕궁'},
];
function castleStage(){ return Math.min(CASTLE_LEVELS.length-1, Math.floor(S.sessions / 3)); }
/* 왕국 꾸미기 — 별을 모으면 하나씩 나타난다 */
const KG_DECOS = [
  {c:300,  e:'🎈', n:'축하 풍선'},
  {c:800,  e:'⛲', n:'소원의 분수'},
  {c:1500, e:'🎠', n:'회전목마'},
  {c:2500, e:'🌈', n:'행운의 무지개'},
  {c:4000, e:'🎡', n:'별빛 관람차'},
  {c:6000, e:'🎆', n:'축제 불꽃'},
];
/* 단어 정원 — 유닛 진도에 따라 새싹이 자란다 */
function plantFor(u){
  const uw = unitWords(u);
  const sum = uw.reduce((s,w) => s + Math.min(5, wRec(w.k).lv), 0);
  const pct = uw.length ? sum / (uw.length * 5) : 0;
  const seen = uw.some(w => wRec(w.k).seen > 0);
  if (!seen && pct === 0) return {e:'🌰', s:'씨앗'};
  if (pct < .2)  return {e:'🌱', s:'새싹'};
  if (pct < .45) return {e:'🌿', s:'풀잎'};
  if (pct < .7)  return {e:'🌷', s:'꽃봉오리'};
  if (pct < .95) return {e:'🌸', s:'활짝 핀 꽃'};
  return {e:'🌳', s:'커다란 나무'};
}

/* ---------- home ---------- */
function renderHome(){
  document.getElementById('h-stars').textContent = S.stars;
  document.getElementById('h-streak').textContent = streak();
  document.getElementById('home-title-name').textContent = PROFILE.name + '의 단어 왕국';
  document.getElementById('profile-chip').textContent = PROFILE.avatar + ' ' + PROFILE.name;
  const d = dayRec();
  const u = todayUnit(), uw = unitWords(u);
  const doneN = Object.keys(d.udone || {}).length;
  const advBtn = document.getElementById('btn-adv');
  if (d.advDone){
    document.getElementById('h-goal').textContent = `오늘의 모험 완성! 🎉 (Unit ${d.unit})`;
    advBtn.textContent = '복습 모험 🎀';
  } else {
    document.getElementById('h-goal').textContent = `오늘의 모험: Unit ${u} — ${doneN} / ${uw.length} 단어 💪`;
    advBtn.textContent = doneN > 0 ? `Unit ${u} 이어서 하기! ✨` : `Unit ${u} 모험 시작! ✨`;
  }
  const dots = document.getElementById('h-dots'); dots.innerHTML = '';
  for (let i = 6; i >= 0; i--){
    const dt = new Date(); dt.setDate(dt.getDate()-i);
    const key = dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
    const el = document.createElement('div'); el.className = 'sdot' + (S.days[key] && S.days[key].q>0 ? ' on' : '');
    el.textContent = (S.days[key] && S.days[key].q>0) ? '⭐' : '';
    dots.appendChild(el);
  }
  // 미니게임 카드 잠금 상태
  const locked = !advDoneToday(), owed = testOwed();
  [['mc-bal','bal','잘 듣고 팡!','점'],['mc-mem','mem','카드 뒤집기','점'],['mc-spd','spd','60초 도전!','개']].forEach(([id, kind, def, unit]) => {
    const card = document.getElementById(id), ms = card.querySelector('.ms');
    card.classList.toggle('locked', locked || owed);
    ms.textContent = locked ? '🔒 모험 먼저!' : owed ? '🎯 깜짝 시험 먼저!'
      : (S.mini[kind] ? `최고 ${S.mini[kind]}${unit}` : def);
  });
  const tc = document.getElementById('mc-test');
  tc.classList.toggle('urgent', !locked && owed);
  tc.querySelector('.ms').textContent = owed ? '지금 도전해야 해!' : '실력 확인!';
  const stkN = Object.keys(S.stickers).length;
  document.getElementById('stk-count').textContent = stkN ? `(${stkN}/${STICKERS.length})` : '';
  renderQuests();
  save();
}

/* ---------- 일일 퀘스트 ---------- */
const QUESTS = [
  { icon:'🗺️', label:'단어 모험 1번 완료하기', field:'adv',   goal:1,  reward:30 },
  { icon:'🎪', label:'미니게임 2번 하기',       field:'mini',  goal:2,  reward:30 },
  { icon:'⭐', label:'오늘 별 80개 모으기',     field:'stars', goal:80, reward:30 },
];
function questRec(){
  const t = today();
  if (!S.quest || S.quest.date !== t)
    S.quest = { date:t, adv:0, mini:0, stars:0, claimed:[false,false,false], bonusGiven:false };
  return S.quest;
}
function checkQuests(){
  const q = questRec();
  QUESTS.forEach((qd, i) => {
    if (!q.claimed[i] && q[qd.field] >= qd.goal){
      q.claimed[i] = true;
      S.stars += qd.reward;
      setTimeout(() => burst(innerWidth/2, innerHeight*.25, false), 300 + i*200);
    }
  });
  if (!q.bonusGiven && q.claimed.every(Boolean)){
    q.bonusGiven = true;
    setTimeout(() => giveSticker('🏆 퀘스트 올클리어 보너스!'), 1600);
  }
  save();
}
function renderQuests(){
  const q = questRec();
  document.getElementById('quest-list').innerHTML = QUESTS.map((qd, i) => {
    const v = Math.min(q[qd.field], qd.goal), done = q.claimed[i];
    return `<div class="q-item ${done?'done':''}">
      <span>${done ? '✅' : qd.icon}</span><span>${qd.label}</span>
      <div class="qbar"><div class="qfill" style="width:${v/qd.goal*100}%"></div></div>
      <span>${done ? '+'+qd.reward+'⭐' : v+'/'+qd.goal}</span></div>`;
  }).join('');
}

/* ---------- session builder ---------- */
let Q = null; // {queue:[{k, mode}], idx, correct, stars0, wordsNew:Set, introDone:Set, comboN}
function pool(){ return ALL.filter(w => w.u >= S.cfg.uFrom && w.u <= S.cfg.uTo); }
function pickSession(){
  const p = pool();
  let fresh = p.filter(w => wRec(w.k).seen === 0);           // unit order by default
  if (S.cfg.order === 'random') fresh = fresh.sort(() => Math.random()-.5);
  const learning = p.filter(w => { const r = wRec(w.k); return r.seen > 0 && r.lv < 5; });
  const mastered = p.filter(w => wRec(w.k).seen > 0 && wRec(w.k).lv >= 5);
  learning.sort((a,b) => (wRec(b.k).ng - wRec(a.k).ng) || (wRec(a.k).seen - wRec(b.k).seen));
  // 복습은 최대 reviewN개만 — 나머지는 모두 새 단어로 진도를 나간다
  const revs = learning.slice(0, Math.min(S.cfg.reviewN, Math.max(0, S.cfg.qPer - 1)));
  let nNew = S.cfg.qPer - revs.length;
  const newW = fresh.slice(0, nNew);
  const extra = [];
  let fill = revs.length + newW.length;
  if (fill < S.cfg.qPer){ // 새 단어가 바닥나면 학습중 → 마스터 순으로 채움
    const moreRev = learning.slice(revs.length, revs.length + (S.cfg.qPer - fill));
    extra.push(...moreRev); fill += moreRev.length;
  }
  if (fill < S.cfg.qPer){
    const m2 = mastered.sort(() => Math.random()-.5).slice(0, S.cfg.qPer - fill);
    extra.push(...m2);
  }
  // interleave: 새 단어 사이사이에 복습을 끼워 넣기
  const a = [...newW], b = [...revs, ...extra];
  const list = [];
  while (a.length || b.length){
    if (a.length) list.push(a.shift());
    if (a.length) list.push(a.shift());
    if (b.length) list.push(b.shift());
  }
  return list.slice(0, S.cfg.qPer);
}
function seenPool(){ return pool().filter(w => wRec(w.k).seen > 0); }
function modeFor(w){
  const lv = wRec(w.k).lv, hasE = !!w.e;
  if (lv <= 1) return hasE ? 'w2p' : 'w2k';
  if (lv === 2) return hasE ? 'p2w' : 'k2w';
  if (lv === 3) return hasE ? 'l2p' : 'l2w';
  return 'spell';
}
async function startSession(){
  ac(); // unlock audio on user gesture
  const d = dayRec();
  let words, isDaily = false, dailyU = 0;
  if (!d.advDone){
    // 오늘의 모험: 오늘의 유닛 전체 (아직 못 맞힌 단어들, 유닛 순서대로)
    dailyU = todayUnit();
    d.udone = d.udone || {};
    words = unitWords(dailyU).filter(w => !d.udone[w.k]);
    isDaily = true;
    if (!words.length){ d.advDone = true; save(); renderHome(); return; }
  } else {
    words = pickSession(); // 복습 모험
  }
  if (!words.length){ alert('단어가 없어요! 부모님 설정에서 유닛 범위를 확인해 주세요.'); return; }
  Q = { queue: words.map(w => ({k: w.k})), idx: 0, correct: 0, stars0: S.stars,
        newSet: new Set(words.filter(w => wRec(w.k).seen === 0).map(w => w.k)),
        introDone: new Set(), comboN: 0, total: words.length, isTest: false,
        isDaily, unit: dailyU };
  showScreen('scr-game');
  document.getElementById('r-again').onclick = startSession;
  document.getElementById('g-timer').classList.add('hidden');
  document.getElementById('g-stars').textContent = S.stars;
  await ensureAudioFor(words);
  nextQ();
}

/* ---------- 랜덤 시험 (타임어택) ---------- */
let testTick = null;
async function startTest(){
  ac();
  const seen = seenPool();
  if (seen.length < 8){ alert('아직 시험을 보기엔 배운 단어가 부족해요!\n모험을 몇 번 더 한 뒤에 도전해 보세요 😊'); return; }
  const n = Math.min(S.cfg.testQ, seen.length);
  const words = seen.sort(() => Math.random()-.5).slice(0, n);
  await ensureAudioFor(words);
  Q = { queue: words.map(w => ({k: w.k})), idx: 0, correct: 0, stars0: S.stars,
        newSet: new Set(), introDone: new Set(), comboN: 0, total: n,
        isTest: true, t0: Date.now(), deadline: Date.now() + S.cfg.testMin * 60000 };
  showScreen('scr-game');
  document.getElementById('r-again').onclick = startSession;
  const tm = document.getElementById('g-timer');
  tm.classList.remove('hidden');
  document.getElementById('g-stars').textContent = S.stars;
  clearInterval(testTick);
  testTick = setInterval(() => {
    const left = Q.deadline - Date.now();
    if (left <= 0){ clearInterval(testTick); endSession(false); return; }
    const m = Math.floor(left/60000), s = Math.floor(left%60000/1000);
    tm.textContent = '⏱ ' + m + ':' + String(s).padStart(2,'0');
    tm.style.color = left < 60000 ? '#e04545' : '';
  }, 400);
  nextQ();
}
function confirmQuit(){
  askModal('그만하고 나갈까요?\n(모은 별은 그대로 저장돼요)', () => { endSession(true); });
}

/* ---------- question flow ---------- */
function nextQ(){
  updateProg();
  if (Q.idx >= Q.queue.length){ endSession(false); return; }
  const k = Q.queue[Q.idx].k, w = BYKEY[k];
  if (Q.newSet.has(k) && !Q.introDone.has(k) && S.cfg.introEach){
    renderIntro(w); return;
  }
  const mode = modeFor(w);
  if (mode === 'spell') renderSpell(w); else renderChoice(w, mode);
}
function updateProg(){
  const pct = Math.min(100, Math.round(100 * Q.idx / Q.queue.length));
  document.getElementById('g-prog').style.width = pct + '%';
}
function area(){ return document.getElementById('g-area'); }

function renderIntro(w){
  Q.introDone.add(w.k);
  area().innerHTML = `
    <div class="intro-card">
      <div class="intro-emoji">${w.e || '🌟'}</div>
      <div class="intro-word">${w.w}</div>
      <div class="intro-kor">${w.kor}</div>
      ${w.ex ? `<div class="intro-ex">${w.ex.split('\n')[0]}</div>` : ''}
      <div style="display:flex; gap:3vmin; align-items:center; margin-top:1vmin;">
        <button class="speaker" onclick="playWord('${w.k}')">🔊</button>
        <button class="big-btn" style="font-size:4vmin; padding:1.8vmin 6vmin;" onclick="nextQ()">알겠어! ✨</button>
      </div>
    </div>`;
  playWord(w.k);
}

function distractors(w, n){
  const p = pool().filter(x => x.k !== w.k && x.kor !== w.kor);
  const sameU = p.filter(x => x.u === w.u), rest = p.filter(x => x.u !== w.u);
  const cand = [...sameU.sort(()=>Math.random()-.5), ...rest.sort(()=>Math.random()-.5)];
  const out = [], seen = new Set([w.e, null]);
  for (const c of cand){
    if (out.length >= n) break;
    if (out.some(o => o.kor === c.kor || o.w === c.w)) continue;
    if (w.e && (!c.e || seen.has(c.e))) { if (['w2p','l2p'].includes(curMode)) continue; }
    out.push(c); if (c.e) seen.add(c.e);
  }
  let gi = 0;
  while (out.length < n && gi < p.length){ if (!out.includes(p[gi]) ) out.push(p[gi]); gi++; }
  return out.slice(0, n);
}
let curMode = 'w2p';
function renderChoice(w, mode){
  curMode = mode;
  const opts = [w, ...distractors(w, 3)].sort(() => Math.random()-.5);
  const ansIdx = opts.indexOf(w);
  let promptHtml = '', instr = '', optHtml = i => '';
  if (mode === 'w2p'){ instr = '어떤 그림일까? 그림을 골라봐!';
    promptHtml = `<div class="q-main">${w.w}</div><button class="speaker" onclick="playWord('${w.k}')">🔊</button>`;
    optHtml = o => `<span class="big-e">${o.e || '❓'}</span>`;
  } else if (mode === 'w2k'){ instr = '무슨 뜻일까? 골라봐!';
    promptHtml = `<div class="q-main">${w.w}</div><button class="speaker" onclick="playWord('${w.k}')">🔊</button>`;
    optHtml = o => `<span class="opt-kor" style="font-size:4.2vmin;">${o.kor}</span>`;
  } else if (mode === 'p2w'){ instr = '이 그림은 영어로 뭘까?';
    promptHtml = `<div class="q-main emoji">${w.e}</div>`;
    optHtml = o => `<span>${o.w}</span>`;
  } else if (mode === 'k2w'){ instr = '이 뜻을 가진 영어 단어는?';
    promptHtml = `<div class="q-main" style="font-size:5.5vmin;">${w.kor}</div>`;
    optHtml = o => `<span>${o.w}</span>`;
  } else if (mode === 'l2p'){ instr = '잘 듣고 그림을 골라봐!';
    promptHtml = `<button class="speaker big" onclick="playWord('${w.k}')">🔊</button>`;
    optHtml = o => `<span class="big-e">${o.e || '❓'}</span>`;
  } else { instr = '잘 듣고 단어를 골라봐!'; // l2w
    promptHtml = `<button class="speaker big" onclick="playWord('${w.k}')">🔊</button>`;
    optHtml = o => `<span>${o.w}</span>`;
  }
  area().innerHTML = `
    <div class="q-card"><div class="q-instr">${instr}</div>${promptHtml}</div>
    <div class="opts">${opts.map((o,i) =>
      `<button class="opt" data-i="${i}" onclick="pick(this, ${i === ansIdx}, '${w.k}')">${optHtml(o)}</button>`).join('')}</div>`;
  if (mode === 'w2p' || mode === 'w2k' || mode === 'l2p' || mode === 'l2w') playWord(w.k);
}

let lock = false;
function pick(btn, isRight, k){
  if (lock) return;
  if (isRight){
    lock = true;
    btn.classList.add('correct');
    document.querySelectorAll('.opt').forEach(o => { if (o !== btn) o.classList.add('dim'); });
    onCorrect(btn, k);
    setTimeout(() => { lock = false; Q.idx++; nextQ(); }, 1100);
  } else if (Q.isTest){
    // 시험: 오답이면 정답을 잠깐 보여주고 다음 문제로
    lock = true;
    btn.classList.add('wrongpick');
    onWrong(k);
    const right = [...document.querySelectorAll('.opt')].find(o => (o.getAttribute('onclick')||'').includes('true'));
    if (right) right.classList.add('correct');
    document.querySelectorAll('.opt').forEach(o => { if (o !== right) o.classList.add('dim'); });
    setTimeout(() => { lock = false; Q.idx++; nextQ(); }, 1200);
  } else {
    btn.classList.add('wrongpick');
    setTimeout(() => btn.classList.add('dim'), 400);
    onWrong(k);
  }
}
function markDaily(k){
  if (Q && Q.isDaily){ const d = dayRec(); d.udone = d.udone || {}; d.udone[k] = 1; }
}
function onCorrect(el, k){
  const r = wRec(k); r.seen++; r.ok++; r.lv = Math.min(5, r.lv + 1);
  markDaily(k);
  Q.comboN++; Q.correct++;
  let gain = 10;
  if (Q.comboN >= 3){ gain += 5; comboShow(); }
  S.stars += gain; dayRec().q++; dayRec().ok++; dayRec().stars += gain; questRec().stars += gain;
  document.getElementById('g-stars').textContent = S.stars;
  sfxOk(); playWord(k);
  const rc = el.getBoundingClientRect();
  burst(rc.left + rc.width/2, rc.top + rc.height/2, Q.comboN >= 5);
  save();
}
function onWrong(k){
  const r = wRec(k); r.seen++; r.ng++; r.lv = Math.max(0, r.lv - 1);
  Q.comboN = 0; dayRec().q++;
  // 틀리면 별 -5 (0 아래로는 안 내려감)
  S.stars = Math.max(0, S.stars - 5);
  document.getElementById('g-stars').textContent = S.stars;
  starPenaltyFx();
  sfxNo();
  if (!Q.isTest){
    // requeue the word 2 slots later
    const pos = Math.min(Q.queue.length, Q.idx + 2);
    if (!Q.queue.slice(Q.idx+1).some(q => q.k === k)) Q.queue.splice(pos, 0, {k});
  }
  save();
}
function starPenaltyFx(){
  const t = document.getElementById('combo-tag');
  t.textContent = '💔 -5';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 700);
}
function comboShow(){
  const t = document.getElementById('combo-tag');
  t.textContent = `🌈 ${Q.comboN} 콤보! +5`;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 900);
}

/* ---------- spelling ---------- */
function renderSpell(w){
  curMode = 'spell';
  const word = w.w.toLowerCase().replace(/[^a-z]/g,'');
  const letters = word.split('');
  let shuffled = [...letters].sort(() => Math.random()-.5);
  if (shuffled.join('') === word && word.length > 1) shuffled.reverse();
  let filled = [];
  area().innerHTML = `
    <div class="q-card">
      <div class="q-instr">글자를 순서대로 눌러 단어를 완성해봐!</div>
      <div style="display:flex; align-items:center; gap:3vmin;">
        <div class="q-main emoji" style="font-size:11vmin;">${w.e || '🌟'}</div>
        <div>
          <div class="q-sub" style="font-size:4vmin; font-weight:800;">${w.kor}</div>
          <button class="speaker" style="margin-top:1vmin;" onclick="playWord('${w.k}')">🔊</button>
        </div>
      </div>
    </div>
    <div id="spell-area">
      <div class="slots" id="slots">${letters.map(() => `<div class="slot"></div>`).join('')}</div>
      <div class="tiles" id="tiles">${shuffled.map((ch,i) =>
        `<button class="tile" data-ch="${ch}" data-i="${i}">${ch}</button>`).join('')}</div>
    </div>`;
  playWord(w.k);
  let wrongTries = 0, totalWrong = 0;
  document.querySelectorAll('.tile').forEach(t => {
    t.addEventListener('click', () => {
      if (t.classList.contains('used')) return;
      const need = word[filled.length];
      if (t.dataset.ch === need){
        t.classList.add('used'); sfxPop();
        const slot = document.querySelectorAll('.slot')[filled.length];
        slot.textContent = t.dataset.ch; slot.classList.add('fill');
        filled.push(t.dataset.ch);
        if (filled.length === word.length){
          setTimeout(() => {
            const sc = document.getElementById('slots').getBoundingClientRect();
            onCorrectSpell(w.k, totalWrong, sc);
          }, 250);
        }
      } else {
        wrongTries++; totalWrong++;
        t.classList.add('wrongpick'); sfxNo();
        setTimeout(() => t.classList.remove('wrongpick'), 450);
        if (wrongTries === 3){ // hint: flash next correct tile
          const nxt = [...document.querySelectorAll('.tile')].find(x => !x.classList.contains('used') && x.dataset.ch === need);
          if (nxt){ nxt.style.outline = '4px solid #ffd94d'; setTimeout(()=> nxt.style.outline = '', 1200); }
          wrongTries = 0;
        }
      }
    });
  });
}
function onCorrectSpell(k, wrongTries, rect){
  const r = wRec(k); r.seen++;
  markDaily(k);
  const clean = wrongTries <= 1;
  if (clean){ r.ok++; r.lv = Math.min(5, r.lv + 1); } // gentle
  if (Q.isTest && !clean){
    // 시험에서는 3번 이상 틀리며 완성한 스펠링은 오답 처리
    r.ng++; Q.comboN = 0;
    S.stars = Math.max(0, S.stars - 5); starPenaltyFx();
    dayRec().q++;
  } else {
    Q.comboN++; Q.correct++;
    let gain = 15; if (Q.comboN >= 3) { gain += 5; comboShow(); }
    S.stars += gain; dayRec().q++; dayRec().ok++; dayRec().stars += gain; questRec().stars += gain;
    sfxOk();
    burst(rect.left + rect.width/2, rect.top, Q.comboN >= 5);
  }
  document.getElementById('g-stars').textContent = S.stars;
  playWord(k);
  save();
  setTimeout(() => { Q.idx++; nextQ(); }, 1200);
}

/* ---------- session end ---------- */
function endSession(quit){
  clearInterval(testTick);
  document.getElementById('g-timer').classList.add('hidden');
  if (!quit && !Q.isTest){ S.sessions++; questRec().adv++; }
  if (!quit && Q.isTest) S.miniSinceTest = 0;  // 깜짝시험 완료 → 미니게임 다시 열림
  let dailyClear = false;
  if (Q.isDaily){
    const d = dayRec();
    if (Object.keys(d.udone || {}).length >= unitWords(Q.unit).length && !d.advDone){
      d.advDone = true; dailyClear = true;
    }
  }
  if (!quit) sfxFanfare();
  checkQuests();
  const earned = S.stars - Q.stars0;
  document.getElementById('r-stars').textContent = (earned >= 0 ? '+' : '') + earned;
  document.getElementById('r-correct').textContent = Q.correct + (Q.isTest ? ' / ' + Q.total : '');
  if (Q.isTest){
    const secs = Math.min(S.cfg.testMin*60, Math.round((Date.now() - Q.t0)/1000));
    document.getElementById('r-words').textContent = Math.floor(secs/60) + ':' + String(secs%60).padStart(2,'0');
    document.getElementById('r-words-lab').textContent = '걸린 시간';
    const pct = Q.correct / Q.total;
    document.getElementById('res-title').textContent =
      pct >= 1 ? '💯 만점! 천재 공주님! 👑' : pct >= .8 ? '🏆 대단해! 시험 통과!' : pct >= .5 ? '잘했어! 조금만 더! 💪' : '괜찮아, 다음엔 더 잘할 거야 💖';
  } else {
    document.getElementById('r-words').textContent = Q.newSet.size;
    document.getElementById('r-words-lab').textContent = '배운 단어';
    if (dailyClear){
      document.getElementById('res-title').textContent = `🎉 Unit ${Q.unit} 완성! 미니게임이 열렸어! 🎈`;
    } else {
      const titles = ['완벽해, ' + PROFILE.name + ' 공주님! 👑', '오늘도 최고야! 💖', '유니콘이 감동했어! 🦄', '반짝반짝 빛나는 실력! ✨'];
      document.getElementById('res-title').textContent =
        Q.correct >= Q.total ? titles[0] : titles[1 + Math.floor(Math.random()*3)];
    }
  }
  // friend unlock check
  const before = FRIENDS.filter(f => f.c <= Q.stars0).length;
  const after = FRIENDS.filter(f => f.c <= S.stars).length;
  const unlockEl = document.getElementById('r-unlock');
  if (after > before){
    const f = FRIENDS[after-1];
    unlockEl.textContent = `🎁 새 친구 등장! ${f.e} ${f.n}`;
    unlockEl.classList.remove('hidden');
    setTimeout(() => burst(innerWidth/2, innerHeight/2, true), 600);
  } else unlockEl.classList.add('hidden');
  document.getElementById('res-uni').textContent = ['🦄','🦄💖','👸🦄','🌈🦄'][Math.floor(Math.random()*4)];
  save();
  showScreen('scr-result');
  burst(innerWidth/2, innerHeight*0.3, true);
  // 스티커 보상: 모험 완주 = 확정 1장 / 시험 80%+ = 1장
  if (!quit){
    if (!Q.isTest) setTimeout(() => giveSticker(), 900);
    else if (Q.correct / Q.total >= .8) setTimeout(() => giveSticker(), 900);
  }
}

/* ---------- collection (나의 왕국) ---------- */
function renderCollection(){
  document.getElementById('col-title').textContent = '🏰 ' + PROFILE.name + '의 왕국';
  // ① 하늘 장식 (별로 잠금 해제)
  const sky = document.getElementById('kg-sky'); sky.innerHTML = '';
  KG_DECOS.forEach(dc => {
    const got = S.stars >= dc.c;
    const el = document.createElement('div');
    el.className = 'kg-deco' + (got ? '' : ' locked');
    el.title = got ? dc.n : `⭐${dc.c}`;
    el.textContent = got ? dc.e : '❔';
    if (got) el.onclick = () => { sfxPop(); const r = el.getBoundingClientRect(); burst(r.left+r.width/2, r.top+r.height/2, false); };
    sky.appendChild(el);
  });
  // ② 왕궁
  const st = castleStage(), cl = CASTLE_LEVELS[st];
  document.getElementById('kg-castle').textContent = cl.e;
  document.getElementById('kg-castle-name').textContent = `${cl.n} (${st+1}단계 / ${CASTLE_LEVELS.length}단계)`;
  const nextIn = st >= CASTLE_LEVELS.length-1 ? null : (st+1)*3 - S.sessions;
  document.getElementById('castle-progress').textContent =
    nextIn === null ? '왕궁이 완성됐어요! 🌈👑' : `모험 ${nextIn}번 더 하면 왕궁이 자라나요! (지금까지 ${S.sessions}번 완료)`;
  // ③ 단어 정원 (유닛마다 새싹이 자란다)
  const garden = document.getElementById('kg-garden'); garden.innerHTML = '';
  for (let u = S.cfg.uFrom; u <= S.cfg.uTo; u++){
    const p = plantFor(u);
    const el = document.createElement('div');
    el.className = 'kg-plant';
    el.title = `Unit ${u} — ${p.s}`;
    el.innerHTML = `<div class="pe">${p.e}</div><div class="pu">U${u}</div>`;
    el.onclick = () => { sfxPop(); const r = el.getBoundingClientRect(); burst(r.left+r.width/2, r.top+r.height/2, false); };
    garden.appendChild(el);
  }
  // ④ 유니콘 친구들
  const grid = document.getElementById('uni-grid'); grid.innerHTML = '';
  FRIENDS.forEach(f => {
    const got = S.stars >= f.c;
    const el = document.createElement('div');
    el.className = 'uni-card' + (got ? '' : ' locked');
    el.innerHTML = `<div class="ue">${f.e}</div><div class="un">${got ? f.n : '???'}</div>
      <div class="uc">${got ? '내 친구!' : '⭐ ' + f.c + ' 모으면 만나요'}</div>`;
    if (got) el.addEventListener('click', () => { sfxPop(); const r = el.getBoundingClientRect(); burst(r.left+r.width/2, r.top+r.height/2, false); });
    grid.appendChild(el);
  });
}

/* ---------- parent gate (보안 강화: 두 자리 × 한 자리 곱셈 + 연속 오답 잠금) ---------- */
let gateAns = 0, gateFails = 0, gateLockUntil = 0;
function openGate(){
  if (Date.now() < gateLockUntil){
    askInfo('설정 화면이 잠깐 잠겼어요.\n조금 뒤에 다시 시도해 주세요 🔒');
    return;
  }
  const a = 12 + Math.floor(Math.random()*78), b = 3 + Math.floor(Math.random()*7);
  gateAns = a * b;
  document.getElementById('gate-q').textContent = `${a} × ${b} = ?`;
  document.getElementById('gate-in').value = '';
  document.getElementById('gate').classList.add('show');
  setTimeout(() => document.getElementById('gate-in').focus(), 100);
}
function closeGate(){ document.getElementById('gate').classList.remove('show'); }
function checkGate(){
  if (parseInt(document.getElementById('gate-in').value, 10) === gateAns){
    gateFails = 0;
    closeGate(); renderParent(); showScreen('scr-parent');
  } else {
    gateFails++;
    if (gateFails >= 3){ gateFails = 0; gateLockUntil = Date.now() + 60000; } // 3회 오답 → 1분 잠금
    closeGate();
  }
}

/* ---------- modal ---------- */
function askModal(msg, onYes){
  const m = document.getElementById('modal');
  document.getElementById('modal-msg').textContent = msg;
  document.getElementById('modal-no').style.display = '';
  document.getElementById('modal-yes').textContent = '네';
  m.classList.add('show');
  document.getElementById('modal-yes').onclick = () => { m.classList.remove('show'); onYes(); };
  document.getElementById('modal-no').onclick = () => m.classList.remove('show');
}
function askInfo(msg){
  const m = document.getElementById('modal');
  document.getElementById('modal-msg').textContent = msg;
  document.getElementById('modal-no').style.display = 'none';
  document.getElementById('modal-yes').textContent = '알겠어! ✨';
  m.classList.add('show');
  document.getElementById('modal-yes').onclick = () => m.classList.remove('show');
}

/* ---------- 미니게임 잠금 규칙 ----------
   ① 오늘의 모험(유닛 1개)을 끝내야 미니게임이 열린다
   ② 미니게임을 3번 하면 깜짝 시험을 1번 봐야 다시 열린다 */
function miniGateOK(){
  if (!advDoneToday()){
    askInfo('오늘의 모험을 먼저 끝내야\n미니게임을 할 수 있어! 🗺️✨');
    return false;
  }
  if (testOwed()){
    askModal('미니게임을 3번 했구나!\n🎯 깜짝 시험을 봐야 미니게임이 다시 열려.\n지금 도전해 볼까?', startTest);
    return false;
  }
  return true;
}
function goMini(kind){
  if (!miniGateOK()) return;
  if (kind === 'bal') startBalloon();
  else if (kind === 'mem') startMemory();
  else startSpeed();
}

/* ---------- parent screen ---------- */
function renderParent(){
  const c = S.cfg;
  const p = pool();
  const totalSeen = p.filter(w => wRec(w.k).seen > 0).length;
  const mastered = p.filter(w => wRec(w.k).lv >= 4).length;
  const wrongTop = Object.entries(S.words)
    .filter(([k,r]) => r.ng > 0 && BYKEY[k])
    .sort((a,b) => b[1].ng - a[1].ng).slice(0, 24);
  let unitBars = '';
  for (let u = c.uFrom; u <= c.uTo; u++){
    const uw = ALL.filter(w => w.u === u);
    const seenN = uw.filter(w => wRec(w.k).seen > 0).length;
    const m = uw.filter(w => wRec(w.k).lv >= 4).length;
    // 진행도 = 각 단어 레벨(0~5)의 합 / 최대치 — 한 문제만 맞혀도 바로 올라간다
    const progPct = uw.reduce((s,w) => s + Math.min(5, wRec(w.k).lv), 0) / (uw.length * 5) * 100;
    unitBars += `<div class="ub">Unit ${u} — 학습 ${seenN}/25 · 마스터 ${m}<div class="track"><div class="fillb" style="width:${progPct}%"></div></div></div>`;
  }
  const selN = (id, from, to, val, step) => { let h = `<select id="${id}">`;
    for (let v = from; v <= to; v += (step||1)) h += `<option value="${v}" ${v==val?'selected':''}>${v}</option>`;
    return h + '</select>'; };
  document.getElementById('p-body').innerHTML = `
    <div class="p-sec"><h3>📚 학습 범위와 분량</h3>
      <div class="p-row">유닛 ${selN('cfg-uf',1,30,c.uFrom)} 부터 ${selN('cfg-ut',1,30,c.uTo)} 까지</div>
      <div class="p-row" style="font-size:2.6vmin;color:#a58bb8;">🗺️ 하루 모험 분량은 <b>유닛 1개 전체(25단어)</b>예요. 오늘의 유닛을 다 끝내야 미니게임이 열립니다.
        지금 오늘의 유닛: <b>Unit ${todayUnit()}</b>${advDoneToday() ? ' (완료 🎉)' : ''}</div>
      <div class="p-row">복습 모험 문제 수 ${selN('cfg-q',6,30,c.qPer)} 개 <span style="font-size:2.4vmin;color:#a58bb8;">(오늘의 유닛을 끝낸 뒤 추가 모험)</span></div>
      <div class="p-row">복습 모험 속 복습 단어 ${selN('cfg-rev',0,10,c.reviewN)} 개</div>
      <div class="p-row"><label><input type="checkbox" id="cfg-intro" ${c.introEach?'checked':''}> 새 단어는 먼저 카드로 보여주기</label></div>
      <div class="p-row"><button class="ok-btn" onclick="saveCfg()">설정 저장 ✓</button></div>
    </div>
    <div class="p-sec"><h3>🎪 미니게임 규칙</h3>
      <div class="p-row" style="font-size:2.6vmin;color:#a58bb8;">미니게임을 3번 하면 🎯 깜짝 시험을 1번 봐야 다시 열려요.
        (지금까지 시험 없이 한 미니게임: <b>${S.miniSinceTest || 0} / 3</b>)</div>
    </div>
    <div class="p-sec"><h3>🎯 깜짝 시험 (타임어택)</h3>
      <div class="p-row">문제 수 ${selN('cfg-tq',10,50,c.testQ,5)} 개 · 제한 시간 ${selN('cfg-tm',5,40,c.testMin,5)} 분</div>
      <div class="p-row" style="font-size:2.5vmin; color:#a58bb8;">지금까지 배운 단어 중에서 랜덤으로 출제됩니다. 홈 화면의 "🎯 깜짝 시험 도전!" 버튼으로 시작해요.</div>
    </div>
    <div class="p-sec"><h3>📈 진도 현황</h3>
      <div class="p-row">본 단어 ${totalSeen} / ${p.length} · 마스터 ${mastered}개 · 모은 별 ⭐${S.stars} · 완료한 모험 ${S.sessions}회</div>
      <div class="unit-bars">${unitBars}</div>
    </div>
    <div class="p-sec"><h3>❗ 자주 틀리는 단어</h3>
      <div class="wrong-list">${wrongTop.length ? wrongTop.map(([k,r]) =>
        `<span class="wl-chip">${BYKEY[k].w} (${r.ng}회) · ${BYKEY[k].kor.slice(0,14)}</span>`).join('') : '아직 없어요 😊'}</div>
    </div>
    <div class="p-sec"><h3>💾 저장 데이터</h3>
      <div class="p-row">
        <button class="ok-btn" onclick="exportSave()">백업 파일 내려받기</button>
        <button class="ok-btn" onclick="document.getElementById('imp-file').click()">백업 불러오기</button>
        <input type="file" id="imp-file" accept=".json" style="display:none" onchange="importSave(this)">
        <button class="danger-btn" onclick="resetAll()">모든 기록 초기화</button>
      </div>
      <div class="p-row" style="font-size:2.5vmin; color:#a58bb8;">${(window.Cloud && Cloud.enabled && !PROFILE.guest)
        ? '☁️ 진행 상황이 클라우드에 자동 저장됩니다. 어느 기기에서든 로그인하면 이어서 할 수 있어요.'
        : '진행 상황은 이 기기에 자동 저장됩니다. 로그인하면 여러 기기에서 이어서 할 수 있어요.'}</div>
    </div>`;
}
function saveCfg(){
  const g = id => document.getElementById(id);
  let uf = +g('cfg-uf').value, ut = +g('cfg-ut').value;
  if (uf > ut) [uf, ut] = [ut, uf];
  S.cfg.uFrom = uf; S.cfg.uTo = ut;
  S.cfg.qPer = +g('cfg-q').value;
  S.cfg.reviewN = +g('cfg-rev').value;
  S.cfg.testQ = +g('cfg-tq').value; S.cfg.testMin = +g('cfg-tm').value;
  S.cfg.introEach = g('cfg-intro').checked;
  save(); renderParent();
}
function exportSave(){
  const blob = new Blob([JSON.stringify(S)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'jiin_word_kingdom_backup.json';
  a.click();
}
function importSave(inp){
  const f = inp.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { try {
      const d = JSON.parse(rd.result);
      if (d && d.cfg && d.words !== undefined){ S = d; save(); renderParent(); renderHome(); }
    } catch(e){ alert('백업 파일을 읽을 수 없어요.'); } };
  rd.readAsText(f);
}
function resetAll(){
  askModal('정말 모든 기록을 지울까요?\n(별, 친구, 진도가 사라져요)', () => {
    S = defState(); save(); renderParent(); renderHome();
  });
}

/* ================================================================
   스티커북
   ================================================================ */
const STICKERS = [
  // common (c)
  {e:'🌸',n:'벚꽃',r:'c'},{e:'🍭',n:'막대사탕',r:'c'},{e:'🎀',n:'리본',r:'c'},{e:'🧁',n:'컵케이크',r:'c'},
  {e:'🍓',n:'딸기',r:'c'},{e:'🌷',n:'튤립',r:'c'},{e:'🫧',n:'비눗방울',r:'c'},{e:'🍬',n:'사탕',r:'c'},
  {e:'🐣',n:'아기병아리',r:'c'},{e:'🐞',n:'무당벌레',r:'c'},{e:'🌼',n:'데이지',r:'c'},{e:'🍑',n:'복숭아',r:'c'},
  {e:'⭐',n:'노랑별',r:'c'},{e:'🎈',n:'풍선',r:'c'},{e:'🍩',n:'도넛',r:'c'},{e:'🐌',n:'달팽이',r:'c'},
  {e:'🦆',n:'꽥꽥오리',r:'c'},{e:'🍪',n:'쿠키',r:'c'},{e:'🌈',n:'무지개',r:'c'},{e:'🐠',n:'열대어',r:'c'},
  // rare (r)
  {e:'🦄',n:'미니유니콘',r:'r'},{e:'🧜‍♀️',n:'인어공주',r:'r'},{e:'🦋',n:'보석나비',r:'r'},{e:'🦢',n:'백조',r:'r'},
  {e:'🎠',n:'회전목마',r:'r'},{e:'🌙',n:'초승달',r:'r'},{e:'💎',n:'다이아몬드',r:'r'},{e:'👑',n:'황금왕관',r:'r'},
  {e:'🧚',n:'꽃요정',r:'r'},{e:'🍦',n:'무지개아이스크림',r:'r'},{e:'🎪',n:'서커스천막',r:'r'},{e:'🐬',n:'점프돌고래',r:'r'},
  {e:'🦩',n:'플라밍고',r:'r'},{e:'🍰',n:'공주케이크',r:'r'},{e:'🔮',n:'수정구슬',r:'r'},{e:'🌟',n:'반짝왕별',r:'r'},
  // epic (e)
  {e:'🏰',n:'무지개성',r:'e'},{e:'🐉',n:'아기용',r:'e'},{e:'🦚',n:'공작새여왕',r:'e'},{e:'🧞‍♀️',n:'램프요정',r:'e'},
  {e:'🛸',n:'비밀우주선',r:'e'},{e:'🌋',n:'마법화산',r:'e'},{e:'🎇',n:'축제불꽃',r:'e'},{e:'💫',n:'유성우',r:'e'},
];
function giveSticker(titleMsg){
  const roll = Math.random();
  const rar = roll < .06 ? 'e' : roll < .3 ? 'r' : 'c';
  const cand = STICKERS.filter(s => s.r === rar);
  const s = cand[Math.floor(Math.random()*cand.length)];
  const id = s.e;
  const isNew = !S.stickers[id];
  S.stickers[id] = (S.stickers[id] || 0) + 1;
  let sub;
  if (isNew) sub = `${s.n} ${rar==='e'?'🌟전설 스티커!':rar==='r'?'💜희귀 스티커!':''}`;
  else { S.stars += 15; sub = `${s.n} — 이미 있어서 ⭐15개로 바꿨어!`; }
  if (titleMsg) sub = titleMsg + '\n' + sub;
  document.getElementById('stk-reveal').textContent = s.e;
  document.getElementById('stk-name').textContent = sub;
  document.getElementById('stkModal').classList.add('show');
  sfxFanfare();
  burst(innerWidth/2, innerHeight/2, rar !== 'c');
  save();
}
function closeStk(){ document.getElementById('stkModal').classList.remove('show'); renderHome(); }
function renderStickers(){
  const grid = document.getElementById('stk-grid'); grid.innerHTML = '';
  STICKERS.forEach(s => {
    const n = S.stickers[s.e] || 0;
    const el = document.createElement('div');
    el.className = 'stk' + (n ? '' : ' locked') + (s.r==='r' ? ' rare' : s.r==='e' ? ' epic' : '');
    el.innerHTML = `<div class="se">${s.e}</div><div class="sn">${n ? s.n : '???'}</div>${n>1?`<div class="sc">×${n}</div>`:''}`;
    if (n) el.onclick = () => { sfxPop(); const r = el.getBoundingClientRect(); burst(r.left+r.width/2, r.top+r.height/2, false); };
    grid.appendChild(el);
  });
}

/* ================================================================
   미니게임 공통
   ================================================================ */
let MG = null, mgTimer = null;
function miniArea(){ return document.getElementById('mini-area'); }
function mgStars(n){ S.stars = Math.max(0, S.stars + n); document.getElementById('m-stars').textContent = S.stars; }
function mgWordPool(needEmoji){
  let p = seenPool(); if (needEmoji) p = p.filter(w => w.e);
  if (p.length < 10){ let f = pool(); if (needEmoji) f = f.filter(w => w.e); p = f.slice(0, 25); }
  return p.sort(() => Math.random()-.5);
}
function quitMini(){ clearInterval(mgTimer); clearTimeout(MG && MG.to); save(); showScreen('scr-home'); renderHome(); }
function endMini(kind, score, label){
  clearInterval(mgTimer); clearTimeout(MG && MG.to);
  questRec().mini++;
  S.miniSinceTest = (S.miniSinceTest || 0) + 1;
  if (score > (S.mini[kind] || 0)) S.mini[kind] = score;
  checkQuests();
  const earned = S.stars - MG.stars0;
  document.getElementById('r-stars').textContent = (earned>=0?'+':'') + earned;
  document.getElementById('r-correct').textContent = score;
  document.getElementById('r-words').textContent = S.mini[kind];
  document.getElementById('r-words-lab').textContent = '최고 기록';
  document.getElementById('res-title').textContent = label;
  document.getElementById('res-uni').textContent = ['🦄','🎉🦄','🌈🦄'][Math.floor(Math.random()*3)];
  document.getElementById('r-unlock').classList.add('hidden');
  const rst = MG.restart;
  document.getElementById('r-again').onclick = () => { if (miniGateOK()) rst(); };
  save();
  showScreen('scr-result');
  sfxFanfare();
  burst(innerWidth/2, innerHeight*.3, true);
  if (Math.random() < .4) setTimeout(() => giveSticker(), 900);
}

/* ---------------- 🎈 풍선 팡팡 ---------------- */
async function startBalloon(){
  ac();
  const words = mgWordPool(true);
  await ensureAudioFor(words.slice(0, 20));
  MG = { kind:'bal', round:0, score:0, stars0:S.stars, words, restart:startBalloon, to:null };
  showScreen('scr-mini');
  document.getElementById('m-timer').classList.add('hidden');
  document.getElementById('m-stars').textContent = S.stars;
  balRound();
}
const BAL_COLORS = ['hue-rotate(0deg)','hue-rotate(60deg)','hue-rotate(140deg)','hue-rotate(200deg)','hue-rotate(280deg)'];
function balRound(){
  if (MG.round >= 8){ endMini('bal', MG.score, MG.score >= 7 ? '풍선 마스터! 🎈👑' : '풍선 팡팡 끝! 🎈'); return; }
  MG.round++;
  document.getElementById('mini-instr').textContent = `${MG.round} / 8 — 🔊 잘 듣고 맞는 그림 풍선을 터뜨려!`;
  const target = MG.words[(MG.round-1) % MG.words.length];
  const decoys = MG.words.filter(w => w.k !== target.k && w.e !== target.e).slice(0, 12)
                   .sort(() => Math.random()-.5).slice(0, 4);
  const set = [target, ...decoys].sort(() => Math.random()-.5);
  const area = miniArea(); area.innerHTML =
    `<button class="speaker" style="position:absolute; top:1vmin; left:50%; transform:translateX(-50%); z-index:3;"
      onclick="playWord('${target.k}')">🔊</button>`;
  const W = area.clientWidth || innerWidth;
  set.forEach((w, i) => {
    const b = document.createElement('div'); b.className = 'balloon';
    b.innerHTML = `<div class="bb" style="filter:${BAL_COLORS[i%5]} drop-shadow(0 4px 6px rgba(160,48,143,.25));">🎈</div><div class="bw">${w.e}</div>`;
    const x = 4 + (i * (88 / set.length)) + Math.random()*6;
    b.style.left = x + '%';
    b.style.top = '105%';
    b.style.transition = 'top ' + (8 + Math.random()*3) + 's linear';
    b.onclick = () => {
      if (b.classList.contains('popped')) return;
      if (w.k === target.k){
        b.classList.add('popped'); sfxOk(); mgStars(+8); MG.score++;
        questRec().stars += 8;
        const r = b.getBoundingClientRect(); burst(r.left + r.width/2, r.top + r.height/2, false);
        playWord(target.k);
        clearTimeout(MG.to);
        setTimeout(balRound, 800);
      } else {
        b.style.animation = 'shake .4s'; setTimeout(() => b.style.animation = '', 450);
        sfxNo(); mgStars(-2);
      }
    };
    area.appendChild(b);
    requestAnimationFrame(() => requestAnimationFrame(() => { b.style.top = '-25%'; }));
  });
  playWord(target.k);
  clearTimeout(MG.to);
  MG.to = setTimeout(() => { sfxNo(); balRound(); }, 11500); // 시간 초과 → 다음 라운드
}

/* ---------------- 🃏 카드 짝 맞추기 ---------------- */
async function startMemory(){
  ac();
  const words = mgWordPool(true).slice(0, 6);
  await ensureAudioFor(words);
  MG = { kind:'mem', flips:0, matched:0, first:null, lockM:false, stars0:S.stars, restart:startMemory, to:null };
  showScreen('scr-mini');
  document.getElementById('m-timer').classList.add('hidden');
  document.getElementById('m-stars').textContent = S.stars;
  document.getElementById('mini-instr').textContent = '🃏 단어와 그림 짝을 찾아봐!';
  const cards = [];
  words.forEach(w => { cards.push({k:w.k, face:w.w, kind:'w'}); cards.push({k:w.k, face:w.e, kind:'e'}); });
  cards.sort(() => Math.random()-.5);
  const area = miniArea();
  area.innerHTML = `<div class="mem-grid" style="grid-template-columns:repeat(4, minmax(16vmin, 20vmin));"></div>`;
  const grid = area.querySelector('.mem-grid');
  cards.forEach(c => {
    const el = document.createElement('button'); el.className = 'mem-card';
    el.innerHTML = `<span class="mback">🌟</span><span class="mface" style="font-size:${c.kind==='e'?'8':'4'}vmin;">${c.face}</span>`;
    el.onclick = () => memFlip(el, c);
    grid.appendChild(el);
  });
}
function memFlip(el, c){
  if (MG.lockM || el.classList.contains('flip') || el.classList.contains('matched')) return;
  el.classList.add('flip'); sfxPop();
  if (!MG.first){ MG.first = {el, c}; return; }
  MG.flips++;
  const f = MG.first; MG.first = null;
  if (f.c.k === c.k && f.c.kind !== c.kind){
    f.el.classList.add('matched'); el.classList.add('matched');
    MG.matched++; mgStars(+6); questRec().stars += 6; sfxOk(); playWord(c.k);
    const r = el.getBoundingClientRect(); burst(r.left + r.width/2, r.top + r.height/2, false);
    if (MG.matched === 6){
      const bonus = Math.max(0, 40 - Math.max(0, MG.flips - 6) * 4);
      mgStars(bonus); questRec().stars += bonus;
      const score = 60 + bonus;
      setTimeout(() => endMini('mem', score, MG.flips <= 9 ? '기억력 천재! 🧠✨' : '짝을 다 찾았어! 🃏'), 700);
    }
  } else {
    MG.lockM = true; sfxNo();
    setTimeout(() => { f.el.classList.remove('flip'); el.classList.remove('flip'); MG.lockM = false; }, 900);
  }
}

/* ---------------- ⚡ 스피드 퀴즈 ---------------- */
async function startSpeed(){
  ac();
  const words = mgWordPool(true);
  await ensureAudioFor(words.slice(0, 30));
  MG = { kind:'spd', score:0, streak:0, stars0:S.stars, words, wi:0,
         deadline: Date.now() + 60000, restart:startSpeed, to:null };
  showScreen('scr-mini');
  document.getElementById('m-stars').textContent = S.stars;
  const tm = document.getElementById('m-timer'); tm.classList.remove('hidden');
  clearInterval(mgTimer);
  mgTimer = setInterval(() => {
    const left = MG.deadline - Date.now();
    if (left <= 0){ endMini('spd', MG.score, MG.score >= 12 ? '번개보다 빨라! ⚡👑' : '스피드 퀴즈 끝! ⚡'); return; }
    tm.textContent = '⏱ ' + Math.ceil(left/1000) + '초';
    tm.style.color = left < 10000 ? '#e04545' : '';
  }, 250);
  speedQ();
}
function speedQ(){
  document.getElementById('mini-instr').textContent = `⚡ 최대한 빨리! 지금 ${MG.score}개`;
  const w = MG.words[MG.wi % MG.words.length]; MG.wi++;
  const decoy = MG.words.filter(x => x.k !== w.k && x.e !== w.e)[Math.floor(Math.random() * (MG.words.length - 2))] || MG.words[0];
  const opts = [w, decoy].sort(() => Math.random()-.5);
  const area = miniArea();
  area.innerHTML = `
    <div class="speed-track"><div class="speed-uni" id="spd-uni">🦄</div><div class="speed-goal">🏰</div></div>
    <div class="q-card" style="min-height:16vmin;"><div class="q-main" style="font-size:7vmin;">${w.w}</div></div>
    <div class="opts" style="grid-template-columns:1fr 1fr;">
      ${opts.map(o => `<button class="opt" data-k="${o.k}"><span class="big-e">${o.e}</span></button>`).join('')}
    </div>`;
  document.getElementById('spd-uni').style.left = Math.min(88, MG.score * 6) + '%';
  playWord(w.k);
  area.querySelectorAll('.opt').forEach(b => {
    b.onclick = () => {
      if (b.dataset.k === w.k){
        MG.score++; MG.streak++;
        const gain = 5 + (MG.streak >= 5 ? 3 : 0);
        mgStars(+gain); questRec().stars += gain; sfxPop();
        b.classList.add('correct');
        setTimeout(speedQ, 250);
      } else {
        MG.streak = 0; mgStars(-2); sfxNo();
        b.classList.add('wrongpick');
        setTimeout(speedQ, 500);
      }
    };
  });
}

/* ================================================================
   도움말 (처음 오면 자동으로 보여줘요)
   ================================================================ */
const HELP_PAGES = [
  {e:'🗺️', t:'모험을 떠나요!', d:'하루에 한 유닛(25단어)씩 모험을 해요.\n그림 고르기, 듣기, 스펠링 맞히기까지!\n"모험 시작" 버튼을 눌러 봐요.'},
  {e:'🎈', t:'미니게임이 기다려요', d:'오늘의 모험을 다 끝내면\n풍선 팡팡 · 짝 맞추기 · 스피드 퀴즈가 열려요!\n먼저 공부, 그다음 놀이! 😊'},
  {e:'🎯', t:'깜짝 시험', d:'미니게임을 3번 하고 나면\n깜짝 시험에 도전해야 미니게임이 다시 열려요.\n배운 단어에서만 나오니까 걱정 마요!'},
  {e:'⭐', t:'별을 모아요', d:'정답을 맞히면 별 +10, 연속으로 맞히면 콤보 보너스!\n틀리면 별이 5개 도망가요.\n별을 모으면 유니콘 친구들이 찾아와요 🦄'},
  {e:'🏰', t:'나의 왕국', d:'모험을 할수록 왕궁이 점점 커지고\n유닛을 배울 때마다 정원에 새싹이 자라요!\n스티커북도 꼭 구경해 봐요 📔'},
];
let helpIdx = 0;
function openHelp(){ helpIdx = 0; renderHelp(); document.getElementById('help').classList.add('show'); }
function renderHelp(){
  const p = HELP_PAGES[helpIdx];
  document.getElementById('hp-emoji').textContent = p.e;
  document.getElementById('hp-title').textContent = p.t;
  document.getElementById('hp-desc').textContent = p.d;
  document.getElementById('hp-dots').innerHTML = HELP_PAGES.map((_,i) =>
    `<span class="hdot${i===helpIdx?' on':''}"></span>`).join('');
  document.getElementById('hp-prev').style.visibility = helpIdx === 0 ? 'hidden' : 'visible';
  document.getElementById('hp-next').textContent = helpIdx === HELP_PAGES.length-1 ? '시작하기! 🚀' : '다음 →';
}
function helpNext(){ sfxPop(); if (helpIdx < HELP_PAGES.length-1){ helpIdx++; renderHelp(); } else closeHelp(); }
function helpPrev(){ sfxPop(); if (helpIdx > 0){ helpIdx--; renderHelp(); } }
function closeHelp(){ document.getElementById('help').classList.remove('show');
  if (!S.helpSeen){ S.helpSeen = 1; save(); } }

/* ================================================================
   boot — 클라우드 동기화 후 시작
   ================================================================ */
load();
renderHome();
document.getElementById('gate-in').addEventListener('keydown', e => { if (e.key === 'Enter') checkGate(); });
if (!S.helpSeen) setTimeout(openHelp, 700);

(function cloudBoot(){
  if (!(window.Cloud && Cloud.enabled) || PROFILE.guest || !PROFILE.uid) return;
  Cloud.onAuth(async (u) => {
    if (!u || u.uid !== PROFILE.uid) return;
    try {
      const c = await Cloud.loadProgress(PROFILE.pid, 'wordKingdom');
      if (c && c.state && (c.updatedAt || 0) > (S._ts || 0)){
        S = c.state;
        const d = defState();
        S.cfg = Object.assign(d.cfg, S.cfg || {});
        S.stickers = S.stickers || {}; S.mini = Object.assign(d.mini, S.mini || {});
        try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch(e){}
        renderHome();
      } else if (S._ts) {
        Cloud.saveProgressNow(PROFILE.pid, 'wordKingdom', S);
      }
    } catch(e){ console.warn(e); }
  });
  addEventListener('beforeunload', () => {
    if (Cloud.user) Cloud.saveProgressNow(PROFILE.pid, 'wordKingdom', S);
  });
})();

// 첫 화면에서 오늘의 유닛 오디오 미리 로딩 (백그라운드)
setTimeout(() => { try { ensureAudioUnit(todayUnit()); } catch(e){} }, 1200);
