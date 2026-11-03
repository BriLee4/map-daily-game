// Students have no accounts: a random per-browser key lets them rejoin after a refresh.
function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: key only lives for this tab */
  }
}

let memoryKey: string | null = null;
export function playerKey(): string {
  let k = safeGet("gg-key") ?? memoryKey;
  if (!k) {
    k = crypto.randomUUID();
    memoryKey = k;
    safeSet("gg-key", k);
  }
  return k;
}
export const lastName = () => safeGet("gg-name") ?? "";
export const rememberName = (n: string) => safeSet("gg-name", n);
