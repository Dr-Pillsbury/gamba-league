const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});
const timestamp = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
export const money = (cents: number) => currency.format(cents / 100);
export const date = (ms: number) =>
  Number.isFinite(ms) ? timestamp.format(new Date(ms)) : 'Time unavailable';
