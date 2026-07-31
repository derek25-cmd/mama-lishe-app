// Tanzanian mobile numbers: +255 followed by 9 digits, first of those 9
// being 6 or 7 (Vodacom/Tigo/Airtel/Halotel all issue under 6xx/7xx ranges).
const TZ_E164 = /^\+255[67]\d{8}$/;

// Accepts +255743123456, 255743123456, or the common local form 0743123456
// and normalizes to strict E.164. Returns null for anything that doesn't
// resolve to a valid Tanzanian mobile number.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim().replace(/[\s-]/g, "");
  let candidate: string;
  if (trimmed.startsWith("+255")) {
    candidate = trimmed;
  } else if (trimmed.startsWith("255")) {
    candidate = "+" + trimmed;
  } else if (trimmed.startsWith("0")) {
    candidate = "+255" + trimmed.slice(1);
  } else {
    return null;
  }
  return TZ_E164.test(candidate) ? candidate : null;
}

// +255743123456 -> +2557***456. Used everywhere a phone number might
// otherwise land in a log line.
export function maskPhone(phone: string): string {
  if (phone.length < 8) return "***";
  return phone.slice(0, 5) + "***" + phone.slice(-3);
}
