'use strict';

/* ---------- små hjälpare ---------- */
const $ = (s) => document.querySelector(s);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;

/* ---------- fysik-konstanter ----------
   Förenklad modell, avstämd så att tajmingen känns som på riktigt:
   ~1–2 s förvärmning, ~1 s tenn, ~0,5 s efter. */
const ROOM = 25;          // rumstemperatur, °C
const WET_MARGIN = 25;    // tennet flyter ut ordentligt ca 25 °C över smältpunkten
const HOT = 280;          // över detta tar kortet skada
const LIFT_DOSE = 7;      // så mycket värmeskada innan padden släpper
const BURN_DOSE = 4;      // så mycket värmeskada innan kortet räknas som bränt
const FEED_RATE = 0.9;    // tennenheter per sekund (1,0 = lagom fog)
const FLUX_PER_SOLDER = 1.1;
const FLUX_BURN = 0.9;
const AIR_COOL = 0.9;

const ALLOYS = {
  bly:    { short: 'Tenn med bly', melt: 183, dull: 0 },      // Sn63/Pb37
  blyfri: { short: 'Blyfritt tenn', melt: 217, dull: 0.3 },   // SAC305
};
const TIPS = {
  mejsel: { name: 'Mejselspets', k: 1.0 },
  konisk: { name: 'Konisk spets', k: 0.55 },
};

const LEVELS = [
  {
    name: 'Första fogen', sub: 'En termometer hjälper dig',
    alloy: 'bly', tip: 'mejsel', temp: 330, sink: 0.1, thermo: true, hints: true,
    intro: 'Du löder fast ett motstånd på ett kretskort. Termometern visar hur varm fogen är, och vid den gröna linjen flyter tennet ut. Inuti tenntråden finns flussmedel som får tennet att fästa. Det brinner bort om du värmer för länge.',
  },
  {
    name: 'Blyfritt tenn', sub: 'Smälter senare och kräver mer värme',
    alloy: 'blyfri', tip: 'mejsel', temp: 360, sink: 0.1, thermo: true, hints: true,
    intro: 'Samma fog, nu med blyfritt tenn. Nästan all ny elektronik löds blyfritt. Det smälter vid högre temperatur än tenn med bly, så du får värma längre innan tennet smälter. Kolven är också varmare, och då brinner flussmedlet bort fortare.',
  },
  {
    name: 'Utan termometer', sub: 'Titta på tennet i stället',
    alloy: 'bly', tip: 'mejsel', temp: 330, sink: 0.1, thermo: false, hints: false,
    intro: 'Nu har du ingen termometer, precis som vid en riktig lödstation. Prova med tenntråden: när den smälter är fogen varm. Lyft kolven när tennet flutit ut runt benet.',
  },
  {
    name: 'Stor kopparyta', sub: 'Du väljer spets och temperatur',
    alloy: 'bly', tip: null, temp: null, sink: 0.6, thermo: true, hints: true, ground: true, choose: true,
    intro: 'Den här padden sitter ihop med en stor kopparyta på kortet. Koppar leder bort värme, så fogen blir svår att få varm. Välj spets och temperatur innan du börjar. En smal spets ger lite värme och en bred ger mycket.',
  },
];

/* ---------- sparade stjärnor (fungerar även utan localStorage) ---------- */
let store = {};
try { store = JSON.parse(localStorage.getItem('lodskolan') || '{}') || {}; } catch (e) { store = {}; }
function save() { try { localStorage.setItem('lodskolan', JSON.stringify(store)); } catch (e) { /* ok */ } }
const starsFor = (i) => (store.stars && store.stars[i]) || 0;

/* ---------- tillstånd ---------- */
let levelIdx = 0;
let cfg = null;
let S = null;
let raf = 0, lastT = 0, clock = 0;
const input = { iron: false, feed: false };
// dator med tangentbord visar A och L, pekskärm visar knapparnas namn
const KEYS_MODE = !window.matchMedia('(pointer: coarse)').matches;
document.documentElement.classList.toggle('keys-mode', KEYS_MODE);
const choice = { tip: 'konisk', temp: 330 };

