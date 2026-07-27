// In-browser test runner: open the game with `?test=1`.
//
// Runs the same shared suites as `npm test`. The two source-scanning suites
// (architecture rule, ref containment) are Node-only — they need filesystem
// access — so this runner says so out loud rather than quietly reporting a
// smaller pass count as a full green.

import { runSuites } from './harness.js';
import { renderer } from '../src/render/renderer.js';
import { UI_FONT, MONO_FONT } from '../src/render/renderer.js';

export async function runAllTests() {
  await import('./suites.js');
  try {
    await import('./abilityCoverage.js');
  } catch (e) {
    console.error('[tests] the ability registry failed to import:', e);
  }

  const lines = [];
  const result = runSuites((line, kind) => {
    lines.push({ line, kind });
    const style = kind === 'pass' ? 'color:#7bf59a'
                : kind === 'fail' ? 'color:#ff6f91;font-weight:bold'
                : kind === 'suite' ? 'color:#6ad8ff;font-weight:bold'
                : 'color:#8e97b5';
    console.log('%c' + line, style);
  });

  console.log('');
  console.log(`%c${result.passed} passed, ${result.failed} failed`,
              result.failed ? 'color:#ff6f91;font-weight:bold' : 'color:#7bf59a;font-weight:bold');
  console.log('%cNote: the architecture and ref-containment suites are Node-only ' +
              '(they read the source tree). Run `npm test` for the full set.',
              'color:#8e97b5');

  draw(lines, result);
  window.addEventListener('resize', () => draw(lines, result));
  window.addEventListener('wheel', (e) => { scroll += Math.sign(e.deltaY) * 3; draw(lines, result); });
  return result;
}

let scroll = 0;

function draw(lines, result) {
  const r = renderer;
  if (!r) return;
  r.beginFrame('#05060d');
  r.setScreenSpace();

  const pass = result.failed === 0;
  r.drawText(pass ? 'ALL TESTS PASS' : `${result.failed} TEST${result.failed === 1 ? '' : 'S'} FAILED`,
             r.w / 2, 44, {
    size: 30, color: pass ? '#7bf59a' : '#ff6f91', align: 'center', weight: 800,
  });
  r.drawText(`${result.passed} passed · ${result.failed} failed · ` +
             `architecture + ref-containment suites are Node-only (npm test)`,
             r.w / 2, 70, { size: 13, color: '#8e97b5', align: 'center' });

  const top = 96;
  const lineH = 15;
  const visible = Math.floor((r.h - top - 20) / lineH);
  scroll = Math.max(0, Math.min(scroll, Math.max(0, lines.length - visible)));

  for (let i = 0; i < visible && i + scroll < lines.length; i++) {
    const l = lines[i + scroll];
    const color = l.kind === 'pass' ? '#5ce08a'
                : l.kind === 'fail' ? '#ff6f91'
                : l.kind === 'suite' ? '#6ad8ff'
                : '#5f6b8c';
    r.drawText(l.line, 24, top + i * lineH, {
      size: 12, color, family: MONO_FONT, weight: l.kind === 'suite' ? 800 : 500,
    });
  }

  if (lines.length > visible) {
    r.drawText('scroll for more', r.w - 24, r.h - 16,
               { size: 11, color: '#41496b', align: 'right', family: MONO_FONT });
  }

  // Failures again at the bottom, in full, because the one-line summary in the
  // scrollback is not enough to act on.
  if (result.failures.length) {
    let y = r.h - 20 - result.failures.length * 30;
    for (const f of result.failures.slice(0, 6)) {
      r.drawText(`${f.suite} › ${f.test}`, 24, y, { size: 12, color: '#ff6f91', weight: 700 });
      r.drawText(String(f.detail).split('\n')[0].slice(0, 150), 24, y + 14,
                 { size: 11, color: '#8e97b5', family: MONO_FONT });
      y += 30;
    }
  }

  r.endFrame();
}
