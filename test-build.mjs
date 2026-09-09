// 冒烟测试:在 Node 中无头构建整座城市,校验数据完整性
import { buildCity, LANDMARKS } from './js/buildCity.js';

const r = buildCity();
const total = r.stats.struct + r.stats.fine;
console.log('struct voxels :', r.stats.struct);
console.log('fine voxels   :', r.stats.fine);
console.log('total voxels  :', total);
console.log('chunks        :', r.chunks.length);
console.log('landmarks     :', LANDMARKS.length);
console.log('water verts   :', r.waterGeom.attributes.position.count);

// 校验
const checks = [];
if (!r.chunks.length) checks.push('no chunks');
if (!total) checks.push('no voxels');
if (LANDMARKS.length < 30) checks.push('landmarks too few');
for (const ch of r.chunks) {
  if (ch.sm.length % 16 !== 0 || ch.sc.length / 3 !== ch.sm.length / 16) checks.push('bad struct arrays @' + ch.cx + ',' + ch.cz);
  if (ch.fm.length % 16 !== 0 || ch.fc.length / 3 !== ch.fm.length / 16) checks.push('bad fine arrays @' + ch.cx + ',' + ch.cz);
  for (let i = 0; i < ch.sm.length; i++) if (!Number.isFinite(ch.sm[i])) checks.push('NaN in sm');
}
// 抽查高度图:各城门中门洞应可通行,门旁实台应高
const doorH = r.hm.get(0, -470), wallH = r.hm.get(40, -470);
console.log('hm check: 午门中门洞=', doorH, '(应=2)  门旁台基=', wallH, '(应≥12)');
if (doorH > 6) checks.push('午门门洞被堵');
const gates = [[0, 482, '神武门'], [378, 0, '东华门'], [-378, 0, '西华门'], [0, -920, '天安门'], [0, -700, '端门']];
for (const [gx, gz, gname] of gates) {
  const h = r.hm.get(gx, gz);
  console.log(`hm check: ${gname}=${h} (应≤3)`);
  if (h > 6) checks.push(`${gname}门洞被堵`);
}
const hmTaihe = r.hm.get(0, -242);
console.log('hm check: 太和殿=', hmTaihe, '(应为屋顶≈35)');
for (const lm of LANDMARKS) {
  if (!lm.name || !lm.cam || !(lm.cam.d > 0)) checks.push('bad landmark ' + lm.name);
}

if (checks.length) {
  console.error('FAIL:', checks.join(' | '));
  process.exit(1);
}
console.log('OK ✔');