function newState() {
  return {
    T: ROOM, a: 0, w: 0, flux: 0, ox: 0, dose: 0,
    iron: false, feed: false,
    ironTime: 0, wasMolten: false,
    solidT: 0, maxT: ROOM, rate: 0, plateau: 0, burn: 0,
    done: false, lifted: false, stuck: false,
    ironPos: 0, wirePos: 0, smokeAcc: 0,
  };
}

/* ---------- skärmar ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'game') startLoop(); else stopLoop();
  if (id === 'menu') renderMenu();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

function renderMenu() {
  const box = $('#levels');
  box.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const st = starsFor(i);
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'lv';
    b.innerHTML = `<span class="lv-num">${i + 1}</span>
      <span><span class="lv-name">${lv.name}</span><span class="lv-sub">${lv.sub}</span></span>
      <span class="lv-stars" aria-label="${st} av 3 stjärnor">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>`;
    b.addEventListener('click', () => openIntro(i));
    li.appendChild(b);
    box.appendChild(li);
  });
}

function chipGroup(label, key, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  wrap.innerHTML = `<span>${label}</span>`;
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', label);
  opts.forEach(([val, txt]) => {
    const c = document.createElement('button');
    c.className = 'chip' + (choice[key] === val ? ' on' : '');
    c.setAttribute('role', 'radio');
    c.setAttribute('aria-checked', choice[key] === val);
    c.textContent = txt;
    c.addEventListener('click', () => {
      choice[key] = val;
      seg.querySelectorAll('.chip').forEach((x) => {
        x.classList.toggle('on', x === c);
        x.setAttribute('aria-checked', x === c);
      });
    });
    seg.appendChild(c);
  });
  wrap.appendChild(seg);
  return wrap;
}

function openIntro(i) {
  levelIdx = i;
  const lv = LEVELS[i];
  $('#introKicker').textContent = `Övning ${i + 1} av ${LEVELS.length}`;
  $('#introTitle').textContent = lv.name;
  $('#introText').textContent = lv.intro;
  const ch = $('#choose');
  ch.innerHTML = '';
  if (lv.choose) {
    ch.appendChild(chipGroup('Spets', 'tip', [['konisk', 'Smal (konisk)'], ['mejsel', 'Bred (mejsel)']]));
    ch.appendChild(chipGroup('Temperatur på kolven', 'temp', [[330, '330 °C'], [360, '360 °C'], [400, '400 °C']]));
  }
  show('intro');
}

$('#startBtn').addEventListener('click', startLevel);
$('#startFirst').addEventListener('click', () => openIntro(0));

function startLevel() {
  const lv = LEVELS[levelIdx];
  cfg = {
    ...lv,
    tip: lv.choose ? choice.tip : lv.tip,
    temp: lv.choose ? choice.temp : lv.temp,
  };
  cfg.A = ALLOYS[cfg.alloy];
  cfg.melt = cfg.A.melt;
  cfg.wetT = cfg.melt + WET_MARGIN;

  $('#gameTitle').textContent = `${levelIdx + 1} · ${lv.name}`;
  $('#ironTemp').textContent = `Kolv ${cfg.temp} °C`;
  $('#gauges').classList.toggle('hidden', !cfg.thermo);
  $('#mMelt').style.left = (cfg.melt / 400 * 100) + '%';
  $('#mWet').style.left = (cfg.wetT / 400 * 100) + '%';
  $('#tipChisel').style.display = cfg.tip === 'mejsel' ? '' : 'none';
  $('#tipConical').style.display = cfg.tip === 'konisk' ? '' : 'none';
  const pad = $('#pad');
  if (cfg.ground) { pad.setAttribute('x', 16); pad.setAttribute('width', 368); }
  else { pad.setAttribute('x', 172); pad.setAttribute('width', 56); }

  reset();
  show('game');
}

function reset() {
  S = newState();
  input.iron = input.feed = false;
  $('#btnIron').classList.remove('on');
  $('#btnFeed').classList.remove('on');
  $('#result').classList.add('hidden');
  $('#game').classList.remove('done');
  render();
}
$('#restartBtn').addEventListener('click', reset);
$('#retryBtn').addEventListener('click', reset);
$('#nextBtn').addEventListener('click', () => {
  if (levelIdx < LEVELS.length - 1) openIntro(levelIdx + 1); else show('menu');
});

/* ---------- fysik ---------- */
function step(dt) {
  const { melt, wetT } = cfg;
  const k = TIPS[cfg.tip].k;
  const prevT = S.T;
  S.iron = input.iron;
  S.feed = input.feed;

  // värme in från kolven, värme ut till luft och kopparplan
  if (S.iron) { S.T += k * (cfg.temp - S.T) * dt; S.ironTime += dt; }
  else S.T -= AIR_COOL * (S.T - ROOM) * dt;
  S.T -= cfg.sink * (S.T - ROOM) * dt;

  // tenn smälter bara om fogen är varm nog (inte av spetsen)
  if (S.feed) {
    if (S.T >= melt) {
      const da = FEED_RATE * dt;
      S.a += da;
      S.flux += da * FLUX_PER_SOLDER;
      S.T -= 35 * da; // kallt tenn kyler fogen lite
    }
  }

  // flussmedlet brinner bort, fortare ju varmare
  S.burn = 0;
  if (S.T > 150 && S.flux > 0) {
    S.burn = FLUX_BURN * Math.pow((S.T - 150) / 200, 1.5);
    S.flux = Math.max(0, S.flux - S.burn * dt);
  }

  if (S.a > 0 && S.T >= melt) S.wasMolten = true;

  // vätning: tennet flyter ut över pad och ben om det är varmt OCH det finns flussmedel
  if (S.a > 0 && S.T >= wetT && S.flux > 0.05) {
    S.w = Math.min(1, S.w + 1.8 * dt * clamp(0.5 + (S.T - wetT) / 20, 0.5, 1.5));
  }

  // utan flussmedel oxiderar smält tenn: matt och grynigt
  if (S.a > 0 && S.T >= melt && S.flux <= 0.05) S.ox = Math.min(1, S.ox + 0.45 * dt);

  // värmeskada på kortet
  if (S.T > HOT) S.dose += ((S.T - HOT) / 40) * dt;
  S.maxT = Math.max(S.maxT, S.T);

  if (dt > 0) S.rate = mix(S.rate, (S.T - prevT) / dt, 0.1);
  if (S.iron && S.T < wetT && Math.abs(S.rate) < 4 && S.ironTime > 2.5) S.plateau += dt; else if (!S.iron) S.plateau = 0;

  // slut?
  if (S.dose >= LIFT_DOSE) { S.lifted = true; finish(); return; }
  if (!S.iron && S.dose >= BURN_DOSE) { finish(); return; } // bränt kort: övningen är slut när kolven lyfts
  if (!S.iron && S.wasMolten && S.T < melt) {
    S.solidT += dt;
    if (S.solidT > 0.3) finish();
  } else S.solidT = 0;
  if (S.ironTime > 20) finish();
}

