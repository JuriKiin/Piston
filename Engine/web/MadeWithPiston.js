/**
 * "Made with Piston": the branded splash every Release build opens with. A press comes down and pushes the Piston lockup to the centre, draws back,
 * and the page fades into the game. Click or any key skips it; the game loads underneath while it plays.
 *
 * It lives inside the release bundle (BuildSystem's generated entry calls it and Player.startGame waits for the promise it leaves in
 * globalThis.__PISTON_SPLASH__), not in the page, so it is minified and obfuscated with the game and is not a block of markup a page edit removes.
 * Development builds and the editor never run it.
 */
const STYLE = `
  #pstn-splash { position: fixed; inset: 0; z-index: 2147483647; background: #0E1014; overflow: hidden; cursor: pointer; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  #pstn-splash > * { position: absolute; left: 50%; top: 0; will-change: transform; }
  #pstn-lock { display: flex; align-items: center; gap: .22em; font-size: clamp(44px, 12vmin, 120px); font-weight: 800; letter-spacing: -.02em; color: #fff; line-height: 1; }
  #pstn-lock svg { height: 1.02em; width: auto; display: block; }
  #pstn-rod { width: 14px; margin-left: -7px; background: #FF5A1F; }
  #pstn-plate { height: 18px; border-radius: 6px; background: #FF5A1F; }
  #pstn-made { font-size: clamp(11px, 2.2vmin, 20px); font-weight: 600; letter-spacing: .42em; color: rgba(255,255,255,.55); opacity: 0; white-space: nowrap; padding-left: .42em; }`;

const MARKUP = `<div id="pstn-splash" role="presentation" aria-hidden="true">
  <div id="pstn-rod"></div>
  <div id="pstn-plate"></div>
  <div id="pstn-lock"><svg viewBox="182 167 634 690"><g transform="rotate(38 512 512)"><path fill="#FF5A1F" d="M290 400H350V692A68 68 0 0 0 418 760H606A68 68 0 0 0 674 692V400H734V727A93 93 0 0 1 641 820H383A93 93 0 0 1 290 727Z"/><rect fill="#FF5A1F" x="484" y="150" width="56" height="380"/><rect fill="#FF5A1F" x="392" y="150" width="240" height="80" rx="40"/><rect fill="#FFF4D6" x="392" y="520" width="240" height="120" rx="22"/></g></svg><span>Piston</span></div>
  <div id="pstn-made">MADE WITH</div>
</div>`;

/** Shows the splash and returns a promise that resolves when it has finished or been skipped. */
export function madeWithPiston() {
  if (typeof document === 'undefined' || !document.body) return Promise.resolve();
  const sheet = document.createElement('style');
  sheet.textContent = STYLE;
  document.head.appendChild(sheet);
  document.body.insertAdjacentHTML('afterbegin', MARKUP);
  return (function () {
    var D = 2.0, root = document.getElementById('pstn-splash');
    var rod = document.getElementById('pstn-rod'), plate = document.getElementById('pstn-plate'), lock = document.getElementById('pstn-lock'), made = document.getElementById('pstn-made');
    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var done, finished = false, start = null;
    var promise = new Promise(function (r) { done = r; });
    var clamp = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
    function finish() {
      if (finished) return;
      finished = true;
      window.removeEventListener('keydown', skip, true);
      root.removeEventListener('pointerdown', skip, true);
      if (root.parentNode) root.parentNode.removeChild(root);
      done();
    }
    function skip(e) { if (e) { e.stopPropagation(); e.preventDefault && e.preventDefault(); } finish(); }
    function frame(t) {
      var vh = window.innerHeight, w = lock.offsetWidth, h = lock.offsetHeight, ph = plate.offsetHeight, gap = 4;
      var x = clamp(t / 0.85), c1 = 0.9, c3 = c1 + 1;
      var push = reduced ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
      var r = reduced ? 0 : clamp((t - 0.95) / 0.4), retract = r * r * r;
      var cy = -h + (vh / 2 + h) * push;                        // centre of the lockup
      var py = cy - h / 2 - gap - ph / 2 - retract * (vh / 2 + 160);
      var settle = reduced ? 0 : Math.sin(Math.PI * clamp((t - 0.8) / 0.35));
      plate.style.width = (w + 64) + 'px';
      plate.style.transform = 'translate(-50%,' + (py - ph / 2) + 'px)';
      rod.style.height = Math.max(0, py + ph / 2) + 'px';
      rod.style.transform = 'translateY(-20px)';
      lock.style.transform = 'translate(-50%,' + (cy - h / 2) + 'px) scale(' + (1 + 0.03 * settle) + ')';
      made.style.transform = 'translate(-50%,' + (cy - h / 2 - 3.2 * made.offsetHeight) + 'px)';
      made.style.opacity = String(clamp((t - 0.95) / 0.3));
      root.style.opacity = String(1 - clamp((t - (D - 0.4)) / 0.4));
    }
    function tick(now) {
      if (finished) return;
      if (start === null) start = now;
      var t = (now - start) / 1000;
      if (t >= D) return finish();
      frame(t);
      window.requestAnimationFrame(tick);
    }
    window.addEventListener('keydown', skip, true);
    root.addEventListener('pointerdown', skip, true);
    frame(0);
    window.requestAnimationFrame(tick);
    return promise;
  })();
}

/** Starts the splash and records it where Player.startGame looks. Called once from a Release build's generated entry module. */
export function installMadeWithPiston() {
  globalThis.__PISTON_SPLASH__ = madeWithPiston();
  return globalThis.__PISTON_SPLASH__;
}
