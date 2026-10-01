(function () {
  'use strict';

  function fitPrescription() {
    var body = document.body;
    var sheet = document.querySelector('.print-sheet');
    if (!body || !sheet || !body.classList.contains('single-a4-print')) return;

    sheet.style.transform = 'none';
    var pageHeight = 297 - 24;
    var pageWidth = 210 - 24;
    var naturalHeight = sheet.scrollHeight;
    var naturalWidth = sheet.scrollWidth;
    if (!naturalHeight || !naturalWidth) return;

    var scale = Math.min(1, pageHeight / naturalHeight, pageWidth / naturalWidth);
    scale = Math.max(0.05, scale);
    sheet.style.transformOrigin = 'top left';
    sheet.style.transform = 'scale(' + scale + ')';
  }

  function printPage() {
    if (document.body && document.body.classList.contains('single-a4-print')) fitPrescription();
    window.requestAnimationFrame(function () {
      window.focus();
      window.print();
    });
  }

  function closePage() {
    if (window.opener && !window.opener.closed) {
      try { window.close(); } catch (_) {}
    }
    if (!window.closed) {
      var referrer = document.referrer;
      if (referrer && referrer.indexOf(window.location.origin) === 0) {
        window.location.assign(referrer);
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.assign('/');
      }
    }
  }

  function init() {
    if (document.body) document.body.classList.add('print-doc');

    document.querySelectorAll('[data-print-action="print"]').forEach(function (button) {
      button.type = 'button';
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        printPage();
      });
    });

    document.querySelectorAll('[data-print-action="close"]').forEach(function (button) {
      button.type = 'button';
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        closePage();
      });
    });

    if (document.body && document.body.classList.contains('single-a4-print')) fitPrescription();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.addEventListener('beforeprint', fitPrescription);
})();