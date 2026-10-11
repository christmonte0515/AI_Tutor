export function fmt(sqlTime) {
  if (!sqlTime) return 'Never';
  return new Date(`${sqlTime.replace(' ', 'T')}Z`).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
