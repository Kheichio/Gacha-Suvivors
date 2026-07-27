// Pluggable storage backend. DECISIONS.md §23.
//
// The game only ever calls read/write/remove. Which backend answers is decided
// once at boot:
//
//   localStorage  browser default
//   fs            Electron/Node — writes a real file under userData, so Steam
//                 Auto-Cloud can sync it
//   indexeddb     iOS, where Safari ITP can evict localStorage after ~7 days
//   memory        headless harness and tests
//
// Retrofitting this later is miserable; it costs ~30 lines now.

import { IS_BROWSER } from './config.js';

const memoryStore = new Map();

const memoryBackend = {
  name: 'memory',
  read(key) { return memoryStore.has(key) ? memoryStore.get(key) : null; },
  write(key, value) { memoryStore.set(key, value); return true; },
  remove(key) { memoryStore.delete(key); },
  available() { return true; },
};

const localStorageBackend = {
  name: 'localStorage',
  read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  },
  write(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (e) { return false; } // quota / private mode — caller falls back
  },
  remove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  },
  available() {
    try {
      const k = '__gs_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  },
};

/**
 * Node/Electron. Loaded lazily and defensively so a browser bundle never even
 * evaluates the require.
 */
function makeFsBackend() {
  let fs, path, dir;
  try {
    // eslint-disable-next-line no-undef
    const req = typeof module !== 'undefined' && module.require ? module.require : null;
    if (!req) return null;
    fs = req('fs'); path = req('path');
    const electron = (() => { try { return req('electron'); } catch (e) { return null; } })();
    dir = electron && electron.app
      ? electron.app.getPath('userData')
      : path.join(process.cwd(), '.gachasurvivors');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) { return null; }

  const fileFor = (key) => path.join(dir, key.replace(/[^\w.-]/g, '_') + '.json');
  return {
    name: 'fs',
    read(key) {
      try { return fs.readFileSync(fileFor(key), 'utf8'); } catch (e) { return null; }
    },
    write(key, value) {
      try {
        // Write-then-rename, so a crash mid-write cannot corrupt the save.
        const f = fileFor(key);
        fs.writeFileSync(f + '.tmp', value, 'utf8');
        fs.renameSync(f + '.tmp', f);
        return true;
      } catch (e) { return false; }
    },
    remove(key) { try { fs.unlinkSync(fileFor(key)); } catch (e) { /* ignore */ } },
    available() { return true; },
  };
}

function pickBackend() {
  if (!IS_BROWSER) {
    return makeFsBackend() || memoryBackend;
  }
  if (localStorageBackend.available()) return localStorageBackend;
  return memoryBackend;
}

export const storage = {
  backend: pickBackend(),

  /** Swap the backend at runtime (Electron bootstrap, tests). */
  use(backend) { this.backend = backend; },
  useMemory() { this.backend = memoryBackend; memoryStore.clear(); },

  read(key) { return this.backend.read(key); },
  write(key, value) {
    if (this.backend.write(key, value)) return true;
    // Degrade rather than lose the session: fall back to memory and warn once.
    if (this.backend !== memoryBackend) {
      console.warn('[storage] write failed on ' + this.backend.name + '; falling back to memory');
      this.backend = memoryBackend;
      return this.backend.write(key, value);
    }
    return false;
  },
  remove(key) { this.backend.remove(key); },
  get name() { return this.backend.name; },
};
