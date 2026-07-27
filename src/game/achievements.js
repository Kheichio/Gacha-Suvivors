// Achievements: condition evaluation, reward granting, and the real unlock gates.
//
// DECISIONS.md §24 — three achievements in the spec granted unlocks for things
// that were already unlocked. The ruling was to make the GATES real rather than
// delete the rewards, so `save.data.unlocks` is genuinely consulted by the shrine
// (Curse) and the gacha (Relic Banner), and this file is what opens them.
//
// PUBLIC API:
//     ach.bind()                 subscribe to the event bus (once, at boot)
//     ach.checkRunEnd(summary)   evaluate run-scoped conditions
//     ach.progress(id)           { current, target, fraction } or null
//     ach.isUnlocked(id)

import { events, EV } from '../core/events.js';
import { save, addCurrency } from '../core/save.js';
import { audio } from '../core/audio.js';

export class Achievements {
  constructor(data, manager) {
    this.data = data;
    this.manager = manager;
    this.list = data.achievements.ACHIEVEMENTS;
    this.byId = data.achievements.ACHIEVEMENTS_BY_ID;
    this._bound = false;
    /** Run-scoped counters that the save blob does not track. */
    this.runFlags = Object.create(null);
  }

  bind() {
    if (this._bound) return;
    this._bound = true;
    events.on(EV.RUN_START, () => { this.runFlags = Object.create(null); });
    events.on(EV.BOSS_KILLED, (e) => {
      // "Beat a boss without taking damage" needs a per-boss damage flag.
      if (!this.runFlags.tookDamageSinceBoss) this.runFlags.flawlessBoss = true;
      this.runFlags.tookDamageSinceBoss = false;
    });
    events.on(EV.BOSS_SPAWNED, () => { this.runFlags.tookDamageSinceBoss = false; });
    events.on(EV.PLAYER_HURT, () => { this.runFlags.tookDamageSinceBoss = true; });
    events.on('gacha:lost5050', () => { this.runFlags.lost5050 = true; this.checkAll(); });
    events.on(EV.GACHA_PULL, () => this.checkAll());
    events.on(EV.EVOLUTION, () => { this.runFlags.evolutions = (this.runFlags.evolutions || 0) + 1; });
    events.on('stageManager:spawned', () => { this.runFlags.metStageManager = true; });
  }

  isUnlocked(id) { return save.data.achievements[id] !== undefined; }

  /** Current value for a countable condition, for the progress bars. */
  _value(cond, summary) {
    const s = save.data.stats;
    const d = save.data;
    switch (cond.kind) {
      case 'runTime': return summary ? summary.time : s.longestRun;
      case 'runLevel': return summary ? summary.level : s.highestLevel;
      case 'runKills': return summary ? summary.kills : 0;
      case 'totalKills': return s.kills;
      case 'totalRuns': return s.runs;
      case 'totalWins': return s.wins;
      case 'bossKills': return s.bossKills;
      case 'goldTotal': return s.goldEarned;
      case 'pullsTotal': return d.gacha.totalPulls;
      case 'charactersOwned': {
        let n = 0; for (const k in d.roster) if (d.roster[k].owned) n++; return n;
      }
      case 'relicsOwned': {
        let n = 0; for (const k in d.relics) if (d.relics[k].owned) n++; return n;
      }
      case 'starLevel': {
        let best = 1; for (const k in d.roster) best = Math.max(best, d.roster[k].starLevel || 1); return best;
      }
      case 'stageCleared': return d.stages[cond.stage] && d.stages[cond.stage].cleared ? 1 : 0;
      case 'allStagesCleared': {
        let n = 0; for (const st of this.data.stages.STAGES) if (d.stages[st.id] && d.stages[st.id].cleared) n++; return n;
      }
      case 'difficultyCleared': {
        let n = 0;
        for (const st of this.data.stages.STAGES) {
          const e = d.stages[st.id];
          if (e && e.bestTier >= (cond.tier || 1)) n++;
        }
        return n;
      }
      case 'survivedStageManager': return s.stageManagerSurvived;
      case 'evolutionsFound': return summary ? summary.evolutions.length : (this.runFlags.evolutions || 0);
      case 'noDamageBoss': return this.runFlags.flawlessBoss ? 1 : 0;
      case 'lost5050': return this.runFlags.lost5050 ? 1 : 0;
      case 'endlessTime': {
        let best = 0; for (const k in d.endless) best = Math.max(best, d.endless[k] || 0); return best;
      }
      case 'characterWins': {
        let n = 0; for (const k in d.roster) n += (d.roster[k].wins || 0); return n;
      }
      case 'upgradeMaxed': {
        if (!summary) return 0;
        let n = 0;
        for (const id in summary.upgrades) {
          const up = this.data.upgrades.UPGRADES_BY_ID[id];
          if (up && summary.upgrades[id] >= up.maxLevel) n++;
        }
        return n;
      }
      case 'bondLevel': {
        let best = 0; for (const k in d.roster) best = Math.max(best, d.roster[k].bond || 0); return best;
      }
      case 'codexEntries': {
        let n = 0;
        for (const cat of ['enemies', 'bosses', 'relics', 'characters']) {
          for (const k in d.codex[cat]) if (d.codex[cat][k]) n++;
        }
        return n;
      }
      case 'fanLettersSpent': return d.stats.fanLettersSpent || 0;
      default: return 0;
    }
  }

  progress(id) {
    const a = this.byId[id];
    if (!a || !a.condition) return null;
    const target = a.condition.value || 1;
    const current = Math.min(this._value(a.condition, null), target);
    return { current, target, fraction: target > 0 ? current / target : 0 };
  }

  /** Evaluate everything. Cheap enough to call on any meaningful event. */
  checkAll(summary) {
    for (const a of this.list) {
      if (this.isUnlocked(a.id)) continue;
      const c = a.condition;
      if (!c) continue;
      const value = this._value(c, summary);
      if (value >= (c.value || 1)) this._unlock(a);
    }
  }

  checkRunEnd(summary) {
    this.checkAll(summary);
    this.runFlags = Object.create(null);
  }

  _unlock(a) {
    save.data.achievements[a.id] = Date.now();
    const r = a.reward || {};
    if (r.starFragments) addCurrency('starFragments', r.starFragments);
    if (r.tickets) addCurrency('tickets', r.tickets);
    if (r.universalLetters) addCurrency('universalLetters', r.universalLetters);
    if (r.gold) addCurrency('gold', r.gold);
    if (r.unlock) save.data.unlocks[r.unlock] = true;
    if (r.costume) {
      const e = save.data.roster[r.costume];
      if (e) e.costume = true;
    }
    save.save();
    audio.play('achievement');
    if (this.manager) {
      this.manager.toast(a.name + ' — ' + this._rewardText(r), '#ffd76a', a.icon || '🏆');
    }
    events.emit(EV.ACHIEVEMENT, a);
  }

  _rewardText(r) {
    if (r.starFragments) return '+' + r.starFragments + '💎';
    if (r.tickets) return '+' + r.tickets + '🎟';
    if (r.universalLetters) return '+' + r.universalLetters + '💌';
    if (r.gold) return '+' + r.gold + '⭐';
    if (r.unlock) return 'UNLOCKED: ' + r.unlock;
    if (r.costume) return 'costume unlocked';
    return 'unlocked';
  }

  get completion() {
    let n = 0;
    for (const a of this.list) if (this.isUnlocked(a.id)) n++;
    return { unlocked: n, total: this.list.length, fraction: n / Math.max(1, this.list.length) };
  }
}

export function createAchievements(data, manager) { return new Achievements(data, manager); }
