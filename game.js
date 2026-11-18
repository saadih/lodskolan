'use strict';

/* ---------- små hjälpare ---------- */
const $ = (s) => document.querySelector(s);
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mix = (a, b, t) => a + (b - a) * t;
const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');

/* ---------- fysik-konstanter ----------
   Förenklad modell, avstämd så att tajmingen känns som på riktigt:
   ~1–2 s förvärmning, ~1 s tenn, ~0,5 s efter. */
const ROOM = 25;          // rumstemperatur, °C
const WET_MARGIN = 25;    // tennet flyter ut ordentligt ca 25 °C över smältpunkten
const HOT = 290;          // över detta tar kortet skada
const LIFT_DOSE = 7;      // så mycket värmeskada innan padden släpper
const FEED_RATE = 0.9;    // tennenheter per sekund (1,0 = lagom fog)
const FLUX_PER_SOLDER = 1.1;
const FLUX_BURN = 0.9;
const AIR_COOL = 0.9;

const ALLOYS = {
  bly:    { short: 'Sn63/Pb37 (blyhaltigt)', melt: 183, dull: 0 },
  blyfri: { short: 'SAC305 (blyfritt)', melt: 217, dull: 0.3 },
};
const TIPS = {
  mejsel: { name: 'Mejselspets', k: 1.0 },
  konisk: { name: 'Konisk spets', k: 0.55 },
};

const LEVELS = [
  {
    name: 'Första fogen', sub: 'Blyhaltigt tenn, med termometer',
    alloy: 'bly', tip: 'mejsel', temp: 330, sink: 0.1, thermo: true, hints: true,
    intro: 'Ett motstånd ska lödas fast. Blyhaltigt tenn (Sn63/Pb37) smälter vid 183 °C och är förlåtande. Termometern visar hur varm fogen är, och den gröna linjen är där tennet börjar flyta ut ordentligt.',
  },
  {
    name: 'Blyfritt', sub: 'SAC305 kräver mer värme',
    alloy: 'blyfri', tip: 'mejsel', temp: 360, sink: 0.1, thermo: true, hints: true,
    intro: 'Samma fog med blyfritt tenn (SAC305). Det smälter först vid ca 217 °C, så kolven står varmare och fogen tar lite längre tid. Varmare kolv betyder också att flussmedlet brinner bort fortare. Industrin använder blyfritt på grund av RoHS-direktivet.',
  },
  {
    name: 'Utan termometer', sub: 'Lita på ögonen och tajmingen',
    alloy: 'bly', tip: 'mejsel', temp: 330, sink: 0.1, thermo: false, hints: false,
    intro: 'I verkligheten finns ingen termometer på fogen. Titta på tennet: flyter det ut runt benet och blir blankt? Ryker flussmedlet? Räkna sekunderna du lärt dig.',
  },
  {
    name: 'Jordplanet', sub: 'Välj spets och temperatur själv',
    alloy: 'bly', tip: null, temp: null, sink: 0.6, thermo: true, hints: true, ground: true, choose: true,
    intro: 'Den här padden sitter i ett stort kopparplan (jordplan) som hela tiden leder bort värmen. Välj spets och temperatur innan du börjar. Tänk på att en liten spets har lite värme att ge.',
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
const choice = { tip: 'konisk', temp: 330 };

function newState() {
  return {
    T: ROOM, a: 0, w: 0, flux: 0, ox: 0, dose: 0,
    iron: false, feed: false,
    ironTime: 0, firstMelt: null, wetAt: null, wasMolten: false,
    solidT: 0, coldFeed: 0, maxT: ROOM, rate: 0, plateau: 0, burn: 0,
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
    const b = document.createElement('button');
    b.className = 'level';
    b.innerHTML = `<span class="num">${i + 1}</span>
      <span class="txt"><b>${lv.name}</b><small>${lv.sub}</small></span>
      <span class="st" aria-label="${st} av 3 stjärnor">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>`;
    b.addEventListener('click', () => openIntro(i));
    box.appendChild(b);
  });
}

function chipGroup(label, key, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  wrap.innerHTML = `<span>${label}</span>`;
  opts.forEach(([val, txt]) => {
    const c = document.createElement('button');
    c.className = 'chip' + (choice[key] === val ? ' on' : '');
    c.textContent = txt;
    c.addEventListener('click', () => {
      choice[key] = val;
      wrap.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    });
    wrap.appendChild(c);
  });
  return wrap;
}

function openIntro(i) {
  levelIdx = i;
  const lv = LEVELS[i];
  $('#introTitle').textContent = `${i + 1}. ${lv.name}`;
  $('#introText').textContent = lv.intro;
  const ch = $('#choose');
  ch.innerHTML = '';
  if (lv.choose) {
    ch.appendChild(chipGroup('Spets', 'tip', [['konisk', 'Konisk (spetsig)'], ['mejsel', 'Mejsel (bred)']]));
    ch.appendChild(chipGroup('Temperatur på kolven', 'temp', [[330, '330 °C'], [360, '360 °C'], [400, '400 °C']]));
  }
  show('intro');
}

$('#startBtn').addEventListener('click', startLevel);

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

  $('#gameTitle').textContent = `${levelIdx + 1}. ${lv.name} · ${cfg.temp} °C`;
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
      if (S.firstMelt == null) S.firstMelt = S.ironTime;
    } else {
      S.coldFeed += dt;
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
  if (S.w >= 0.9 && S.wetAt == null) S.wetAt = S.ironTime;

  // utan flussmedel oxiderar smält tenn: matt och grynigt
  if (S.a > 0 && S.T >= melt && S.flux <= 0.05) S.ox = Math.min(1, S.ox + 0.45 * dt);

  // värmeskada på kortet
  if (S.T > HOT) S.dose += ((S.T - HOT) / 40) * dt;
  S.maxT = Math.max(S.maxT, S.T);

  if (dt > 0) S.rate = mix(S.rate, (S.T - prevT) / dt, 0.1);
  if (S.iron && S.T < wetT && Math.abs(S.rate) < 4 && S.ironTime > 2.5) S.plateau += dt; else if (!S.iron) S.plateau = 0;

  // slut?
  if (S.dose >= LIFT_DOSE) { S.lifted = true; finish(); return; }
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
  c.setAttribute('fill', '#dfe6ec');
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
  $('#holeFill').setAttribute('height', (26 * clamp(S.w * Math.min(S.a, 1))).toFixed(1));

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
  $('#ironT').textContent = fmt(S.ironTime) + ' s';

  const [txt, kind] = S.done ? ['', ''] : hint();
  const he = $('#hint');
  he.textContent = txt;
  he.className = 'hint ' + kind;
}

