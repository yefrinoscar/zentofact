/** Fecha (YYYY-MM-DD, hora de Lima, UTC-5) de hace `days` días. */
export function limaDateDaysAgo(days: number, now: Date = new Date()): string {
  const lima = new Date(now.getTime() - 5 * 3600 * 1000);
  lima.setUTCDate(lima.getUTCDate() - days);
  return lima.toISOString().slice(0, 10);
}
