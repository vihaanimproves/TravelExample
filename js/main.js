/* ==========================================================================
   WanderLust — interactions & scroll animations
   No dependencies. Uses Lenis for smooth scrolling if it loaded (optional).
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ *
   * CONFIG
   * ------------------------------------------------------------------ */
  const CONFIG = {
    smoothScroll: true,                 // uses Lenis if available
    polaroidImagesIncludeFrame: false,  // true if your dest-*.jpg/png already contain the white polaroid frame + label
    heroVideoTimeout: 2500              // ms to wait for images/hero.mp4 before falling back to images/hero.jpg
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const range = (v, a, b) => clamp((v - a) / (b - a));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // Phone layout (must match the @media query at the bottom of style.css)
  const MQ = matchMedia('(max-width: 767px), (max-width: 1024px) and (orientation: portrait)');
  let mobile = MQ.matches;

  let VW = innerWidth, VH = innerHeight;
  let P = Math.min(VW, VH * 16 / 9) / 1920;          // 1 design px in CSS px (desktop grid)
  let Q = 1;                                          // 1 design px in CSS px (430 px phone grid)
  function measure() {
    VW = innerWidth; VH = innerHeight;
    P = Math.min(VW, VH * 16 / 9) / 1920;
    mobile = MQ.matches;
    const f = document.querySelector('.dest .frame');
    Q = f ? f.offsetWidth / 430 : 1;
    destLastP = -1;
    staysLast = null;
    if (typeof applyPolLayout === 'function') applyPolLayout();
  }
  addEventListener('resize', measure);
  if (MQ.addEventListener) MQ.addEventListener('change', measure);

  /* ------------------------------------------------------------------ *
   * Missing images → hide broken icon (or use data-fallback)
   * ------------------------------------------------------------------ */
  $$('img').forEach(img => {
    const fail = () => {
      if (img.dataset.fallback && !img.dataset.triedFallback) {
        img.dataset.triedFallback = '1';
        img.classList.add('is-fallback');
        img.src = img.dataset.fallback;
        return;
      }
      img.classList.add('is-missing');
    };
    img.addEventListener('error', fail);
    if (img.complete && img.getAttribute('src') && img.naturalWidth === 0) fail();
  });

  /* ------------------------------------------------------------------ *
   * Text splitting  (keeps <i> italics and <br>)
   * ------------------------------------------------------------------ */
  function splitText(el, withChars) {
    const tokens = [];
    (function walk(node, it) {
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) {
          for (const ch of n.textContent.replace(/\s+/g, ' ')) tokens.push({ ch, it });
        } else if (n.nodeName === 'BR') {
          tokens.push({ br: true });
        } else if (n.nodeType === 1) {
          walk(n, it || n.nodeName === 'I' || n.nodeName === 'EM');
        }
      });
    })(el, false);

    // group into words / spaces / breaks
    const parts = [];
    let word = null;
    for (const t of tokens) {
      if (t.br) { word = null; parts.push({ br: true }); continue; }
      if (t.ch === ' ') { word = null; parts.push({ sp: true }); continue; }
      if (!word) { word = []; parts.push({ word }); }
      word.push(t);
    }
    // tidy spaces (no leading/trailing/double, none next to <br>)
    const clean = [];
    parts.forEach((p, i) => {
      if (p.sp) {
        const prev = clean[clean.length - 1];
        const next = parts.slice(i + 1).find(x => !x.sp);
        if (!prev || prev.br || prev.sp || !next || next.br) return;
      }
      clean.push(p);
    });

    el.textContent = '';
    const words = [], chars = [];
    for (const p of clean) {
      if (p.br) {
        // keep a (collapsible) space before the break so lines can re-flow on phones
        if (el.lastChild && el.lastChild.nodeType === 1 && el.lastChild.className === 'w') el.appendChild(document.createTextNode(' '));
        el.appendChild(document.createElement('br'));
        continue;
      }
      if (p.sp) { el.appendChild(document.createTextNode(' ')); continue; }
      const w = document.createElement('span');
      w.className = 'w';
      let group = null, groupIt = null;
      for (const c of p.word) {
        if (withChars) {
          const s = document.createElement('span');
          s.className = 'ch';
          s.textContent = c.ch;
          chars.push(s);
          if (c.it) { const i = document.createElement('i'); i.appendChild(s); w.appendChild(i); }
          else w.appendChild(s);
        } else {
          if (!group || groupIt !== c.it) {
            group = c.it ? document.createElement('i') : document.createTextNode('');
            groupIt = c.it;
            w.appendChild(group);
          }
          if (c.it) group.textContent += c.ch; else group.textContent += c.ch;
        }
      }
      el.appendChild(w);
      words.push(w);
    }
    return { words, chars };
  }

  // Split every char of an element in place, keeping nested wrappers (used for the typed note)
  function splitCharsKeep(el) {
    const chars = [];
    (function walk(node) {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const txt = n.textContent.replace(/\s+/g, ' ');
          const frag = document.createDocumentFragment();
          for (const ch of txt) {
            const s = document.createElement('span');
            s.className = 'ch';
            s.textContent = ch;
            frag.appendChild(s);
            chars.push(s);
          }
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.nodeName !== 'BR') {
          walk(n);
        }
      });
    })(el);
    // trim leading / trailing whitespace chars
    while (chars.length && chars[0].textContent === ' ') chars.shift().remove();
    while (chars.length && chars[chars.length - 1].textContent === ' ') chars.pop().remove();
    return chars;
  }

  const split = new Map();
  $$('[data-split]').forEach(el => split.set(el, splitText(el, el.dataset.split === 'chars')));

  // time-based blur reveals
  const reveal = (el, stagger = .09, base = 0) => {
    el.classList.add('rv');
    split.get(el).words.forEach((w, i) => w.style.setProperty('--d', (base + i * stagger).toFixed(3) + 's'));
  };
  const heroLeft = $('.hero-title-left'), heroRight = $('.hero-title-right');
  reveal(heroLeft, .1, 0);
  reveal(heroRight, .1, .05);
  const destTitle = $('.dest-title'); reveal(destTitle, .1);
  const howTitle = $('.how-title');   reveal(howTitle, .1);
  const planTitle = $('.plan-title'); reveal(planTitle, .1);
  $$('.how-body').forEach(body => {
    let i = 0;
    $$('[data-split]', body).forEach(el => split.get(el).words.forEach(w => w.style.setProperty('--d', (i++ * .028).toFixed(3) + 's')));
  });


  /* ------------------------------------------------------------------ *
   * Smooth scroll (Lenis) + anchor links
   * ------------------------------------------------------------------ */
  let lenis = null;
  if (CONFIG.smoothScroll && !reduceMotion && typeof window.Lenis === 'function') {
    lenis = new window.Lenis({ lerp: .1, smoothWheel: true, wheelMultiplier: 1 });
  }
  $$('[data-scroll]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    const target = id && id.length > 1 ? $(id) : null;
    if (!target) return;
    e.preventDefault();
    setMenu(false);
    if (lenis) lenis.scrollTo(target, { duration: 1.6, force: true });
    else target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }));

  /* ------------------------------------------------------------------ *
   * Mobile menu
   * ------------------------------------------------------------------ */
  const menuBtn = $('#menuBtn'), mMenu = $('#mobileMenu');
  let menuOpen = false;
  function setMenu(open) {
    if (!menuBtn || open === menuOpen) return;
    menuOpen = open;
    root.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.textContent = open ? 'Close' : 'Menu';
    mMenu.setAttribute('aria-hidden', String(!open));
    if (lenis) open ? lenis.stop() : lenis.start();
  }
  if (menuBtn) menuBtn.addEventListener('click', () => setMenu(!menuOpen));
  addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });
  MQ.addEventListener && MQ.addEventListener('change', () => { if (!MQ.matches) setMenu(false); });


  /* ------------------------------------------------------------------ *
   * HERO — intro sequence
   * ------------------------------------------------------------------ */
  const heroMedia = $('#heroMedia');
  const video = $('.hero-video');
  let introStarted = false, videoOk = false;

  const stage = (n) => root.classList.add('s' + n);
  function runIntro() {
    if (introStarted) return;
    introStarted = true;
    if (reduceMotion) {
      heroMedia.classList.add('no-video');
      [1, 2, 3, 4].forEach(stage);
      heroLeft.classList.add('is-in'); heroRight.classList.add('is-in');
      return;
    }
    if (videoOk) {
      try { video.currentTime = 0; video.play().catch(() => heroMedia.classList.add('no-video')); }
      catch (e) { heroMedia.classList.add('no-video'); }
    }
    setTimeout(() => { snapLens(); stage(1); }, 450);
    setTimeout(() => stage(2), 800);
    setTimeout(() => { stage(3); heroLeft.classList.add('is-in'); heroRight.classList.add('is-in'); }, 950);
    setTimeout(() => stage(4), 1250);
  }
  const fontsReady = Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise(r => setTimeout(r, 1500))
  ]);
  const fallbackToStill = () => { heroMedia.classList.add('no-video'); fontsReady.then(runIntro); };

  video.addEventListener('error', fallbackToStill, { once: true });
  video.addEventListener('loadeddata', () => { videoOk = true; fontsReady.then(runIntro); }, { once: true });
  if (video.readyState >= 2) { videoOk = true; fontsReady.then(runIntro); }
  if (video.error) fallbackToStill();
  setTimeout(() => { if (!introStarted) { if (video.readyState < 2) heroMedia.classList.add('no-video'); runIntro(); } }, CONFIG.heroVideoTimeout);

  /* ------------------------------------------------------------------ *
   * HERO — cursor card
   * ------------------------------------------------------------------ */
  const hero = $('.hero');
  const lens = $('#lens'), lensWin = $('#lensWindow'), lensImg = $('#lensImg');
  let mx = VW / 2, my = VH / 2, lx = mx, ly = my, pointerSeen = false;
  hero.addEventListener('pointermove', e => {
    if (mobile) return;                       // phones: the card stays centred
    const r = hero.getBoundingClientRect();
    mx = e.clientX - r.left;
    my = e.clientY - r.top;
    if (!pointerSeen && !root.classList.contains('s1')) { lx = mx; ly = my; }
    pointerSeen = true;
  });
  function snapLens() { lx = mx; ly = my; }
  function updateLens() {
    if (mobile) {
      lx = mx = hero.clientWidth / 2;
      ly = my = hero.clientHeight / 2;
    }
    lx += (mx - lx) * .11;
    ly += (my - ly) * .11;
    const w = lens.offsetWidth, top = lensWin.offsetTop, h = lensWin.offsetHeight;
    const x = lx - w / 2, y = ly - top - h / 2;
    lens.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    lensImg.style.transform = `translate3d(${(-x).toFixed(2)}px, ${(-y - top).toFixed(2)}px, 0)`;
  }

  // slider/list toggle + destination filter (visual state only)
  $$('.view-toggle button').forEach(b => b.addEventListener('click', () => {
    $$('.view-toggle button').forEach(x => x.classList.toggle('is-active', x === b));
  }));
  $$('.dest-filter li').forEach(li => {
    const pick = () => $$('.dest-filter li').forEach(x => x.classList.toggle('is-active', x === li));
    li.addEventListener('click', pick);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });

  const thumbs = $$('.hero-thumb');


  /* ------------------------------------------------------------------ *
   * DESTINATIONS — polaroids fly in, hover to lift
   * ------------------------------------------------------------------ */
  const dest = $('.dest');
  const polStage = $('#polStage');
  if (CONFIG.polaroidImagesIncludeFrame) polStage.classList.add('images-have-frames');
  const listItems = $$('.dest-list li');
  // fly-in start: pushed outward from the cluster centre, bigger and more rotated
  function flyFrom(L, i, cx, cy, base, spread, drop) {
    let dx = L.x - cx, dy = L.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const dist = base + ((i * 173) % spread);
    L.sx = dx * dist;
    L.sy = dy * dist * .75 + drop;
    L.sr = (i % 2 ? 1 : -1) * (14 + ((i * 7) % 12));
    return L;
  }
  const pols = $$('.pol', polStage).map((el, i) => {
    const v = n => parseFloat(el.style.getPropertyValue('--' + n));
    const d = { el, key: el.dataset.key, z: i + 1 };
    d.desk = flyFrom({ x: v('x'), y: v('y'), w: v('w'), h: v('h'), r: v('r') }, i, 960, 640, 560, 280, 60);
    if (el.classList.contains('pol--m')) {
      d.mob = flyFrom({ x: v('mx'), y: v('my'), w: v('mw'), h: v('mh'), r: v('mr') }, i, 215, 360, 300, 90, 30);
      d.mz = v('mz') || 1;
    }
    return d;
  });
  function applyPolLayout() {
    pols.forEach(d => { d.el.style.zIndex = mobile && d.mob ? d.mz : d.z; });
  }
  applyPolLayout();

  function setHover(key) {
    pols.forEach(d => d.el.classList.toggle('is-hover', d.key === key));
    polStage.classList.toggle('has-hover', !!key);
    if (key) listItems.forEach(li => li.classList.toggle('is-active', li.dataset.key === key));
  }
  pols.forEach(d => {
    d.el.addEventListener('pointerenter', () => setHover(d.key));
    d.el.addEventListener('pointerleave', () => setHover(null));
  });
  listItems.forEach(li => {
    li.addEventListener('pointerenter', () => setHover(li.dataset.key));
    li.addEventListener('pointerleave', () => setHover(null));
  });

  let destLastP = -1;
  function updateDest(rect) {
    const p = reduceMotion ? 1 : clamp(1 - rect.top / (VH * .9));
    if (p > .35) destTitle.classList.add('is-in');
    if (Math.abs(p - destLastP) < .0005) return;
    destLastP = p;
    const e = easeInOut(p), k = 1 - e;
    const s = lerp(1.32, 1, e);
    const b = mobile ? 1 : lerp(1, .72, range(e, .55, 1));   // phones keep the cards bright
    const U = mobile ? Q : P;
    for (const d of pols) {
      const L = mobile ? d.mob : d.desk;
      if (!L) continue;                                         // hidden on phones
      const x = L.x + L.sx * k, y = L.y + L.sy * k, r = L.r + L.sr * k;
      d.el.style.transform =
        `translate3d(${((x - L.w / 2) * U).toFixed(2)}px, ${((y - L.h / 2) * U).toFixed(2)}px, 0) rotate(${r.toFixed(2)}deg) scale(${s.toFixed(4)})`;
      d.el.style.setProperty('--b', b.toFixed(3));
    }
  }


  /* ------------------------------------------------------------------ *
   * GO SOMEWHERE — pinned, scroll-driven reveal
   * ------------------------------------------------------------------ */
  const stays = $('.stays');
  const staysBg = $('#staysBg'), staysShade = $('#staysShade');
  const staysTitleChars = split.get($('#staysTitle')).chars;
  const collage = $('#staysCollage');
  const staysHand = $('#staysHand');
  // side text words reveal in a scattered order
  const sideWords = $$('.stays-side').flatMap(el => split.get(el).words);
  const order = sideWords.map((_, i) => i).sort((a, b) => ((a * 7919) % 13) - ((b * 7919) % 13));
  sideWords.forEach((w, i) => { w._t = .55 + (order.indexOf(i) / sideWords.length) * .38; });

  let staysLast = null;
  function updateStays(rect) {
    const t = reduceMotion ? 2 : -rect.top / VH;      // 0 = pinned, grows while scrolling
    if (staysLast !== null && Math.abs(t - staysLast) < .0008) return;
    staysLast = t;

    // background drift + light change
    const bgT = range(t, -1, 2.4);
    staysBg.style.transform = `translate3d(0, ${(lerp(.1, -.12, bgT) * VH).toFixed(1)}px, 0)`;
    staysShade.style.opacity = lerp(1.15, .82, range(t, -.6, 1)).toFixed(3);

    // title: letter by letter
    const n = staysTitleChars.length;
    staysTitleChars.forEach((c, i) => {
      const thr = lerp(-.3, .38, i / (n - 1));
      c.style.opacity = (.28 + .72 * range(t, thr, thr + .1)).toFixed(3);
    });

    // collage
    const k = easeOut(range(t, .3, .62));
    collage.style.opacity = k.toFixed(3);
    collage.style.transform = `translate3d(0, ${((1 - k) * 40 * P).toFixed(1)}px, 0) scale(${(.9 + .1 * k).toFixed(4)})`;
    collage.style.filter = k < 1 ? `blur(${((1 - k) * 8).toFixed(2)}px)` : 'none';

    // side copy, word by word
    for (const w of sideWords) {
      const q = range(t, w._t, w._t + .14);
      w.style.opacity = q.toFixed(3);
      w.style.filter = q < 1 ? `blur(${((1 - q) * 10).toFixed(2)}px)` : 'none';
    }

    // handwritten line
    const hq = range(t, .95, 1.2);
    staysHand.style.opacity = hq.toFixed(3);
    staysHand.style.filter = hq < 1 ? `blur(${((1 - hq) * 6).toFixed(2)}px)` : 'none';
  }


  /* ------------------------------------------------------------------ *
   * HOW WE TRAVEL — expanding columns
   * ------------------------------------------------------------------ */
  const how = $('.how');
  const howHead = $('.how-head');
  const cols = $$('.how-col');
  let activeCol = cols.findIndex(c => c.classList.contains('is-active'));
  if (activeCol < 0) { activeCol = 0; cols[0].classList.add('is-active'); }

  function activate(i) {
    if (i === activeCol) return;
    const prev = cols[activeCol], next = cols[i];
    prev.classList.remove('is-active');
    prev.classList.add('is-leaving');
    clearTimeout(prev._t);
    prev._t = setTimeout(() => {
      if (prev.classList.contains('is-active')) return;
      prev.classList.add('no-tr');
      prev.classList.remove('is-leaving');
      void prev.offsetWidth;
      prev.classList.remove('no-tr');
    }, 1000);
    clearTimeout(next._t);
    next.classList.remove('is-leaving', 'no-tr');
    next.classList.add('is-active');
    activeCol = i;
  }
  cols.forEach((c, i) => {
    c.addEventListener('pointerenter', e => { if (!mobile && e.pointerType !== 'touch') activate(i); });
    c.addEventListener('click', () => { if (!mobile) activate(i); });
    c.addEventListener('focus', () => { if (!mobile) activate(i); });
  });
  // phones: the four cards are stacked; each one reveals its copy as it scrolls in
  function updateHowMobile() {
    for (const c of cols) {
      if (!c.classList.contains('m-in') && c.getBoundingClientRect().top < VH * .82) c.classList.add('m-in');
    }
  }


  /* ------------------------------------------------------------------ *
   * PLAN A JOURNEY — typed note
   * ------------------------------------------------------------------ */
  const planWrap = $('.plan-wrap');
  const note = $('#note');
  const noteChars = splitCharsKeep($('#noteText'));
  const readyChars = splitCharsKeep($('#noteReady'));
  const btnPlan = $('#btnPlan');
  // hand-drawn underlines
  const uls = $$('#noteText .ul').map((ul, n) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ul-svg');
    svg.setAttribute('viewBox', '0 0 100 10');
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', n === 0 ? 'M1 6.5 C 22 3.5, 48 3, 72 4.2 S 94 5.6, 99 4' : 'M1 4.5 C 18 6.5, 46 6.8, 70 5.4 S 92 3.6, 99 4.8');
    path.setAttribute('pathLength', '1');
    svg.appendChild(path);
    ul.appendChild(svg);
    const last = $$('.ch', ul).pop();
    return { ul, end: noteChars.indexOf(last) };
  });
  const GAP = 6;
  let typedLast = -1;
  function updatePlan(noteRect, planRect) {
    if (planRect.top < VH * .62) planTitle.classList.add('is-in');
    const q = reduceMotion ? 1 : range(noteRect.top, VH * .92, VH * .4);
    const total = noteChars.length + GAP + readyChars.length;
    const shown = Math.round(q * total);
    if (shown === typedLast) return;
    typedLast = shown;
    noteChars.forEach((c, i) => c.classList.toggle('on', i < shown));
    readyChars.forEach((c, i) => c.classList.toggle('on', i < shown - noteChars.length - GAP));
    uls.forEach(u => u.ul.classList.toggle('drawn', shown > u.end));
    btnPlan.classList.toggle('is-in', q > .8);
  }

  // newsletter
  const nl = $('#newsletter');
  nl.addEventListener('submit', e => {
    e.preventDefault();
    const input = $('input', nl);
    input.value = '';
    input.placeholder = 'Thank you — talk soon.';
    input.blur();
  });


  /* ------------------------------------------------------------------ *
   * Main loop
   * ------------------------------------------------------------------ */
  const header = $('#header');
  const inView = r => r.bottom > -VH * .2 && r.top < VH * 1.2;

  function frame(time) {
    if (lenis) lenis.raf(time);

    const sy = lenis ? lenis.scroll : scrollY;

    // hero
    const hr = hero.getBoundingClientRect();
    if (inView(hr)) {
      updateLens();
      thumbs.forEach(t => { t.style.transform = `translate3d(0, ${(sy * .14).toFixed(1)}px, 0)`; });
    }

    // destinations
    const dr = dest.getBoundingClientRect();
    if (inView(dr)) updateDest(dr);

    // pinned "stays"
    const sr = stays.getBoundingClientRect();
    if (sr.top < VH * 1.2 && sr.bottom > -VH * .2) updateStays(sr);

    // how we travel
    const hw = how.getBoundingClientRect();
    if (hw.top < VH * (mobile ? .75 : .55)) { howHead.classList.add('is-in'); howTitle.classList.add('is-in'); }
    if (mobile && hw.top < VH && hw.bottom > 0) updateHowMobile();

    // plan + footer
    const pr = planWrap.getBoundingClientRect();
    if (pr.top < VH * 1.1) updatePlan(note.getBoundingClientRect(), pr);

    // header fades out over the light "plan" section
    header.classList.toggle('is-hidden', !menuOpen && pr.top < (mobile ? 64 * Q : 190 * P));

    requestAnimationFrame(frame);
  }
  measure();
  requestAnimationFrame(frame);
})();