function hint() {
  const { melt, wetT } = cfg;
  if (S.dose > 3.5) return ['Kortet blir brunt. Du värmer för länge!', 'bad'];
  if (S.feed && S.T < melt) return [S.iron ? 'Tennet smälter inte än. Fogen är för kall.' : 'Tennet smälter inte. Kolven är inte på fogen.', 'warn'];
  if (!cfg.hints) return ['', ''];
  if (S.plateau > 1.5) return ['Fogen blir inte varmare. Spetsen räcker inte till här.', 'bad'];
  if (S.a > 0 && S.flux < 0.2 && S.T >= melt) return ['Flussmedlet är nästan slut! Ta bort kolven.', 'warn'];
  if (S.a > 1.45) return ['Nu är det mycket tenn. Sluta mata.', 'warn'];
  if (S.a > 0.75 && S.w >= 0.9 && S.feed) return ['Fogen är fylld. Ta bort tennet.', 'ok'];
  if (S.a > 0.75 && S.w >= 0.9 && S.iron) return ['Bra! Ta bort kolven nu.', 'ok'];
  if (S.a > 0 && S.w < 0.9 && S.T >= wetT) return ['Tennet flyter ut…', 'ok'];
  if (S.a > 0 && S.feed) return ['Fyll fogen…', 'ok'];
  if (S.iron && S.a === 0 && S.T >= wetT) return ['Varmt nog. Mata in tenn!', 'ok'];
  if (S.iron && S.a === 0) return ['Värmer pad och ben…', ''];
  if (S.a === 0) return ['Håll kolven mot pad och ben.', ''];
  return ['', ''];
}

