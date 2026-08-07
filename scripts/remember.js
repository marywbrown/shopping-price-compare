#!/usr/bin/env node
/**
 * remember.js — 记录用户偏好，写入 user_prefs.json（与 scripts/ 同级的根目录）。
 *
 * 用法：
 *   node remember.js --category clothing --value "纯棉"
 *   node remember.js --category sanitary --value "无荧光剂"
 *   node remember.js --global "看重销量"
 *   node remember.js --exclude-platform pdd
 *   node remember.js --device mobile        # 记用户常用设备：mobile | desktop
 *   node remember.js --device desktop
 *
 * 品类键约定（与 category-rules.md 一致）：
 *   clothing(衣物) / sanitary(卫生巾·女性护理) / digital(数码电子) / food(食品) / unknown(未知)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREFS_PATH = path.join(ROOT, 'user_prefs.json');
const LOG_PATH = path.join(ROOT, 'learning_log.json');

function load(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}
function save(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}
function pushUnique(arr, val) {
  if (!Array.isArray(arr)) arr = [];
  if (!arr.includes(val)) arr.push(val);
  return arr;
}

function main() {
  const argv = process.argv.slice(2);
  const p = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      p[k] = v;
    }
  }

  const prefs = load(PREFS_PATH) || { excludedPlatforms: [], categoryPrefs: {}, globalPrefs: [] };
  prefs.excludedPlatforms = prefs.excludedPlatforms || [];
  prefs.categoryPrefs = prefs.categoryPrefs || {};
  prefs.globalPrefs = prefs.globalPrefs || [];

  const changed = [];

  if (p.category && p.value) {
    const cat = String(p.category).trim();
    prefs.categoryPrefs[cat] = pushUnique(prefs.categoryPrefs[cat], String(p.value).trim());
    changed.push(`categoryPrefs.${cat} += ${p.value}`);
  }
  if (p.global) {
    prefs.globalPrefs = pushUnique(prefs.globalPrefs, String(p.global).trim());
    changed.push(`globalPrefs += ${p.global}`);
  }
  if (p['exclude-platform']) {
    prefs.excludedPlatforms = pushUnique(prefs.excludedPlatforms, String(p['exclude-platform']).trim());
    changed.push(`excludedPlatforms += ${p['exclude-platform']}`);
  }
  if (p.device) {
    const dev = String(p.device).trim().toLowerCase();
    if (dev === 'mobile' || dev === 'desktop' || dev === 'phone' || dev === 'pc') {
      prefs.device = (dev === 'phone' || dev === 'mobile') ? 'mobile' : 'desktop';
      changed.push(`device = ${prefs.device}`);
    }
  }

  if (changed.length === 0) {
    console.log(JSON.stringify({ ok: false, hint: '用法: --category <cat> --value <val> | --global <val> | --exclude-platform <p> | --device mobile|desktop' }));
    return;
  }

  save(PREFS_PATH, prefs);

  // 同步追加一条学习记录（可选）
  const log = load(LOG_PATH) || [];
  if (Array.isArray(log)) {
    log.push({ ts: new Date().toISOString().slice(0, 10), type: 'pref', changes: changed });
    save(LOG_PATH, log);
  }

  console.log(JSON.stringify({ ok: true, changed, prefs }, null, 2));
}

if (require.main === module) main();
module.exports = { main };
