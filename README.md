# Lödskolan

A soldering practice game for the phone, in Swedish. You hold one button for the iron and one for the solder,
and a heat model decides the result: a good joint, a cold joint, burnt flux, a lifted pad, or too little or too
much solder. Each result tells you what you did and how to fix it.

Play it at https://solder.saadih.work, or open `index.html` in a browser. Nothing to install.

Made by Hussein Al-Saadi. Teachers can use it in class for free. Star the repo if it helps you.

Want more exercises, or found something wrong? [Open an issue](https://github.com/saadih/lodskolan/issues) and say what you need. To add an exercise or change something yourself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Sources

Claims on the theory page carry numbered footnotes, and the page ends with a reference list in APA style.
If you add or change a fact, add a footnote and a reference for it.

## Deploy

The site runs on Cloudflare Workers as static files. `.assetsignore` keeps everything except `index.html`, `style.css` and `game.js` off the live site.

```
npx wrangler deploy
```
