const store = new Map();

export function cached(key, ttlMs, fetcher) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    return Promise.resolve({ ...hit.value, cached: true });
  }
  return fetcher().then((value) => {
    store.set(key, { at: Date.now(), value });
    return { ...value, cached: false };
  });
}
