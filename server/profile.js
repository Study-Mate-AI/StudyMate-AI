// Editable profile fields (Settings → Profile). Email isn't here: it's the login and stays fixed.
const TEXT = { name: 80, college: 120, course: 80, year: 30 };

// Validates a profile edit. Returns { profile } with trimmed values (empty = removed), or { error }.
export function cleanProfile(body = {}, today = new Date()) {
  const profile = {};
  for (const [k, max] of Object.entries(TEXT)) {
    const v = typeof body[k] === 'string' ? body[k].trim().replace(/\s+/g, ' ') : '';
    if (v.length > max) return { error: `${k[0].toUpperCase() + k.slice(1)} is too long (max ${max} characters)` };
    if (v) profile[k] = v;
  }
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (phone) {
    if (!/^\+?[\d\s-]{7,20}$/.test(phone) || phone.replace(/\D/g, '').length < 7) return { error: 'Enter a valid phone number' };
    profile.phone = phone;
  }
  const dob = typeof body.birthDate === 'string' ? body.birthDate.trim() : '';
  if (dob) {
    const d = new Date(dob + 'T00:00:00Z');
    // Real calendar date (rejects 2001-02-30), in the past, and a plausible student age (5–100).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(d) || d.toISOString().slice(0, 10) !== dob) return { error: 'Enter a valid date of birth' };
    const age = (today - d) / (365.25 * 864e5);
    if (age < 5 || age > 100) return { error: 'Enter a valid date of birth' };
    profile.birthDate = dob;
  }
  return { profile };
}
