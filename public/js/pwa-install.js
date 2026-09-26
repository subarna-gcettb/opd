(function () {
  'use strict';

  var deferredPrompt = null;
  var buttons = [
    document.getElementById('pwaInstallNav'),
    document.getElementById('pwaInstallHero'),
    document.getElementById('pwaInstallMobile')
  ].filter(Boolean);

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function hideButtons() {
    buttons.forEach(function (button) { button.hidden = true; });
  }

  function showButtons() {
    if (isStandalone()) {
      hideButtons();
      return;
    }
    buttons.forEach(function (button) { button.hidden = false; });
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    showButtons();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hideButtons();
  });

  buttons.forEach(function (button) {
    button.addEventListener('click', async function () {
      if (!deferredPrompt) return;

      try {
        var choice = await deferredPrompt.prompt();
        if (choice && choice.outcome === 'accepted') hideButtons();
      } catch (error) {
        // The browser controls whether installation is available.
      } finally {
        deferredPrompt = null;
      }
    });
  });

  if (isStandalone()) hideButtons();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();