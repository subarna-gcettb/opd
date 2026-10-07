const FREQUENCY = {
  OD: { en: 'once daily', bn: 'দিনে 01 বার' },
  BD: { en: 'twice daily', bn: 'দিনে 02 বার' },
  TDS: { en: 'three times daily', bn: 'দিনে 03 বার' },
  QDS: { en: 'four times daily', bn: 'দিনে 04 বার' },
  SOS: { en: 'as needed', bn: 'প্রয়োজনে' }
};
const ROUTE = {
  'P/O': { en: 'by mouth', bn: 'মুখে' }, 'P/V': { en: 'by vaginal route', bn: 'যোনিপথে' },
  'S/L': { en: 'under the tongue', bn: 'জিহ্বার নিচে' }, PR: { en: 'by rectal route', bn: 'মলদ্বার দিয়ে' },
  'I/V': { en: 'intravenously', bn: 'শিরায়' }, 'I/M': { en: 'intramuscularly', bn: 'পেশিতে' },
  'S/C': { en: 'subcutaneously', bn: 'চামড়ার নিচে' }, TOPICAL: { en: 'topically', bn: 'ত্বকে প্রয়োগ' }
};
const FORM = {
  tablet: { en: 'tablet', bn: 'ট্যাবলেট' }, capsule: { en: 'capsule', bn: 'ক্যাপসুল' },
  syrup: { en: 'syrup', bn: 'সিরাপ' }, injection: { en: 'injection', bn: 'ইনজেকশন' },
  drops: { en: 'drops', bn: 'ড্রপ' }, cream: { en: 'cream', bn: 'ক্রিম' },
  ointment: { en: 'ointment', bn: 'মলম' }, suspension: { en: 'suspension', bn: 'সাসপেনশন' },
  inhaler: { en: 'inhaler', bn: 'ইনহেলার' }
};
function normalizeKey(value) { return String(value || '').trim().toUpperCase(); }
function numberWord(n) { return ({1:'one',2:'two',3:'three',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten'}[Number(n)] || String(n)); }
function bengaliNumber(n) { return ({1:'১',2:'২',3:'৩',4:'৪',5:'৫',6:'৬',7:'৭',8:'৮',9:'৯',10:'১০'}[Number(n)] || String(n)); }
function describeItem(item) {
  const formKey = String(item.medicine_form || '').trim().toLowerCase();
  const form = FORM[formKey] || { en: formKey || 'medicine', bn: formKey || 'ওষুধ' };
  const dose = String(item.dosage || '').trim() || '1';
  const frequencyKey = normalizeKey(item.frequency).split(/[,\s]+/)[0];
  const frequency = FREQUENCY[frequencyKey] || { en: String(item.frequency || '').trim(), bn: String(item.frequency || '').trim() };
  const routeKey = normalizeKey(item.route);
  const route = ROUTE[routeKey] || { en: String(item.route || '').trim(), bn: String(item.route || '').trim() };
  const rawDuration = String(item.duration || '').trim();
  const duration = /^\d+(\.\d+)?$/.test(rawDuration) ? rawDuration + ' days' : rawDuration;
  const instructions = String(item.instructions || '').trim();
  const food = /before food|before meal|a\/c|\bac\b/i.test(instructions) ? { en: 'before food', bn: 'খাবারের আগে' } : /after food|after meal|p\/c|\bpc\b/i.test(instructions) ? { en: 'after food', bn: 'খাবারের পরে' } : /with food/i.test(instructions) ? { en: 'with food', bn: 'খাবারের সঙ্গে' } : null;
  const doseText = /^\d+(\.\d+)?$/.test(dose) ? numberWord(dose) : dose;
  const english = ('Take ' + doseText + ' ' + form.en + (route.en ? ' ' + route.en : '') + ' ' + frequency.en + (duration ? ' for ' + duration : '') + (food ? ' ' + food.en : '') + '.').replace(/\s+/g, ' ').trim();
  const bnDuration = rawDuration && /^\d+(\.\d+)?$/.test(rawDuration) ? ' ' + rawDuration + ' দিন' : (duration ? ' ' + duration : '');
  const bengali = (bengaliNumber(dose) + ' ' + form.bn + (route.bn ? ' ' + route.bn : '') + ', ' + frequency.bn + bnDuration + (food ? ', ' + food.bn : '') + '।').replace(/\s+/g, ' ').trim();
  return { english, bengali };
}
function buildPrescriptionInstructions(item) {
  const described = describeItem(item);
  const composition = String(item.composition || '').trim();
  const name = String(item.medicine_name_freetext || '').trim();
  const heading = composition ? name + ' [' + composition + ']' : name;
  return { heading, english: heading + ' — ' + described.english, bengali: described.bengali };
}
module.exports = { buildPrescriptionInstructions, describeItem };