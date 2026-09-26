'use strict';

/**
 * Pregnancy calculations based on LMP.
 * These are screening/record calculations for clinical workflow, not a diagnosis.
 * Calendar arithmetic is performed using local calendar components to avoid UTC
 * date-shift errors in browsers/server environments.
 */
function parseDateOnly(value) {
  if (!value) return null;
  const m = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (date.getFullYear() !== Number(m[1]) || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function addDays(date, days) {
  const out = new Date(date.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

function calculatePregnancy(lmpValue, asOf = new Date()) {
  const lmp = parseDateOnly(lmpValue);
  if (!lmp) return null;

  const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  today.setHours(0, 0, 0, 0);

  const elapsedDays = Math.floor((today.getTime() - lmp.getTime()) / 86400000);
  if (elapsedDays < 0) return null;

  const totalDays = 280;
  const weeks = Math.floor(elapsedDays / 7);
  const days = elapsedDays % 7;
  const edd = addDays(lmp, totalDays);
  const remainingDays = Math.max(0, totalDays - elapsedDays);
  const trimester = weeks < 14 ? 'First trimester' : (weeks < 28 ? 'Second trimester' : 'Third trimester');

  return {
    lmpDate: formatDateOnly(lmp),
    gestationalAgeWeeks: weeks,
    gestationalAgeDays: days,
    gestationalAgeLabel: weeks + ' weeks ' + days + ' days',
    estimatedDueDate: formatDateOnly(edd),
    remainingDays,
    remainingWeeks: Math.floor(remainingDays / 7),
    remainingExtraDays: remainingDays % 7,
    trimester,
    termStatus: elapsedDays > totalDays ? 'Past estimated due date' : 'Within estimated pregnancy period'
  };
}

module.exports = { parseDateOnly, formatDateOnly, calculatePregnancy };
