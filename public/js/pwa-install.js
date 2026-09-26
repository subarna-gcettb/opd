(function () {
  'use strict';

  var deferredPrompt = null;
  var installButtons = [
    document.getElementById('pwaInstallNow'),
    document.getElementById('pwaInstallHero'),
    document.getElementById('pwaInstallNav')
  ].filter(Boolean);
  var prompt = document.getElementById('pwaInstallPrompt');
  var later = document.getElementById('pwaInstallLater');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function showInstallUi() {
    if (isStandalone()) return;
    installButtons.forEach(function (button) { button.hidden = false; });
    if (prompt) prompt.hidden = false;
  }

  function hideInstallUi() {
    installButtons.forEach(function (button) { button.hidden = true; });
    if (prompt) prompt.hidden = true;
  }

  function showIosInstructions() {
    if (!prompt) return;
    var text = document.getElementById('pwaInstallText');
    var title = document.getElementById('pwaInstallTitle');
    var now = document.getElementById('pwaInstallNow');
    if (title) title.textContent = 'Add Chhayabithi to your home screen';
    if (text) text.textContent = 'On iPhone or iPad, open this site in Safari, tap Share, then choose “Add to Home Screen”.';
    if (now) now.textContent = 'Got it';
    prompt.hidden = false;
    if (now) now.textContent = 'Close';
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    showInstallUi();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hideInstallUi();
  });

  installButtons.forEach(function (button) {
    button.addEventListener('click', async function () {
      if (!deferredPrompt) {
        if (this.dataset.closeOnly === 'true') { if (prompt) prompt.hidden = true; this.dataset.closeOnly = 'false'; return; }
        if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()) {
          showIosInstructions();
        } else {
          var title = document.getElementById('pwaInstallTitle');
          var text = document.getElementById('pwaInstallText');
          var now = document.getElementById('pwaInstallNow');
          if (title) title.textContent = 'Install from your browser menu';
          if (text) text.textContent = 'Open your browser menu and choose “Install app” or “Add to Home screen”.';
          if (now) now.textContent = 'Close';
          if (now) now.dataset.closeOnly = 'true';
        }
        return;
      }
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      if (choice && choice.outcome === 'accepted') hideInstallUi();
      deferredPrompt = null;
    });
  });

  if (later) {
    later.addEventListener('click', function () {
      if (prompt) prompt.hidden = true;
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()) {
      window.setTimeout(showIosInstructions, 1800);
    }
  });

  if (!isStandalone() && !deferredPrompt) {
    window.setTimeout(function () {
      if (isStandalone() || deferredPrompt) return;
      var title = document.getElementById('pwaInstallTitle');
      var text = document.getElementById('pwaInstallText');
      var now = document.getElementById('pwaInstallNow');
      if (title) title.textContent = 'Use Chhayabithi like an app';
      if (text) text.textContent = 'Add Chhayabithi to your home screen for quick access to appointments, your patient portal and Live OPD.';
      if (now) now.textContent = 'How to install';
      if (prompt) prompt.hidden = false;
    }, 1800);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
