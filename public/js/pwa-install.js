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
    if (now) now.onclick = function () { prompt.hidden = true; };
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
        if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()) {
          showIosInstructions();
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
