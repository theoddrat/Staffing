/** Walk any value and collect paths of non-finite numbers / undefined. */
export function badNumbers(x: unknown, path = '$', out: string[] = []): string[] {
  if (x === undefined) out.push(`${path}=undefined`);
  else if (typeof x === 'number' && !Number.isFinite(x)) out.push(`${path}=${x}`);
  else if (Array.isArray(x)) x.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) badNumbers(v, `${path}.${k}`, out);
  return out;
}
