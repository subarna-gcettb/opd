// PWA: register the service worker (progressive enhancement — silently
// does nothing in browsers/contexts that don't support it).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/service-worker.js').catch(function () {});
  });
}

// Mobile off-canvas sidebar toggle.
(function () {
  const sidebar = document.querySelector('.hms-sidebar');
  const toggle = document.getElementById('sidebarToggle');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar || !toggle || !backdrop) return;

  function openSidebar() {
    sidebar.classList.add('is-open');
    backdrop.classList.add('is-open');
  }
  function closeSidebar() {
    sidebar.classList.remove('is-open');
    backdrop.classList.remove('is-open');
  }
  toggle.addEventListener('click', openSidebar);
  backdrop.addEventListener('click', closeSidebar);
  // Close automatically when a nav link is tapped (mobile UX).
  sidebar.querySelectorAll('.nav-link').forEach(function (link) {
    link.addEventListener('click', closeSidebar);
  });
})();

// Confirmation dialogs for destructive/important actions.
// Usage: <form data-confirm="Cancel this appointment?">
document.addEventListener('submit', function (e) {
  const form = e.target;
  if (form.dataset && form.dataset.confirm) {
    if (!window.confirm(form.dataset.confirm)) {
      e.preventDefault();
    }
  }
});

// Debounced live search inputs. Usage: <input data-live-search="/patients/search/results">
document.querySelectorAll('[data-live-search]').forEach(function (input) {
  let timer = null;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    const url = input.getAttribute('data-live-search');
    const targetSel = input.getAttribute('data-target');
    const target = targetSel ? document.querySelector(targetSel) : null;
    timer = setTimeout(function () {
      const q = input.value.trim();
      if (!target) return;
      if (q.length < 2) { target.innerHTML = ''; return; }
      fetch(url + '?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
        .then((r) => r.json())
        .then((data) => {
          target.dispatchEvent(new CustomEvent('results', { detail: data }));
        })
        .catch(() => {});
    }, 300);
  });
});

// Auto-dismiss alerts after a few seconds.
document.querySelectorAll('.alert-success').forEach(function (el) {
  setTimeout(function () {
    const alert = bootstrap.Alert.getOrCreateInstance(el);
    alert.close();
  }, 5000);
});
