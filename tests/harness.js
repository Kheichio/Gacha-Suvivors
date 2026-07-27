// A ~90-line test framework, because a test dependency would violate the
// project's own "zero external runtime dependencies" rule and because the same
// tests must run under Node AND in the browser at `?test=1`.

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error('it() outside describe()');
  current.tests.push({ name, fn });
}

class AssertionError extends Error {}

export const assert = {
  ok(v, msg) {
    if (!v) throw new AssertionError(msg || `expected truthy, got ${fmt(v)}`);
  },
  equal(a, b, msg) {
    if (a !== b) throw new AssertionError(msg || `expected ${fmt(b)}, got ${fmt(a)}`);
  },
  notEqual(a, b, msg) {
    if (a === b) throw new AssertionError(msg || `expected not ${fmt(b)}`);
  },
  close(a, b, eps, msg) {
    const e = eps === undefined ? 1e-9 : eps;
    if (Math.abs(a - b) > e) {
      throw new AssertionError(msg || `expected ${fmt(b)} ±${e}, got ${fmt(a)}`);
    }
  },
  lessThan(a, b, msg) {
    if (!(a < b)) throw new AssertionError(msg || `expected ${fmt(a)} < ${fmt(b)}`);
  },
  atLeast(a, b, msg) {
    if (!(a >= b)) throw new AssertionError(msg || `expected ${fmt(a)} >= ${fmt(b)}`);
  },
  atMost(a, b, msg) {
    if (!(a <= b)) throw new AssertionError(msg || `expected ${fmt(a)} <= ${fmt(b)}`);
  },
  includes(arr, v, msg) {
    if (!arr || arr.indexOf(v) < 0) throw new AssertionError(msg || `expected to include ${fmt(v)}`);
  },
  throws(fn, msg) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new AssertionError(msg || 'expected a throw');
  },
  deepEqual(a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) throw new AssertionError(msg || `expected ${sb}, got ${sa}`);
  },
};

function fmt(v) {
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6);
  if (Array.isArray(v)) return `[${v.slice(0, 6).map(fmt).join(', ')}${v.length > 6 ? ', …' : ''}]`;
  return String(v);
}

/**
 * @param {(line:string, kind:string)=>void} log
 * @returns {{passed:number, failed:number, failures:Array}}
 */
export function runSuites(log) {
  let passed = 0, failed = 0;
  const failures = [];
  for (const s of suites) {
    log(s.name, 'suite');
    for (const t of s.tests) {
      try {
        t.fn();
        passed++;
        log('  ✔ ' + t.name, 'pass');
      } catch (e) {
        failed++;
        const detail = e instanceof AssertionError ? e.message : (e && e.stack) || String(e);
        failures.push({ suite: s.name, test: t.name, detail });
        log('  ✘ ' + t.name, 'fail');
        log('      ' + String(detail).split('\n')[0], 'detail');
      }
    }
  }
  return { passed, failed, failures };
}

export function reset() { suites.length = 0; current = null; }
export function suiteCount() { return suites.length; }