/* ---------- resultat ---------- */
function finish() {
  if (S.done) return;
  S.stuck = input.feed && !S.lifted;
  S.done = true;
  S.iron = S.feed = false;
  S.burn = 0;

  const { melt, wetT, A } = cfg;
  let kind;
  if (S.lifted) kind = 'lyft';
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

  const heldAfter = S.wetAt != null ? S.ironTime - S.wetAt : null;
  const notes = [];
  let title, body;

  switch (kind) {
    case 'bra':
      title = 'Bra fog!';
      body = 'Blank yta, en konkav "vulkan" runt benet, och tennet har flutit ner i hålet. Pad och ben blev varma samtidigt, så tennet vätte båda.';
      if (cfg.alloy === 'blyfri') notes.push('Blyfritt tenn blir lite mattare än blyhaltigt även när fogen är bra. Det är normalt.');
      if (S.dose >= 2) notes.push('Kortet blev lite brunt runt padden. Försök bli klar fortare.');
      if (stars === 2 && S.a < 0.7) notes.push('Fogen håller, men lite mer tenn hade gett en fylligare vulkan.');
      if (stars === 2 && S.a > 1.35) notes.push('Fogen håller, men det är lite mer tenn än det behövs.');
      if (stars === 2 && S.ox >= 0.2) notes.push('Flussmedlet började ta slut. Ta bort kolven lite tidigare.');
      break;
    case 'kall':
      title = 'Kall fog (kallod)';
      body = 'Tennet smälte men flöt aldrig ut och vätte pad och ben. Det blir en grå, klumpig klick som kanske sitter nu men glappar eller spricker senare.';
      if (S.maxT < wetT) {
        notes.push(`Fogen kom bara upp i ${Math.round(S.maxT)} °C. ${A.short} behöver runt ${wetT} °C för att flyta ut.`);
        if (cfg.ground && cfg.tip === 'konisk') notes.push('Den koniska spetsen har för lite massa för att värma ett jordplan. Ta mejselspetsen.');
        else if (cfg.ground) notes.push('Jordplanet drar bort värmen. Prova en högre temperatur.');
      } else {
        notes.push('Fogen var varm nog en stund, men du tog bort kolven innan tennet hann flyta ut.');
      }
      if (S.firstMelt != null && S.firstMelt < 0.7) notes.push(`Du började mata tenn efter bara ${fmt(S.firstMelt)} s. Låt pad och ben bli varma först (1–2 s).`);
      break;
    case 'brand':
      title = 'Bränd fog: flussmedlet tog slut';
      body = 'Flussmedlet i tenntråden brinner bort när det värms. Utan flussmedel oxiderar tennet, och ytan blir matt och grynig. Den ser ut som och beter sig som en kallod.';
      if (heldAfter != null) notes.push(`Du höll kvar kolven ${fmt(heldAfter)} s efter att tennet flutit ut. En halv sekund räcker.`);
      notes.push('Behöver du värma om en fog: tillsätt lite nytt tenn eller flussmedel först.');
      if (cfg.temp >= 400) notes.push('Ju varmare kolv, desto fortare brinner flussmedlet bort.');
      break;
    case 'lite':
      title = 'För lite tenn';
      body = 'Fogen är inte fylld. Hålet och padden är inte täckta, så den kan få dålig kontakt eller släppa.';
      notes.push('Mata tenn tills det bildat en konkav fog runt hela benet, ungefär en sekund.');
      break;
    case 'mycket':
      title = 'För mycket tenn';
      body = 'En rund kula som döljer benet. Du kan inte se om tennet vätt padden under, och nära andra pads blir det lätt en brygga (kortslutning).';
      notes.push('Sluta mata när fogen ser ut som en liten vulkan där benets kontur syns.');
      break;
    case 'lyft':
      title = 'Padden lossnade!';
      body = 'Kopparplattan sitter fast i kortet med lim, och limmet släpper av för mycket värme. Nu är kortet skadat och måste lagas.';
      notes.push(`Kolven var på i ${fmt(S.ironTime)} s. En fog ska ta ungefär 2–4 s.`);
      notes.push('Blir fogen inte klar: ta bort kolven, låt det svalna och försök igen.');
      break;
  }
  if (S.stuck) notes.push('Du tog bort kolven medan du fortfarande matade tenn, och tråden fastnade i fogen. Ta alltid bort tennet först, sedan kolven.');
  if (S.coldFeed > 0.5 && kind !== 'bra') notes.push(`Du tryckte tenntråden mot en kall fog i ${fmt(S.coldFeed)} s. Tennet ska smälta av fogens värme, så mata först när fogen är varm.`);

  const amount = S.a < 0.45 ? 'för lite' : S.a < 0.7 ? 'lite' : S.a <= 1.35 ? 'lagom' : S.a <= 1.6 ? 'mycket' : 'för mycket';
  const stats = [`Kolven på: ${fmt(S.ironTime)} s`];
  if (S.firstMelt != null) stats.push(`förvärmning: ${fmt(S.firstMelt)} s`);
  stats.push(`högsta temp: ${Math.round(S.maxT)} °C`, `tenn: ${amount}`);

  if (stars > 0) {
    store.stars = store.stars || {};
    store.stars[levelIdx] = Math.max(starsFor(levelIdx), stars);
    save();
  }

  $('#rStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  const t = $('#rTitle');
  t.textContent = title;
  t.className = kind === 'bra' ? 'good' : 'bad';
  $('#rBody').textContent = body;
  $('#rNotes').innerHTML = '';
  notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; $('#rNotes').appendChild(li); });
  $('#rStats').textContent = stats.join(' · ');
  $('#nextBtn').textContent = levelIdx < LEVELS.length - 1 ? 'Nästa nivå' : 'Till menyn';
  $('#nextBtn').style.display = kind === 'bra' ? '' : 'none';
  $('#btnIron').classList.remove('on');
  $('#btnFeed').classList.remove('on');
  $('#result').classList.remove('hidden');
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

renderMenu();
