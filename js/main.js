/* ═══════════════════════════════════════════════════════════════════════
   Personal site — behavior
   No dependencies. Each feature is self-contained, so deleting any one
   block won't break the others.
   ═════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


  /* ─── Theme toggle ───────────────────────────────────────────────────
     The initial theme is set by the inline script in <head> to avoid a
     flash. This just handles clicks and remembers the choice.          */

  var themeBtn = document.getElementById('theme-toggle');

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('theme', next);
      } catch (e) { /* private mode — the choice just won't persist */ }
    });
  }

  // Follow the OS if the visitor never picked a theme themselves
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
    try {
      if (localStorage.getItem('theme')) return;
    } catch (err) { /* fall through and follow the OS */ }
    root.setAttribute('data-theme', e.matches ? 'light' : 'dark');
  });


  /* ─── Mobile nav ─────────────────────────────────────────────────── */

  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');

  function closeNav() {
    if (!navLinks) return;
    navLinks.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
  }

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });

    // Close after tapping a link, and on Escape
    navLinks.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeNav();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('is-open')) {
        closeNav();
        navToggle.focus();
      }
    });
  }


  /* ─── Nav border once you scroll off the hero ─────────────────────── */

  var nav = document.getElementById('nav');

  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('is-stuck', window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }


  /* ─── Scroll reveal ──────────────────────────────────────────────── */

  var revealables = document.querySelectorAll('.reveal');

  if (reduceMotion || !('IntersectionObserver' in window)) {
    // No animation wanted (or no support) — just show everything
    revealables.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target); // reveal once, then stop watching
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    revealables.forEach(function (el) { revealObserver.observe(el); });
  }


  /* ─── Project tag filter ─────────────────────────────────────────────
     Reads data-tags on each .card and matches it against the clicked
     pill's data-filter. Add a new category by adding a pill in the HTML
     and putting the same word in a card's data-tags.                   */

  var filters = document.getElementById('filters');
  var cards = Array.prototype.slice.call(document.querySelectorAll('#project-grid .card'));
  var emptyMsg = document.getElementById('grid-empty');

  if (filters && cards.length) {
    filters.addEventListener('click', function (e) {
      var btn = e.target.closest('.pill');
      if (!btn) return;

      var filter = btn.dataset.filter;

      filters.querySelectorAll('.pill').forEach(function (p) {
        p.classList.toggle('is-active', p === btn);
      });

      var shown = 0;
      cards.forEach(function (card) {
        var tags = (card.dataset.tags || '').split(/\s+/);
        var match = filter === 'all' || tags.indexOf(filter) !== -1;
        card.hidden = !match;
        if (match) shown++;
      });

      if (emptyMsg) emptyMsg.hidden = shown > 0;
    });
  }


  /* ─── Scrollspy: highlight the nav link for the section you're in ─── */

  var sections = document.querySelectorAll('main section[id]');

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        document.querySelectorAll('.nav__links a').forEach(function (link) {
          link.classList.toggle('is-current', link.getAttribute('href') === '#' + id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });

    sections.forEach(function (s) { spy.observe(s); });
  }


  /* ─── Footer year ────────────────────────────────────────────────── */

  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

})();
