const { pool } = require('../config/database');

/**
 * Availability is computed ON DEMAND from:
 *   doctor_schedule_templates (recurring weekly pattern)
 *   MINUS doctor_schedule_exceptions (leave / holiday / changed hours)
 *   MINUS already-booked appointments (capacity per slot)
 *
 * No permanent slot rows are ever materialized.
 */

function toMinutes(timeStr) {
  const [h, m] = String(timeStr).split(':').map(Number);
  return h * 60 + m;
}

function toTimeString(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * @param {number} doctorId
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {Promise<Array<{time: string, label: string, capacity: number, booked: number, available: number}>>}
 */
async function getAvailableSlots(doctorId, dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return [];
  const weekday = date.getDay(); // 0=Sunday

  // 1. Exception for this date?
  const [[exception]] = await pool.execute(
    'SELECT * FROM doctor_schedule_exceptions WHERE doctor_id = :doctorId AND exception_date = :date LIMIT 1',
    { doctorId, date: dateStr }
  );

  if (exception && exception.is_unavailable) {
    return []; // doctor on leave / holiday
  }

  // 2. Base working windows for this weekday
  const [templates] = await pool.execute(
    `SELECT start_time, end_time, slot_duration_minutes, max_patients_per_slot
     FROM doctor_schedule_templates
     WHERE doctor_id = :doctorId AND weekday = :weekday AND is_active = 1
     ORDER BY start_time`,
    { doctorId, weekday }
  );

  let windows = templates;

  // An exception with is_unavailable = 0 and explicit times means a
  // special working day / changed hours, overriding the template.
  if (exception && !exception.is_unavailable && exception.start_time && exception.end_time) {
    const base = templates[0] || { slot_duration_minutes: 15, max_patients_per_slot: 1 };
    windows = [
      {
        start_time: exception.start_time,
        end_time: exception.end_time,
        slot_duration_minutes: base.slot_duration_minutes,
        max_patients_per_slot: base.max_patients_per_slot
      }
    ];
  }

  if (!windows.length) return [];

  // 3. Existing bookings on this date (cancelled/rescheduled don't hold capacity)
  const [booked] = await pool.execute(
    `SELECT slot_time, COUNT(*) AS cnt
     FROM appointments
     WHERE doctor_id = :doctorId AND appointment_date = :date
       AND status IN ('BOOKED','COMPLETED')
     GROUP BY slot_time`,
    { doctorId, date: dateStr }
  );
  const bookedMap = new Map(booked.map((b) => [String(b.slot_time), Number(b.cnt)]));

  // 4. Expand windows into slots
  const slots = [];
  for (const w of windows) {
    const start = toMinutes(w.start_time);
    const end = toMinutes(w.end_time);
    const step = w.slot_duration_minutes || 15;
    const capacity = w.max_patients_per_slot || 1;

    for (let t = start; t + step <= end; t += step) {
      const timeStr = toTimeString(t);
      const bookedCount = bookedMap.get(timeStr) || 0;
      slots.push({
        time: timeStr,
        label: timeStr.slice(0, 5),
        capacity,
        booked: bookedCount,
        available: Math.max(0, capacity - bookedCount)
      });
    }
  }

  return slots;
}

/**
 * Server-side authority check used inside the booking transaction.
 * Throws nothing — returns a boolean the caller acts on.
 */
async function isSlotBookable(conn, doctorId, dateStr, slotTime) {
  const date = new Date(`${dateStr}T00:00:00`);
  const weekday = date.getDay();

  const [[exception]] = await conn.execute(
    'SELECT is_unavailable, start_time, end_time FROM doctor_schedule_exceptions WHERE doctor_id = :doctorId AND exception_date = :date LIMIT 1',
    { doctorId, date: dateStr }
  );
  if (exception && exception.is_unavailable) return { ok: false, reason: 'Doctor is unavailable on this date' };

  const [templates] = await conn.execute(
    `SELECT start_time, end_time, slot_duration_minutes, max_patients_per_slot
     FROM doctor_schedule_templates
     WHERE doctor_id = :doctorId AND weekday = :weekday AND is_active = 1`,
    { doctorId, weekday }
  );
  if (!templates.length && !(exception && exception.start_time)) {
    return { ok: false, reason: 'Doctor does not hold OPD on this day' };
  }

  let windows = templates;
  if (exception && !exception.is_unavailable && exception.start_time && exception.end_time) {
    const base = templates[0] || { slot_duration_minutes: 15, max_patients_per_slot: 1 };
    windows = [{
      start_time: exception.start_time,
      end_time: exception.end_time,
      slot_duration_minutes: base.slot_duration_minutes,
      max_patients_per_slot: base.max_patients_per_slot
    }];
  }

  const requestedMinutes = toMinutes(slotTime);
  const matchingWindow = windows.find((w) => {
    const start = toMinutes(w.start_time);
    const end = toMinutes(w.end_time);
    const step = w.slot_duration_minutes || 15;
    return requestedMinutes >= start && requestedMinutes + step <= end &&
      ((requestedMinutes - start) % step === 0);
  });
  if (!matchingWindow) {
    return { ok: false, reason: 'The selected time is not an available slot for this doctor' };
  }

  const capacity = matchingWindow.max_patients_per_slot || 1;

  // Lock the existing appointments for this doctor/date/slot so two
  // concurrent bookings cannot both see capacity as available.
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM appointments
     WHERE doctor_id = :doctorId AND appointment_date = :date AND slot_time = :slotTime
       AND status IN ('BOOKED','COMPLETED')
     FOR UPDATE`,
    { doctorId, date: dateStr, slotTime }
  );

  if (Number(rows[0].cnt) >= capacity) {
    return { ok: false, reason: 'This time slot is already fully booked' };
  }
  return { ok: true };
}

/** Returns calendar dates on which a doctor has at least one bookable slot. */
async function getAvailableDates(doctorId, fromDateStr, days = 90) {
  const start = new Date(`${fromDateStr}T00:00:00`);
  if (Number.isNaN(start.getTime())) return [];
  const safeDays = Math.min(180, Math.max(1, Number.parseInt(days, 10) || 90));
  const end = new Date(start);
  end.setDate(start.getDate() + safeDays - 1);
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);

  const [templates] = await pool.execute(
    `SELECT weekday, start_time, end_time, slot_duration_minutes, max_patients_per_slot
     FROM doctor_schedule_templates
     WHERE doctor_id = :doctorId AND is_active = 1
     ORDER BY weekday, start_time`,
    { doctorId }
  );

  const [exceptions] = await pool.execute(
    `SELECT exception_date, is_unavailable, start_time, end_time
     FROM doctor_schedule_exceptions
     WHERE doctor_id = :doctorId AND exception_date BETWEEN :from AND :to`,
    { doctorId, from, to }
  );
  const exceptionMap = new Map(exceptions.map((e) => [String(e.exception_date), e]));

  const [booked] = await pool.execute(
    `SELECT appointment_date, slot_time, COUNT(*) AS cnt
     FROM appointments
     WHERE doctor_id = :doctorId
       AND appointment_date BETWEEN :from AND :to
       AND status IN ('BOOKED','COMPLETED')
     GROUP BY appointment_date, slot_time`,
    { doctorId, from, to }
  );
  const bookedMap = new Map(
    booked.map((b) => [`${String(b.appointment_date)}|${String(b.slot_time)}`, Number(b.cnt)])
  );

  const dates = [];
  for (let i = 0; i < safeDays; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    const weekday = date.getDay();
    const exception = exceptionMap.get(dateStr);

    if (exception && exception.is_unavailable) continue;

    let windows = templates.filter((t) => Number(t.weekday) === weekday);
    if (exception && !exception.is_unavailable && exception.start_time && exception.end_time) {
      const base = windows[0] || { slot_duration_minutes: 15, max_patients_per_slot: 1 };
      windows = [{
        start_time: exception.start_time,
        end_time: exception.end_time,
        slot_duration_minutes: base.slot_duration_minutes,
        max_patients_per_slot: base.max_patients_per_slot
      }];
    }

    let available = false;
    for (const w of windows) {
      const startMinutes = toMinutes(w.start_time);
      const endMinutes = toMinutes(w.end_time);
      const step = w.slot_duration_minutes || 15;
      const capacity = w.max_patients_per_slot || 1;
      for (let t = startMinutes; t + step <= endMinutes; t += step) {
        const slot = toTimeString(t);
        const count = bookedMap.get(`${dateStr}|${slot}`) || 0;
        if (count < capacity) {
          available = true;
          break;
        }
      }
      if (available) break;
    }
    if (available) dates.push(dateStr);
  }

  return dates;
}

module.exports = { getAvailableSlots, getAvailableDates, isSlotBookable, toMinutes, toTimeString };
