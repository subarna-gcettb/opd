(function () {
  'use strict';

  var advice = document.querySelector('form[action^="/doctor/consultation/"] textarea[name="investigationAdvice"]');
  if (!advice) return;

  var finalized = advice.readOnly || advice.disabled;
  var commonTests = [
    'CBC (Complete Blood Count)',
    'ESR',
    'CRP',
    'Blood Sugar - Fasting',
    'Blood Sugar - PP',
    'HbA1c',
    'LFT (Liver Function Test)',
    'KFT / RFT (Kidney Function Test)',
    'Lipid Profile',
    'Thyroid Profile (T3, T4, TSH)',
    'Urine Routine & Microscopy',
    'Urine Culture & Sensitivity',
    'Stool Routine Examination',
    'Serum Electrolytes',
    'Serum Uric Acid',
    'Vitamin B12',
    'Vitamin D',
    'ECG',
    'Chest X-Ray',
    'USG Whole Abdomen',
    'USG Pelvis',
    'Pregnancy Test (UPT)'
  ];

  var originalText = String(advice.value || '').trim();
  var selected = [];

  function normalize(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function containsIgnoreCase(list, value) {
    var needle = normalize(value).toLowerCase();
    return list.some(function (item) { return normalize(item).toLowerCase() === needle; });
  }

  // Existing comma/semicolon/newline-separated advice is restored as checked
  // tests so previously saved consultations remain editable without data loss.
  originalText.split(/[\n;,]+/).map(normalize).filter(Boolean).forEach(function (item) {
    if (!containsIgnoreCase(selected, item)) selected.push(item);
  });

  var section = document.createElement('div');
  section.className = 'card border-info-subtle mt-3 mb-3';
  section.innerHTML =
    '<div class="card-header d-flex justify-content-between align-items-center gap-2">' +
      '<span><i class="bi bi-clipboard2-pulse me-1"></i><strong>Diagnostic Tests</strong></span>' +
      '<span class="badge text-bg-light border" id="diagnosticTestCount">0 selected</span>' +
    '</div>' +
    '<div class="card-body">' +
      '<div class="small text-muted mb-3">Select the investigations required for this patient. You can also add a test that is not in the list.</div>' +
      '<div id="diagnosticTestList" class="row g-2"></div>' +
      (finalized ? '' :
        '<div class="input-group input-group-sm mt-3">' +
          '<input type="text" id="newDiagnosticTest" class="form-control" placeholder="Add new diagnostic test name" autocomplete="off">' +
          '<button type="button" class="btn btn-outline-info" id="addDiagnosticTest"><i class="bi bi-plus-lg"></i> Add Test</button>' +
        '</div>') +
    '</div>';

  advice.closest('.col-md-8')?.insertAdjacentElement('beforebegin', section);
  section.classList.add('col-12');

  var list = section.querySelector('#diagnosticTestList');
  var count = section.querySelector('#diagnosticTestCount');
  var customTests = selected.filter(function (item) { return !containsIgnoreCase(commonTests, item); });
  var tests = commonTests.slice();
  customTests.forEach(function (item) {
    if (!containsIgnoreCase(tests, item)) tests.push(item);
  });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char];
    });
  }

  function syncAdvice() {
    selected = Array.from(list.querySelectorAll('.diagnostic-test-check:checked')).map(function (box) {
      return box.value;
    });
    advice.value = selected.join('\n');
    count.textContent = selected.length + ' selected';
  }

  function render() {
    list.innerHTML = tests.map(function (test, index) {
      var checked = containsIgnoreCase(selected, test);
      var id = 'diagnosticTest_' + index;
      return '<div class="col-12 col-md-6">' +
        '<div class="form-check border rounded px-3 py-2 h-100 bg-light-subtle">' +
          '<input class="form-check-input diagnostic-test-check" type="checkbox" id="' + id + '" value="' + escapeHtml(test) + '" ' + (checked ? 'checked ' : '') + (finalized ? 'disabled' : '') + '>' +
          '<label class="form-check-label w-100" for="' + id + '">' + escapeHtml(test) + '</label>' +
        '</div>' +
      '</div>';
    }).join('');
    syncAdvice();
  }

  list.addEventListener('change', function (event) {
    if (event.target.classList.contains('diagnostic-test-check')) syncAdvice();
  });

  var input = section.querySelector('#newDiagnosticTest');
  var addButton = section.querySelector('#addDiagnosticTest');

  function addTest() {
    if (!input) return;
    var name = normalize(input.value);
    if (!name) return;
    if (!containsIgnoreCase(tests, name)) tests.push(name);
    if (!containsIgnoreCase(selected, name)) selected.push(name);
    input.value = '';
    render();
    var boxes = list.querySelectorAll('.diagnostic-test-check');
    if (boxes.length) boxes[boxes.length - 1].scrollIntoView({ block: 'nearest' });
  }

  if (addButton) addButton.addEventListener('click', addTest);
  if (input) input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTest();
    }
  });

  render();
})();