/* ---------- rök ---------- */
const smokeG = $('#smoke');
const SMOKE_N = 26;
const smoke = [];
for (let i = 0; i < SMOKE_N; i++) {
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('fill', '#8d949c');
  c.setAttribute('opacity', 0);
  smokeG.appendChild(c);
  smoke.push({ el: c, life: 0, x: 0, y: 0, r: 0, vx: 0, vy: 0 });
}

function animate(dt) {
  clock += dt;
  const ironTarget = S.done ? 0 : (input.iron ? 1 : 0);
  const wireTarget = S.done ? 0 : (input.feed ? 1 : 0);
  S.ironPos += (ironTarget - S.ironPos) * Math.min(1, dt * 14);
  S.wirePos += (wireTarget - S.wirePos) * Math.min(1, dt * 14);

  S.smokeAcc += S.burn * 45 * dt;
  while (S.smokeAcc >= 1) {
    S.smokeAcc -= 1;
    const p = smoke.find((q) => q.life <= 0);
    if (!p) break;
    p.life = 1.3; p.x = 200 + (Math.random() * 20 - 10); p.y = 176;
    p.r = 2 + Math.random() * 3; p.vx = Math.random() * 12 - 6; p.vy = -22 - Math.random() * 16;
  }
  for (const p of smoke) {
    if (p.life <= 0) { p.el.setAttribute('opacity', 0); continue; }
    p.life -= dt;
    p.x += p.vx * dt + Math.sin(clock * 3 + p.y * 0.1) * 0.3;
    p.y += p.vy * dt;
    p.r += 7 * dt;
    p.el.setAttribute('cx', p.x.toFixed(1));
    p.el.setAttribute('cy', p.y.toFixed(1));
    p.el.setAttribute('r', p.r.toFixed(1));
    p.el.setAttribute('opacity', (clamp(p.life / 1.3) * 0.45).toFixed(2));
  }
}

