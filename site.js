'use strict';

/* =========================================================
   SQUISH — site.js
   Shared chrome behavior used on every page: theme toggle,
   mobile nav, button ripple, scroll-reveal, footer year.
   Include on every page. Safe to run without the compressor tool.
   ========================================================= */

(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ----------------------------- Theme toggle ----------------------------- */
  const themeToggle = $('#themeToggle');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggle) {
      themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }
    try { localStorage.setItem('squish-theme', theme); } catch (e) { /* storage unavailable */ }
  }

  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('squish-theme'); } catch (e) { /* ignore */ }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  })();

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  /* ----------------------------- Mobile nav ----------------------------- */
  const navToggle = $('#navToggle');
  const mainNav = $('#mainNav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const open = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    $$('.main-nav a').forEach((a) => a.addEventListener('click', () => {
      mainNav.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    }));
  }

  /* ----------------------------- Ripple buttons ----------------------------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.ripple');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    btn.style.setProperty('--rx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
    btn.style.setProperty('--ry', `${((e.clientY - rect.top) / rect.height) * 100}%`);
  });

  /* ----------------------------- Scroll reveal ----------------------------- */
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.animationPlayState = 'running';
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    window.squishObserveReveal = function observeReveal(root) {
      Array.from((root || document).querySelectorAll('.fade-up, .scale-in')).forEach((el) => {
        el.style.animationPlayState = 'paused';
        revealObserver.observe(el);
      });
    };
    window.squishObserveReveal();
  } else {
    window.squishObserveReveal = function () {};
  }

  /* ----------------------------- Footer year ----------------------------- */
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
})();