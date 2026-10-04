const PREFIX = "squatQuest.";

export function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

// localStorage can be missing or throw (private windows, blocked site data),
// so fall back to an in-memory store that simply doesn't persist.
function defaultBackend() {
  try {
    const ls = globalThis.localStorage;
    const probe = `${PREFIX}__probe`;
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryBackend();
  }
}

export function createStore(backend = defaultBackend()) {
  return {
    get(key, fallback) {
      try {
        const raw = backend.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        backend.setItem(PREFIX + key, JSON.stringify(value));
      } catch {
        // Quota exceeded or storage blocked — progress just won't persist.
      }
    },
  };
}