/* ---------- ritning ---------- */
function solderPath(a, w) {
  if (a < 0.02) return '';
  const base = 185, cx = 200, lh = 3;
  const over = clamp((a - 1.4) / 0.5);          // för mycket tenn blir en kula
  const sw = w * (1 - over);                    // hur "vätt" formen ser ut
  const rWet = 12 + 20 * Math.min(a, 1.2);
  const rBall = 5 + 9 * Math.sqrt(a);
  const r = Math.min(mix(rBall, rWet, sw), 30);
  const h = Math.min(8 + 30 * a, 76);
  const topY = base - h;
  const conc = { x: cx - lh - 1, y: base - 3 };          // konkav: kramar hörnet
  const conv = { x: cx - r - 5 - 6 * over, y: topY + 4 }; // konvex: bullar ut
  const cl = { x: mix(conv.x, conc.x, sw), y: mix(conv.y, conc.y, sw) };
  const cr = { x: 2 * cx - cl.x, y: cl.y };
  const capY = topY - (h > 60 ? 10 + over * 8 : 3);
  return `M${(cx - r).toFixed(1)} ${base} Q${cl.x.toFixed(1)} ${cl.y.toFixed(1)} ${cx - lh} ${topY.toFixed(1)} `
    + `Q${cx} ${capY.toFixed(1)} ${cx + lh} ${topY.toFixed(1)} Q${cr.x.toFixed(1)} ${cr.y.toFixed(1)} ${(cx + r).toFixed(1)} ${base} Z`;
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function render() {
  if (!S || !cfg) return;
  const { melt, wetT, A } = cfg;
  const molten = S.T >= melt;

  // kolv och tenntråd
  const pi = easeOut(clamp(S.ironPos));
  $('#iron').setAttribute('transform', `translate(${mix(130, 192, pi).toFixed(1)} ${mix(110, 183, pi).toFixed(1)}) rotate(-38)`);
  $('#tipGlow').setAttribute('opacity', (0.55 + 0.15 * Math.sin(clock * 6)).toFixed(2));
  const pw = easeOut(clamp(S.wirePos));
  let wx = mix(268, 207, pw), wy = mix(118, 182, pw);
  if (S.feed && !molten && !S.done) wx += Math.sin(clock * 70) * 0.7; // trycker mot kall fog
  $('#wire').setAttribute('transform', `translate(${wx.toFixed(1)} ${wy.toFixed(1)}) rotate(40)`);

  // tennet
  const d = solderPath(S.a, S.w);
  $('#solder').setAttribute('d', d);
  $('#solderDull').setAttribute('d', d);
  const dull = molten ? S.ox * 1.2 : A.dull + S.ox * 1.4 + (1 - S.w) * 0.85;
  $('#solderDull').setAttribute('opacity', S.a > 0 ? clamp(dull).toFixed(2) : 0);
  const h = Math.min(8 + 30 * S.a, 76);
  const g = $('#glint');
  const gx = 200 - mix(4, 7, S.w), gy = 185 - h * mix(0.55, 0.3, S.w);
  g.setAttribute('cx', gx.toFixed(1));
  g.setAttribute('cy', gy.toFixed(1));
  g.setAttribute('rx', 1.6);
  g.setAttribute('ry', (h * 0.12).toFixed(1));
  g.setAttribute('transform', `rotate(${mix(15, 40, S.w).toFixed(0)} ${gx.toFixed(1)} ${gy.toFixed(1)})`);
  g.setAttribute('opacity', S.a > 0.2 ? ((molten ? 0.85 : 0.45) * (1 - clamp(dull))).toFixed(2) : 0);
  const through = clamp(S.w * Math.min(S.a, 1));
  $('#holeFill').setAttribute('height', (26 * through).toFixed(1));
  // när hålet är fyllt kommer tennet ut på andra sidan och bildar en liten fog där också
  const bf = clamp((through - 0.75) / 0.25);
  const br = 3 + 11 * bf, bh = 9 * bf;
  $('#solderBottom').setAttribute('d', bf > 0.02
    ? `M${(200 - br).toFixed(1)} 219 Q196 220 197 ${(219 + bh).toFixed(1)} L203 ${(219 + bh).toFixed(1)} Q204 220 ${(200 + br).toFixed(1)} 219 Z`
    : '');

  // brännskada och lyft pad
  $('#burn').setAttribute('opacity', (clamp(S.dose / LIFT_DOSE) * 0.85).toFixed(2));
  $('#joint').setAttribute('transform', S.lifted ? 'rotate(9 228 185)' : '');

  // mätare
  if (cfg.thermo) {
    const f = $('#tFill');
    f.style.width = clamp(S.T / 400) * 100 + '%';
    f.style.background = S.T > HOT ? 'var(--bad)' : S.T >= wetT ? 'var(--good)' : S.T >= melt ? 'var(--warn)' : 'var(--cold)';
    $('#tVal').textContent = Math.round(S.T) + ' °C';
    $('#fFill').style.width = clamp(S.flux / 1.5) * 100 + '%';
    $('#fVal').textContent = S.a > 0 ? Math.round(clamp(S.flux / 1.1) * 100) + ' %' : '–';
  }
  const [txt, kind] = S.done ? ['', ''] : hint();
  const he = $('#hint');
  he.textContent = txt;
  he.className = 'hint ' + kind;
}

function hint() {
  const { melt, wetT } = cfg;
  const kIron = KEYS_MODE ? 'A' : 'Kolv', kFeed = KEYS_MODE ? 'L' : 'Tenn';
  if (S.dose > 2) return ['Kortet blir brunt. Lyft kolven!', 'bad'];
  if (S.feed && S.T < melt) return [S.iron ? 'Tennet smälter inte än. Värm lite till.' : `Tennet smälter inte. Håll in ${kIron} så att kolven värmer fogen.`, 'warn'];
  if (S.a === 0 && !S.iron) return [`Håll in ${kIron} för att lägga kolven mot fogen.`, ''];
  if (S.a === 0 && S.iron && !cfg.hints) return [`Håll kvar ${kIron} och prova tennet med ${kFeed}.`, ''];
  if (!cfg.hints) return ['', ''];
  if (S.plateau > 1.5) return ['Fogen blir inte varmare. Spetsen ger för lite värme.', 'bad'];
  if (S.a > 0 && S.flux < 0.2 && S.T >= melt) return ['Flussmedlet tar slut. Lyft kolven.', 'warn'];
  if (S.a > 1.45) return ['Sluta mata, fogen har tenn nog.', 'warn'];
  if (S.a > 0.75 && S.w >= 0.9 && S.feed) return [`Fogen är fylld. Släpp ${kFeed}.`, 'ok'];
  if (S.a > 0.75 && S.w >= 0.9 && S.iron) return [`Lyft kolven nu. Släpp ${kIron}.`, 'ok'];
  if (S.a > 0 && S.w < 0.9 && S.T >= wetT) return ['Tennet flyter ut.', 'ok'];
  if (S.a > 0 && S.feed) return ['Fortsätt mata tills fogen är fylld.', 'ok'];
  if (S.iron && S.a === 0 && S.T >= melt) return [`Fogen är varm. Håll kvar ${kIron} och mata tenn med ${kFeed}.`, 'ok'];
  if (S.iron && S.a === 0) return [`Fogen värms upp. Håll kvar ${kIron}.`, ''];
  return ['', ''];
}

/* ---------- resultat ---------- */
function finish() {
  if (S.done) return;
  S.stuck = input.feed && !S.lifted;
  S.done = true;
  S.iron = S.feed = false;
  S.burn = 0;

  const { wetT } = cfg;
  let kind;
  if (S.lifted) kind = 'lyft';
  else if (S.dose >= BURN_DOSE) kind = 'brant';
  else if (S.a < 0.02) kind = 'inget';
  else if (S.a < 0.45) kind = 'lite';
  else if (S.ox >= 0.5) kind = 'brand';
  else if (S.w < 0.6) kind = 'kall';
  else if (S.a > 1.6) kind = 'mycket';
  else kind = 'bra';

  let stars = 0;
  if (kind === 'bra') {
    stars = (S.dose < 2 && S.a >= 0.7 && S.a <= 1.35 && S.ox < 0.2) ? 3 : 2;
    if (S.stuck) stars = 1;
  }

  const notes = [];
  let title, body, why, fix = '';

  switch (kind) {
    case 'bra':
      title = 'Bra fog';
      body = 'Tennet blänker och ligger som en liten vulkan runt benet. Det har också runnit igenom hålet och kommit ut på andra sidan kortet.';
      why = 'Du värmde padden och benet samtidigt, så tennet fäste på båda.';
      if (cfg.alloy === 'blyfri') notes.push('Blyfritt tenn blir lite mattare än tenn med bly, även i en bra fog.');
      if (S.dose >= 2) notes.push('Kortet fick en brun ring runt padden. Lyft kolven tidigare nästa gång.');
      if (stars === 2 && S.a < 0.7) notes.push('Med lite mer tenn hade vulkanen blivit fylligare.');
      if (stars === 2 && S.a > 1.35) notes.push('Du matade lite mer tenn än fogen behöver.');
      if (stars === 2 && S.ox >= 0.2) notes.push('Flussmedlet höll på att ta slut. Lyft kolven tidigare.');
      break;
    case 'kall':
      title = 'Det blev en kallod';
      body = 'Tennet smälte men flöt aldrig ut över padden och benet. Det ligger som en grå klick ovanpå. En sådan fog kallas kallod, och den kan glappa.';
      if (S.maxT < wetT && cfg.ground && cfg.tip === 'konisk') {
        why = 'Fogen blev aldrig varm nog. Den smala spetsen ger för lite värme för en så stor kopparyta.';
        fix = 'Välj den breda spetsen.';
      } else if (S.maxT < wetT && cfg.ground) {
        why = 'Fogen blev aldrig varm nog. Kopparytan leder bort värmen.';
        fix = 'Värm längre innan du lyfter kolven, eller höj temperaturen.';
      } else {
        why = 'Du lyfte kolven innan fogen blev varm nog för att tennet skulle flyta ut.';
        fix = 'Håll kvar kolven tills du ser tennet flyta ut runt benet. Lyft den sedan.';
      }
      break;
    case 'brand':
      title = 'Fogen blev bränd';
      body = 'Tennet är matt och grynigt i stället för blankt. En sådan fog håller dåligt.';
      why = 'Du höll kvar kolven för länge. Flussmedlet inuti tenntråden brann upp, och utan flussmedel förstörs tennets yta.';
      fix = 'Lyft kolven så fort tennet flutit ut runt benet.';
      if (cfg.temp >= 400) notes.push('Med kolven på 400 °C brinner flussmedlet upp fortare.');
      break;
    case 'brant':
      title = 'Kortet blev bränt';
      body = 'Kortet har fått en brun fläck runt padden. Värmen har skadat kortet, och padden kan lossna.';
      why = 'Du höll kolven mot fogen för länge.';
      fix = 'En fog ska gå fort. Blir den inte klar, lyft kolven och låt fogen svalna innan du provar igen.';
      break;
    case 'inget':
      title = 'Inget tenn på fogen';
      body = 'Du värmde fogen länge, men inget tenn kom dit.';
      why = 'Kolven värmer bara. Tennet kommer från tenntråden.';
      fix = `När fogen är varm, håll in ${KEYS_MODE ? 'L' : 'Tenn'} och mata på tenn.`;
      break;
    case 'lite':
      title = 'För lite tenn';
      body = 'Tennet täcker inte padden och fyller inte hålet. Fogen kan släppa.';
      why = 'Du tog bort tenntråden för tidigt.';
      fix = 'Mata på tills tennet ligger som en liten vulkan runt hela benet.';
      break;
    case 'mycket':
      title = 'För mycket tenn';
      body = 'Tennet blev en rund kula som gömmer benet. Då syns det inte om tennet fäst, och kulan kan nå padden bredvid och kortsluta.';
      why = 'Du matade tenn för länge.';
      fix = 'Ta bort tenntråden medan du fortfarande ser benet sticka upp.';
      break;
    case 'lyft':
      title = 'Padden lossnade';
      body = 'Kopparplattan har släppt från kortet, och nu är kortet trasigt.';
      why = 'Du värmde alldeles för länge. Limmet som håller padden tål inte så mycket värme.';
      fix = 'Blir fogen inte klar, lyft kolven och låt fogen svalna innan du provar igen.';
      break;
  }
  if (S.stuck) notes.push('Du lyfte kolven medan tenntråden låg kvar, och tråden frös fast i fogen. Ta bort tennet först och kolven sist.');

  if (stars > 0) {
    store.stars = store.stars || {};
    store.stars[levelIdx] = Math.max(starsFor(levelIdx), stars);
    save();
  }

  $('#rStars').textContent = kind === 'bra' ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  $('#rStars').setAttribute('aria-label', kind === 'bra' ? `${stars} av 3 stjärnor` : '');
  const stamp = $('#rStamp');
  stamp.textContent = kind === 'bra' ? 'Snyggt!' : 'Prova igen';
  stamp.className = 'stamp ' + (kind === 'bra' ? 'good' : 'bad');
  $('#rTitle').textContent = title;
  $('#rBody').textContent = body;
  $('#rWhy').innerHTML = '<b>Varför?</b> ';
  $('#rWhy').append(why);
  $('#rFix').innerHTML = fix ? '<b>Nästa gång:</b> ' : '';
  if (fix) $('#rFix').append(fix);
  $('#rNotes').innerHTML = '';
  notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; $('#rNotes').appendChild(li); });
  $('#nextBtn').textContent = levelIdx < LEVELS.length - 1 ? 'Nästa övning' : 'Alla övningar';
  $('#nextBtn').style.display = kind === 'bra' ? '' : 'none';
  $('#btnIron').classList.remove('on');
  $('#btnFeed').classList.remove('on');
  $('#game').classList.add('done');
  $('#result').classList.remove('hidden');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#result').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'end' });
  // tangentbordsspelare ska kunna gå vidare med Enter
  (kind === 'bra' ? $('#nextBtn') : $('#retryBtn')).focus({ preventScroll: true });
}

