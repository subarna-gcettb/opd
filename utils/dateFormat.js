function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDate(value) {
  if (value == null || value === '') return '—';
  const raw = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = dateOnly ? new Date(raw + 'T00:00:00') : new Date(value);
  if (Number.isNaN(date.getTime())) return raw;
  return pad(date.getDate()) + '-' + pad(date.getMonth() + 1) + '-' + date.getFullYear();
}

function formatDateTime(value) {
  if (value == null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return formatDate(value) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

module.exports = { formatDate, formatDateTime };
