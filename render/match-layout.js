'use strict';

// Classic's reference design has fixed 240px name boxes. Fit only overflowing
// names after fonts load; ordinary names, score, logos and line geometry stay put.
async function fitClassicTeamNames(page) {
  return page.evaluate(() => {
    for (const name of document.querySelectorAll('.team-name')) {
      const range = document.createRange();
      range.selectNodeContents(name);
      const available = name.getBoundingClientRect().width;
      const measured = range.getBoundingClientRect().width;
      if (available > 0 && measured > available + 0.5) {
        const size = parseFloat(getComputedStyle(name).fontSize);
        name.style.fontSize = `${Math.floor(size * available / measured * 10) / 10}px`;
      }
      range.detach();
    }
  });
}

module.exports = { fitClassicTeamNames };
