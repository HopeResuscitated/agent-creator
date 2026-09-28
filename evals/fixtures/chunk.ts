// Split an array into consecutive groups of `size`.
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < items.length - size; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
