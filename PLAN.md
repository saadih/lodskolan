# Lödskolan: plan

An interactive website for learning to solder: a game for judging solder joints, plus short theory pages.
The site is in Swedish first (that is what the class uses), with English as an option later.

## Tech (kept boring on purpose)

- Plain HTML, CSS and JavaScript. No framework, no build step: open `index.html` and it runs.
- Solder joints are drawn as SVG in code, so no image files are needed and they scale on a phone.
- Hosted on Cloudflare (Worker `lodskolan`, static files) at https://solder.saadih.work. Deploy with `npx wrangler deploy`.
- Works on a phone first, because students will open it on their phones.

## Versions

### v0.1: Lödsimulatorn (built)
You solder a through-hole joint yourself with two hold buttons, Kolv (iron) and Tenn (solder), or the keys
A and L. A simple heat model runs underneath: the iron heats the joint, solder only melts when the joint is
hot enough, flux burns off faster the hotter it gets, and the board takes damage above about 290 °C. The
result depends on timing:

- Too short a preheat, or the iron removed too early: cold joint (kallod).
- Iron held too long after the solder flowed: the flux burns off and the joint goes dull and grainy.
- Much too long: the pad lifts off the board.
- Too little or too much solder.
- Iron removed while still feeding solder: the wire freezes into the joint.

Levels: 1 leaded with thermometer, 2 lead-free, 3 without thermometer, 4 ground plane where you pick tip
and temperature (a conical tip can't heat it). Each result explains what went wrong and how to fix it.

### v0.1b: Fogkollen (the joint inspector)
A joint is shown (side view of a through-hole joint). You pick what it is:

| Joint | What you see | Cause |
|---|---|---|
| Bra fog (good) | Shiny, concave "volcano" fillet, lead visible | Correct heat and amount |
| Kall fog (cold) | Dull, grainy, lumpy | Too little heat, or the joint moved while cooling |
| För lite tenn (too little) | Thin fillet, hole not filled | Removed solder too early |
| För mycket tenn (too much) | Round ball, lead hidden | Fed too much solder |
| Kortslutning / brygga (bridge) | Solder joining two pads | Too much solder, or dragged the tip |
| Ej vätt / dålig vätning (not wetted) | Solder sits like a bead, does not flow onto the pad | Dirty pad or lead, no flux, too little heat |
| Lyft pad (lifted pad) | Copper pad peeled off the board | Too much heat for too long |

After each answer it explains why and how to fix it. 10 joints per round, score at the end.
Done = it works on a phone and you have shown it to the teacher.

### v0.2: Theory pages (short, one screen each)
1. **Spetsar (tips)**: conical, chisel, bevel/hoof, knife, needle. What each is for. Chisel is the
   everyday tip because it moves heat well; a fine conical tip holds little heat.
2. **Lödtenn (solder)**: leaded Sn63/Pb37 (melts at 183 °C, eutectic, so no pasty phase) and Sn60/Pb40,
   versus lead-free SAC305 (Sn96.5/Ag3/Cu0.5, melts at about 217–220 °C, needs a hotter tip, looks
   duller even when it is good). RoHS is why industry uses lead-free. Flux core and what flux does.
3. **Hålmontering (through-hole, THT)**: heat pad and lead together, feed solder into the joint and not
   onto the tip, remove solder, then the iron, clip the lead.
4. **Ytmontering (surface mount, SMD)**: tack one pad first, then the rest. Drag soldering for chips.
   Tweezers, solder paste and hot air.
5. **Säkerhet (safety)**: flux fumes (use extraction, do not breathe the smoke), lead (wash your hands,
   no food at the bench), burns, eye protection when clipping leads.

### v0.3: Quiz
A short quiz drawing from the theory pages, mixed with joint pictures.

### Later (only if v0.1–v0.3 are used)
- A timing mini-game: hold heat on the joint, feed solder at the right moment, see the joint form.
- English version.
- Tip temperature guide.

## Rules for the content
- Every explanation is written in our own words. Do not copy course slides, videos, or IPC standard text
  (IPC-A-610, J-STD-001 are copyrighted). The ideas themselves are free to teach.
- The teacher reviews facts before he uses it in class, especially temperatures and safety.
- The footer credits the author and links the GitHub repo.
