/** Money is integer paise end to end (see @nraialgo/contracts); this is the
 * only place it becomes a display string, so there is exactly one rounding
 * and one currency-symbol decision to audit. */
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  return `${sign}₹${Math.abs(rupees).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "medium",
  });
}