/* ---------- loop ---------- */
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
  lastT = now;
  if (S && cfg) {
    if (!S.done) step(dt);
    animate(dt);
    render();
  }
  raf = requestAnimationFrame(frame);
}
function startLoop() { stopLoop(); lastT = performance.now(); raf = requestAnimationFrame(frame); }
function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

/* ---------- kontroller ---------- */
function bindHold(btn, key) {
  const on = (e) => {
    e.preventDefault();
    if (S && S.done) return;
    try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    input[key] = true;
    btn.classList.add('on');
  };
  const off = () => { input[key] = false; btn.classList.remove('on'); };
  btn.addEventListener('pointerdown', on);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => btn.addEventListener(ev, off));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindHold($('#btnIron'), 'iron');
bindHold($('#btnFeed'), 'feed');

const KEYS = { a: 'iron', arrowleft: 'iron', l: 'feed', arrowright: 'feed' };
const BTN = { iron: '#btnIron', feed: '#btnFeed' };
window.addEventListener('keydown', (e) => {
  const key = KEYS[e.key.toLowerCase()];
  if (!key || !$('#game').classList.contains('active') || e.repeat) return;
  if (S && S.done) return;
  e.preventDefault();
  input[key] = true;
  $(BTN[key]).classList.add('on');
});
window.addEventListener('keyup', (e) => {
  const key = KEYS[e.key.toLowerCase()];
  if (!key) return;
  input[key] = false;
  $(BTN[key]).classList.remove('on');
});
window.addEventListener('blur', () => {
  input.iron = input.feed = false;
  $('#btnIron').classList.remove('on');
  $('#btnFeed').classList.remove('on');
});

// småbilderna på teorisidan ritas med samma form som i spelet
document.querySelectorAll('[data-joint]').forEach((p) => {
  const [a, w] = p.dataset.joint.split(',').map(Number);
  p.setAttribute('d', solderPath(a, w));
});

renderMenu();
