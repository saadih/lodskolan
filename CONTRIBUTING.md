# Contributing

You're welcome to add exercises, fix facts, or improve the text. If you solder for a living and something here
is wrong, that's the most useful thing you can tell us.

## Suggest something

[Open an issue](https://github.com/saadih/lodskolan/issues) and describe the exercise or the mistake. You don't
need to write code.

## Change something yourself

1. Fork the repo and open `index.html` in a browser. There is nothing to install or build.
2. Make your change and try it in the browser, at phone width too.
3. Open a pull request and say what you changed.

The site is three files:

- `index.html`: the screens, the theory page, and the drawing of the board.
- `style.css`: the look.
- `game.js`: the exercises, the heat model, and all result texts.

## Add an exercise

Exercises are the `LEVELS` list at the top of `game.js`. Copy one and change it:

```js
{
  name: 'Stor kopparyta',            // title
  sub: 'Du väljer spets och temperatur', // one line under the title
  intro: '...',                      // what the exercise teaches, shown before it starts
  alloy: 'bly',                      // 'bly' (melts at 183 °C) or 'blyfri' (217 °C)
  tip: 'mejsel',                     // 'mejsel' (wide) or 'konisk' (narrow)
  temp: 330,                         // iron temperature in °C
  sink: 0.1,                         // how fast the board pulls heat away: 0.1 normal pad, 0.6 large copper area
  thermo: true,                      // show the temperature and flux meters
  hints: true,                       // show coaching hints while soldering
  choose: false,                     // true lets the player pick tip and temperature (set tip and temp to null)
  ground: false,                     // true draws the pad as a large copper area
}
```

## Writing rules

The players are beginners, and the site is in Swedish.

- Use plain words. Explain a term the first time, and skip codes like SAC305.
- Don't give times in seconds. Describe what the player should see, such as "when the solder melts".
- A miss is "Prova igen", never a fail grade. Always say why it happened and what to do next time.
- Write "du" and short sentences.

## Facts

Soldering advice differs between workplaces. If you change a temperature or a technique, say in the pull request
where it comes from. Write explanations in your own words and don't copy text from IPC standards or course material.
