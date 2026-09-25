const scheduleService = require('../../services/scheduleService');

describe('scheduleService time helpers', () => {
  test('toMinutes converts HH:MM to minutes since midnight', () => {
    expect(scheduleService.toMinutes('00:00')).toBe(0);
    expect(scheduleService.toMinutes('09:30')).toBe(570);
    expect(scheduleService.toMinutes('23:45')).toBe(1425);
  });

  test('toTimeString converts minutes back to a zero-padded HH:MM:SS string', () => {
    expect(scheduleService.toTimeString(0)).toBe('00:00:00');
    expect(scheduleService.toTimeString(570)).toBe('09:30:00');
    expect(scheduleService.toTimeString(1425)).toBe('23:45:00');
  });

  test('toMinutes and toTimeString round-trip', () => {
    ['09:00', '13:15', '17:45'].forEach((t) => {
      expect(scheduleService.toTimeString(scheduleService.toMinutes(t)).slice(0, 5)).toBe(t);
    });
  });
});
