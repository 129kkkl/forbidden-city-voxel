// ============================================================
//  紫禁城 · 体素沙盘 —— 城市生成器
//  坐标约定:x 东为正, z 北为正, y 向上(单位:米)
//  紫禁城本体:东西 753m × 南北 961m, 宫墙内地面高 2m, 城外地面 0m
// ============================================================
import * as THREE from './three.module.min.js';

export const CHUNK = 128;
const HM_MINX = -640, HM_MINZ = -1040, HM_W = 1280, HM_H = 1680;
export const G_IN = 2, G_OUT = 0, G_CORR = 0.2;

export const COLORS = {
  wall: 0xa63a30, wallShade: 0x99342b, column: 0x8f2a20,
  roof: 0xd9a13f, roofAlt: 0xcf9634, ridge: 0xc08a26, gold: 0xc9a227,
  roofUnder: 0x5a2a1c,
  roofGreen: 0x3f8c54, roofGreenAlt: 0x39834c,
  roofBlack: 0x43484f, roofBlackAlt: 0x3b4046,
  white: 0xeae4d6, white2: 0xdad3c2, white3: 0xf4efe2,
  brick: 0xab9778, brickDark: 0x9c8a6e, stone: 0xc7bfae, stone2: 0xb7af9e, road: 0x8f8878,
  cityWall: 0x7f7568, cityWall2: 0x736a5e, merlon: 0x8d8472,
  door: 0x6d2018, window: 0x4c2a1a,
  tree1: 0x4e7d3a, tree2: 0x41702f, tree3: 0x5d8c45, trunk: 0x6a4a2e, autumn: 0x8a6a2e,
  bronze: 0x7c5a32, bronze2: 0x8f6d3e, lantern: 0xd8462c,
  rock1: 0x84827a, rock2: 0x74726b,
  soilYellow: 0xc9b98e, soilCyan: 0x4d8f8f, soilRed: 0x9a4630, soilWhite: 0xd8d2c2, soilBlack: 0x3f3f42,
  rampGold: 0x8a6a3c,
};

// ---------------- 工具 ----------------
function hex2rgb(h, out) {
  out[0] = ((h >> 16) & 255) / 255; out[1] = ((h >> 8) & 255) / 255; out[2] = (h & 255) / 255;
  return out;
}
const _c1 = [0, 0, 0], _c2 = [0, 0, 0];

class ChunkStore {
  constructor() { this.map = new Map(); }
  _chunk(cx, cz) {
    const k = cx * 4096 + cz;
    let v = this.map.get(k);
    if (!v) { v = { cx, cz, sm: [], sc: [], fm: [], fc: [] }; this.map.set(k, v); }
    return v;
  }
  add(x, z, fine, m, col) {
    const ch = this._chunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    const a = fine ? ch.fm : ch.sm, b = fine ? ch.fc : ch.sc;
    for (let i = 0; i < 16; i++) a.push(m[i]);
    b.push(col[0], col[1], col[2]);
  }
}

class HeightMap {
  constructor() { this.d = new Int16Array(HM_W * HM_H); }
  idx(x, z) {
    const ix = Math.floor(x) - HM_MINX, iz = Math.floor(z) - HM_MINZ;
    if (ix < 0 || iz < 0 || ix >= HM_W || iz >= HM_H) return -1;
    return ix + iz * HM_W;
  }
  get(x, z) { const i = this.idx(x, z); return i < 0 ? 0 : this.d[i]; }
  fill(x0, z0, x1, z1, top) {
    let ix0 = Math.floor(x0) - HM_MINX, ix1 = Math.floor(x1) - HM_MINX;
    let iz0 = Math.floor(z0) - HM_MINZ, iz1 = Math.floor(z1) - HM_MINZ;
    if (ix0 < 0) ix0 = 0; if (iz0 < 0) iz0 = 0;
    if (ix1 >= HM_W) ix1 = HM_W - 1; if (iz1 >= HM_H) iz1 = HM_H - 1;
    const t = Math.round(top);
    for (let iz = iz0; iz <= iz1; iz++) {
      let i = ix0 + iz * HM_W;
      for (let ix = ix0; ix <= ix1; ix++, i++) if (this.d[i] < t) this.d[i] = t;
    }
  }
  // 强制下挖(用于门洞隧道)
  set(x0, z0, x1, z1, top) {
    let ix0 = Math.floor(x0) - HM_MINX, ix1 = Math.floor(x1) - HM_MINX;
    let iz0 = Math.floor(z0) - HM_MINZ, iz1 = Math.floor(z1) - HM_MINZ;
    if (ix0 < 0) ix0 = 0; if (iz0 < 0) iz0 = 0;
    if (ix1 >= HM_W) ix1 = HM_W - 1; if (iz1 >= HM_H) iz1 = HM_H - 1;
    const t = Math.round(top);
    for (let iz = iz0; iz <= iz1; iz++) {
      let i = ix0 + iz * HM_W;
      for (let ix = ix0; ix <= ix1; ix++, i++) this.d[i] = t;
    }
  }
}

function createCtx() {
  return { cs: new ChunkStore(), hm: new HeightMap(), stats: { struct: 0, fine: 0 } };
}

// ---------------- 体素放置 ----------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function put(c, x, y, z, sx, sy, sz, color, o) {
  o = o || {};
  const jit = o.jitter || 0;
  hex2rgb(color, _c1);
  let r = _c1[0], g = _c1[1], b = _c1[2];
  if (jit > 0) {
    r += (Math.random() - 0.5) * jit; g += (Math.random() - 0.5) * jit; b += (Math.random() - 0.5) * jit;
    if (r < 0) r = 0; else if (r > 1) r = 1;
    if (g < 0) g = 0; else if (g > 1) g = 1;
    if (b < 0) b = 0; else if (b > 1) b = 1;
  }
  if (o.rot) {
    _p.set(x, y, z); _s.set(sx, sy, sz);
    _e.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0);
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    _c2[0] = r; _c2[1] = g; _c2[2] = b;
    c.cs.add(x, z, !!o.fine, _m.elements, _c2);
  } else {
    _c2[0] = r; _c2[1] = g; _c2[2] = b;
    c.cs.add(x, z, !!o.fine, [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1], _c2);
  }
  if (!o.fine && o.land !== false) c.hm.fill(x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, y + sy / 2);
  if (o.fine) c.stats.fine++; else c.stats.struct++;
}

function box(c, x0, y0, z0, x1, y1, z1, color, o) {
  put(c, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, color, o);
}
function slab(c, x0, z0, x1, z1, y0, y1, color, o) {
  const SEG = 96;
  const w = x1 - x0, d = z1 - z0;
  const nx = Math.max(1, Math.ceil(w / SEG)), nz = Math.max(1, Math.ceil(d / SEG));
  const sw = w / nx, sd = d / nz;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const X0 = x0 + sw * i, X1 = X0 + sw, Z0 = z0 + sd * j, Z1 = Z0 + sd;
    box(c, X0, y0, Z0, X1, y1, Z1, color, o);
  }
  if (o && o.land === false) return;
  c.hm.fill(x0, z0, x1, z1, y1);
}
// 地面铺装:视觉顶面 yTop-0.1, 行走高度 yTop(避免遮挡水面并保持步高一致)
function groundPlate(c, x0, z0, x1, z1, yTop, color, o) {
  slab(c, x0, z0, x1, z1, yTop - 0.7, yTop - 0.1, color, Object.assign({}, o, { land: false }));
  c.hm.fill(x0, z0, x1, z1, yTop);
}
function plate(c, x0, z0, x1, z1, yTop, color, o) {
  slab(c, x0, z0, x1, z1, yTop - 0.6, yTop, color, o);
}
// 地面砖缝纹理(金砖铺地的线条)
function brickLines(c, x0, z0, x1, z1, yTop, step) {
  step = step || 6;
  for (let x = x0 + step; x < x1 - 0.5; x += step) {
    box(c, x - 0.07, yTop - 0.04, z0 + 0.4, x + 0.07, yTop + 0.05, z1 - 0.4, COLORS.brickDark, { fine: true, land: false });
  }
  for (let z = z0 + step; z < z1 - 0.5; z += step) {
    box(c, x0 + 0.4, yTop - 0.04, z - 0.07, x1 - 0.4, yTop + 0.05, z + 0.07, COLORS.brickDark, { fine: true, land: false });
  }
}

// ---------------- 建筑构件 ----------------
function eaveRing(c, x0, z0, x1, z1, wallTop, dougong) {
  const y0 = wallTop, y1 = wallTop + 0.8;
  box(c, x0 - 1.1, y0, z0 - 1.2, x1 + 1.1, y1, z0 - 0.3, COLORS.roofUnder);
  box(c, x0 - 1.1, y0, z1 + 0.3, x1 + 1.1, y1, z1 + 1.2, COLORS.roofUnder);
  box(c, x0 - 1.2, y0, z0 - 0.3, x0 - 0.3, y1, z1 + 0.3, COLORS.roofUnder);
  box(c, x1 + 0.3, y0, z0 - 0.3, x1 + 1.2, y1, z1 + 0.3, COLORS.roofUnder);
  if (dougong) {
    for (let x = x0 + 1; x <= x1 - 1; x += 2) {
      box(c, x - 0.25, y0 + 0.4, z0 - 0.9, x + 0.25, y1 + 0.1, z0 - 0.5, COLORS.gold, { fine: true, land: false });
      box(c, x - 0.25, y0 + 0.4, z1 + 0.5, x + 0.25, y1 + 0.1, z1 + 0.9, COLORS.gold, { fine: true, land: false });
    }
  }
}

function hipRoof(c, x, z, yTop, w, d, h, color, tiers, pointy) {
  tiers = tiers || 4;
  const ov = 1.6, th = h / tiers;
  let y = yTop;
  for (let i = 0; i < tiers; i++) {
    const t = (i + 0.5) / tiers;
    const k = pointy ? Math.pow(1 - t, 0.9) * 0.92 + 0.06 : 1 - 0.45 * t;
    const ww = Math.max((w + ov * 2) * k, 1.4), dd = Math.max((d + ov * 2) * k, 1.4);
    box(c, x - ww / 2, y, z - dd / 2, x + ww / 2, y + th, z + dd / 2, i % 2 ? color : COLORS.roofAlt, { jitter: 0.02 });
    // 瓦当金边
    box(c, x - ww / 2 + 0.1, y + th - 0.14, z - dd / 2 + 0.1, x + ww / 2 - 0.1, y + th + 0.14, z - dd / 2 + 0.4, COLORS.ridge, { fine: true, land: false });
    box(c, x - ww / 2 + 0.1, y + th - 0.14, z + dd / 2 - 0.4, x + ww / 2 - 0.1, y + th + 0.14, z + dd / 2 - 0.1, COLORS.ridge, { fine: true, land: false });
    box(c, x - ww / 2 + 0.1, y + th - 0.14, z - dd / 2 + 0.1, x - ww / 2 + 0.4, y + th + 0.14, z + dd / 2 - 0.1, COLORS.ridge, { fine: true, land: false });
    box(c, x + ww / 2 - 0.4, y + th - 0.14, z - dd / 2 + 0.1, x + ww / 2 - 0.1, y + th + 0.14, z + dd / 2 - 0.1, COLORS.ridge, { fine: true, land: false });
    // 瓦垄
    if (ww > 5 && !pointy) {
      const n = Math.min(18, Math.floor(ww / 2.3));
      for (let j = 1; j < n; j++) {
        const tx = -ww / 2 + ww * j / n;
        box(c, x + tx - 0.13, y + th - 0.1, z - dd * 0.5, x + tx + 0.13, y + th + 0.22, z + dd * 0.5, COLORS.ridge, { fine: true, land: false });
      }
    }
    y += th;
  }
  const cy0 = yTop + th / 2;
  box(c, x - w / 2 - ov + 0.5, cy0, z - d / 2 - ov + 0.5, x - w / 2 - ov + 1.2, cy0 + 0.7, z - d / 2 - ov + 1.2, COLORS.gold, { land: false });
  box(c, x + w / 2 + ov - 1.2, cy0, z - d / 2 - ov + 0.5, x + w / 2 + ov - 0.5, cy0 + 0.7, z - d / 2 - ov + 1.2, COLORS.gold, { land: false });
  box(c, x - w / 2 - ov + 0.5, cy0, z + d / 2 + ov - 1.2, x - w / 2 - ov + 1.2, cy0 + 0.7, z + d / 2 + ov - 0.5, COLORS.gold, { land: false });
  box(c, x + w / 2 + ov - 1.2, cy0, z + d / 2 + ov - 1.2, x + w / 2 + ov - 0.5, cy0 + 0.7, z + d / 2 + ov - 0.5, COLORS.gold, { land: false });
  if (pointy) {
    box(c, x - 0.6, y - 0.2, z - 0.6, x + 0.6, y + 1.0, z + 0.6, COLORS.gold);
    return y + 1.0;
  }
  const rw = Math.max(w * 0.52, 2.4);
  box(c, x - rw / 2, y - 0.45, z - 0.75, x + rw / 2, y + 0.45, z + 0.75, COLORS.ridge);
  box(c, x - rw / 2 - 0.5, y - 0.5, z - 1.05, x - rw / 2 + 0.5, y + 0.55, z + 1.05, COLORS.gold, { land: false });
  box(c, x + rw / 2 - 0.5, y - 0.5, z - 1.05, x + rw / 2 + 0.5, y + 0.55, z + 1.05, COLORS.gold, { land: false });
  return y + 0.45;
}
function pyramidRoof(c, x, z, yTop, w, d, h, color) { return hipRoof(c, x, z, yTop, w, d, h, color, 5, true); }
function doubleRoof(c, x, z, yTop, w, d, h, color) {
  const y1 = hipRoof(c, x, z, yTop + 1.8, w, d, h * 0.34, color, 3);
  return hipRoof(c, x, z, y1 + 0.3, w * 0.8, d * 0.8, h * 0.6, color, 4);
}

function doorPanel(c, x, floorY, face, axis, dir, w, h) {
  const y0 = floorY + 0.15, y1 = floorY + h - 0.4;
  if (axis === 'z') {
    box(c, x - w / 2, y0, face - dir * 0.18, x + w / 2, y1, face + dir * 0.22, COLORS.door, { land: false });
    const cols = Math.min(5, Math.floor(w / 0.85)), rows = Math.min(8, Math.floor((y1 - y0 - 1) / 0.85));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const sx = x - (cols - 1) * 0.85 / 2 + i * 0.85, sy = y1 - 0.7 - j * 0.85;
      box(c, sx - 0.2, sy - 0.2, face - dir * 0.32, sx + 0.2, sy + 0.2, face + dir * 0.34, COLORS.gold, { fine: true, land: false });
    }
  } else {
    box(c, face - dir * 0.18, y0, x - w / 2, face + dir * 0.22, y1, x + w / 2, COLORS.door, { land: false });
    const cols = Math.min(5, Math.floor(w / 0.85)), rows = Math.min(8, Math.floor((y1 - y0 - 1) / 0.85));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const sz = x - (cols - 1) * 0.85 / 2 + i * 0.85, sy = y1 - 0.7 - j * 0.85;
      box(c, face - dir * 0.32, sy - 0.2, sz - 0.2, face + dir * 0.34, sy + 0.2, sz + 0.2, COLORS.gold, { fine: true, land: false });
    }
  }
}
function windowPanel(c, x, floorY, face, axis, dir, w, h) {
  const y0 = floorY + h * 0.45, y1 = floorY + h * 0.8;
  if (axis === 'z') {
    box(c, x - w / 2, y0, face - dir * 0.12, x + w / 2, y1, face + dir * 0.1, COLORS.window, { land: false });
    box(c, x - 0.08, y0, face - dir * 0.2, x + 0.08, y1, face + dir * 0.18, COLORS.gold, { fine: true, land: false });
    box(c, x - w / 2 + 0.3, y0 + 0.2, face - dir * 0.2, x - w / 2 + 0.42, y1 - 0.2, face + dir * 0.18, COLORS.gold, { fine: true, land: false });
    box(c, x + w / 2 - 0.42, y0 + 0.2, face - dir * 0.2, x + w / 2 - 0.3, y1 - 0.2, face + dir * 0.18, COLORS.gold, { fine: true, land: false });
  } else {
    box(c, face - dir * 0.12, y0, x - w / 2, face + dir * 0.1, y1, x + w / 2, COLORS.window, { land: false });
    box(c, face - dir * 0.2, y0, x - 0.08, face + dir * 0.18, y1, x + 0.08, COLORS.gold, { fine: true, land: false });
  }
}

function lanternRow(c, x0, x1, z, y, n) {
  for (let i = 0; i < n; i++) {
    const x = x0 + (x1 - x0) * (i + 0.5) / n;
    box(c, x - 0.35, y - 0.7, z - 0.35, x + 0.35, y + 0.3, z + 0.35, COLORS.lantern, { land: false });
    box(c, x - 0.25, y + 0.3, z - 0.25, x + 0.25, y + 0.55, z + 0.25, COLORS.gold, { land: false });
  }
}

// tower=true:门楼(山墙不填碰撞, 便于门洞从下方穿过)
function hall(c, o) {
  const x = o.x, z = o.z, w = o.w, d = o.d;
  const floorY = o.floorY !== undefined ? o.floorY : G_IN;
  const wallH = o.wallH || 6;
  const bays = o.bays || 5;
  const doorBays = o.doorBays || [Math.floor(bays / 2)];
  const doorBoth = o.doorBoth;
  const roofType = o.roofType || 'hip';
  const roofH = o.roofH || (roofType === 'double' ? 9 : 6);
  const roofColor = o.roofColor || COLORS.roof;
  const wallColor = o.wallColor || COLORS.wall;
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  const bw = w / bays, wallTop = floorY + wallH;
  const endLand = o.tower ? false : true;
  if (o.columns !== false) {
    for (let i = 0; i <= bays; i++) {
      const bx = x0 + bw * i;
      box(c, bx - 0.55, floorY, z0 - 0.7, bx + 0.55, wallTop, z0 + 0.9, COLORS.column, { jitter: 0.02, land: false });
      box(c, bx - 0.55, floorY, z1 - 0.9, bx + 0.55, wallTop, z1 + 0.7, COLORS.column, { jitter: 0.02, land: false });
    }
  }
  box(c, x0 - 0.7, floorY, z0 + 0.7, x0 + 0.7, wallTop, z1 - 0.7, wallColor, { jitter: 0.03, land: endLand });
  box(c, x1 - 0.7, floorY, z0 + 0.7, x1 + 0.7, wallTop, z1 - 0.7, wallColor, { jitter: 0.03, land: endLand });
  for (let i = 0; i < bays; i++) {
    const isDoor = doorBays.indexOf(i) >= 0;
    const bx0 = x0 + bw * i, bx1 = x0 + bw * (i + 1), bxm = (bx0 + bx1) / 2;
    if (!isDoor) {
      box(c, bx0 + 0.2, floorY, z0 - 0.6, bx1 - 0.2, wallTop, z0 + 0.8, wallColor, { jitter: 0.03 });
      if (o.windows) windowPanel(c, bxm, floorY, z0, 'z', -1, bw - 1.2, wallH);
    } else {
      doorPanel(c, bxm, floorY, z0, 'z', -1, bw - 0.9, wallH);
    }
    if (doorBoth) {
      if (isDoor) doorPanel(c, bxm, floorY, z1, 'z', 1, bw - 0.9, wallH);
      else box(c, bx0 + 0.2, floorY, z1 - 0.8, bx1 - 0.2, wallTop, z1 + 0.6, wallColor, { jitter: 0.03 });
    }
  }
  if (!doorBoth) box(c, x0 + 0.2, floorY, z1 - 0.8, x1 - 0.2, wallTop, z1 + 0.6, wallColor, { jitter: 0.03 });
  // 台明(殿基台)
  if (o.base !== false) {
    box(c, x0 - 0.9, floorY, z0 - 0.95, x1 + 0.9, floorY + 0.85, z0 - 0.15, COLORS.white2, { jitter: 0.015 });
    box(c, x0 - 0.9, floorY, z1 + 0.15, x1 + 0.9, floorY + 0.85, z1 + 0.95, COLORS.white2, { jitter: 0.015 });
    box(c, x0 - 0.95, floorY, z0 - 0.15, x0 - 0.15, floorY + 0.85, z1 + 0.15, COLORS.white2, { jitter: 0.015 });
    box(c, x1 + 0.15, floorY, z0 - 0.15, x1 + 0.95, floorY + 0.85, z1 + 0.15, COLORS.white2, { jitter: 0.015 });
  }
  eaveRing(c, x0, z0, x1, z1, wallTop, o.dougong);
  let ridge;
  if (roofType === 'pyramid') ridge = pyramidRoof(c, x, z, wallTop, w, d, roofH, roofColor);
  else if (roofType === 'double') ridge = doubleRoof(c, x, z, wallTop, w, d, roofH, roofColor);
  else ridge = hipRoof(c, x, z, wallTop, w, d, roofH, roofColor, 4, false);
  if (o.lanterns) lanternRow(c, x0 + bw * 1.2, x1 - bw * 1.2, z0, wallTop - 1.2, Math.max(1, bays - 2));
  return { ridge, wallTop, floorY };
}

// 东西向城楼(东华门/西华门):门洞沿 x 轴穿过
function gateTowerEW(c, x, z, wNS, dEW, floorY, wallH, roofH, doors) {
  const z0 = z - wNS / 2, z1 = z + wNS / 2, x0 = x - dEW / 2, x1 = x + dEW / 2;
  const wallTop = floorY + wallH;
  // 南北山墙(实)
  box(c, x0, floorY, z0 - 1.4, x1, wallTop, z0 + 0.8, COLORS.wall, { jitter: 0.03 });
  box(c, x0, floorY, z1 - 0.8, x1, wallTop, z1 + 1.4, COLORS.wall, { jitter: 0.03 });
  // 东西面:柱 + 门/窗
  for (let i = 0; i <= doors.length; i++) {
    const bz = z0 + (z1 - z0) * i / (doors.length || 1);
    box(c, x0 - 0.6, floorY, bz - 0.55, x0 + 0.9, wallTop, bz + 0.55, COLORS.column, { jitter: 0.02, land: false });
    box(c, x1 - 0.9, floorY, bz - 0.55, x1 + 0.6, wallTop, bz + 0.55, COLORS.column, { jitter: 0.02, land: false });
  }
  for (let i = 0; i < doors.length; i++) {
    const [g0, g1] = doors[i];
    const gm = (g0 + g1) / 2;
    doorPanel(c, gm, floorY, x0, 'x', 1, g1 - g0 - 1, wallH - 1);
    doorPanel(c, gm, floorY, x1, 'x', -1, g1 - g0 - 1, wallH - 1);
  }
  const segs = [[z0, doors[0][0]], [doors[doors.length - 1][1], z1]];
  for (let i = 0; i < doors.length - 1; i++) segs.push([doors[i][1], doors[i + 1][0]]);
  for (const [a0, a1] of segs) {
    if (a1 - a0 <= 0.1) continue;
    windowPanel(c, (a0 + a1) / 2, floorY, x0, 'x', 1, a1 - a0 - 1, wallH - 2);
    windowPanel(c, (a0 + a1) / 2, floorY, x1, 'x', -1, a1 - a0 - 1, wallH - 2);
  }
  eaveRing(c, x0, z0, x1, z1, wallTop, false);
  return hipRoof(c, x, z, wallTop, dEW + 4, wNS + 4, roofH, COLORS.roof, 4, false);
}

function stairsZ(c, x, z0, z1, y0, y1, width, color) {
  const n = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.6));
  const run = Math.abs(z1 - z0) / n;
  const dir = z1 > z0 ? 1 : -1;
  color = color || COLORS.white;
  for (let i = 0; i < n; i++) {
    const za = z0 + dir * run * i, zb = z0 + dir * run * (i + 1);
    const ya = y0 + (y1 - y0) * i / n, yb = y0 + (y1 - y0) * (i + 1) / n;
    slab(c, x - width / 2, Math.min(za, zb), x + width / 2, Math.max(za, zb), Math.min(ya, yb), Math.max(ya, yb), color);
  }
}
function stairsX(c, z, x0, x1, y0, y1, width, color) {
  const n = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.6));
  const run = Math.abs(x1 - x0) / n;
  const dir = x1 > x0 ? 1 : -1;
  color = color || COLORS.white;
  for (let i = 0; i < n; i++) {
    const xa = x0 + dir * run * i, xb = x0 + dir * run * (i + 1);
    const ya = y0 + (y1 - y0) * i / n, yb = y0 + (y1 - y0) * (i + 1) / n;
    slab(c, Math.min(xa, xb), z - width / 2, Math.max(xa, xb), z + width / 2, Math.min(ya, yb), Math.max(ya, yb), color);
  }
}

function railingEdge(c, x0, z0, x1, z1, yTop) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  if (alongX) {
    const zc = (z0 + z1) / 2;
    box(c, x0 - 0.2, yTop + 0.55, zc - 0.15, x1 + 0.2, yTop + 0.95, zc + 0.15, COLORS.white2, { fine: true, land: false });
    for (let x = x0; x <= x1 + 0.01; x += 2.6) {
      box(c, x - 0.32, yTop, zc - 0.32, x + 0.32, yTop + 1.05, zc + 0.32, COLORS.white, { fine: true, land: false });
    }
  } else {
    const xc = (x0 + x1) / 2;
    box(c, xc - 0.15, yTop + 0.55, z0 - 0.2, xc + 0.15, yTop + 0.95, z1 + 0.2, COLORS.white2, { fine: true, land: false });
    for (let z = z0; z <= z1 + 0.01; z += 2.6) {
      box(c, xc - 0.32, yTop, z - 0.32, xc + 0.32, yTop + 1.05, z + 0.32, COLORS.white, { fine: true, land: false });
    }
  }
}
function railingRect(c, x0, z0, x1, z1, yTop) {
  railingEdge(c, x0, z0, x1, z0, yTop);
  railingEdge(c, x0, z1, x1, z1, yTop);
  railingEdge(c, x0, z0, x0, z1, yTop);
  railingEdge(c, x1, z0, x1, z1, yTop);
}

function platform(c, x0, z0, x1, z1, baseY, yTop, tiers, inset, rail, opts) {
  tiers = tiers || 1; inset = inset || 3; rail = rail !== false;
  opts = opts || {};
  const h = (yTop - baseY) / tiers;
  for (let i = 0; i < tiers; i++) {
    const X0 = x0 + inset * i, X1 = x1 - inset * i, Z0 = z0 + inset * i, Z1 = z1 - inset * i;
    const y0 = baseY + h * i, y1 = y0 + h;
    const st = opts.stairs || [];
    let stairGap = null;
    for (let s = 0; s < st.length; s++) if (st[s].tier === i + 1) stairGap = st[s];
    if (stairGap && stairGap.side === 's') {
      slab(c, X0, Z0, stairGap.x - stairGap.w / 2, Z0 + 1.4, y0, y1, i % 2 ? COLORS.white : COLORS.white2, { jitter: 0.015 });
      slab(c, stairGap.x + stairGap.w / 2, Z0, X1, Z0 + 1.4, y0, y1, i % 2 ? COLORS.white : COLORS.white2, { jitter: 0.015 });
      slab(c, X0, Z0 + 1.4, X1, Z1, y0, y1, i % 2 ? COLORS.white : COLORS.white2, { jitter: 0.015 });
      stairsZ(c, stairGap.x, Z0 - 4.4, Z0, y1, y0 - h, stairGap.w);
    } else if (stairGap && stairGap.side === 'n') {
      slab(c, X0, Z0, X1, Z1 - 1.4, y0, y1, i % 2 ? COLORS.white : COLORS.white2, { jitter: 0.015 });
      slab(c, X0, Z1 - 1.4, stairGap.x - stairGap.w / 2, Z1, y0, y1, i % 2 ? COLORS.white : COLORS.white2, { jitter: 0.015 });
      slab(c, stairGap.x + stairGap.w / 2, Z1 - 1.4, X1, Z1, y0, y1, i % 2 ? COLORS.white : COLORS.white2, { jitter: 0.015 });
      stairsZ(c, stairGap.x, Z1, Z1 + 4.4, y1, y0 - h, stairGap.w);
    } else {
      slab(c, X0, Z0, X1, Z1, y0, y1, i % 2 ? COLORS.white : COLORS.white2, { jitter: 0.015 });
    }
    if (rail) railingRect(c, X0, Z0, X1, Z1, y1);
  }
  return yTop;
}

function bridge(c, x, z, len, width, deckY, baseY, color, rail) {
  color = color || COLORS.white;
  slab(c, x - width / 2, z - len / 2, x + width / 2, z + len / 2, deckY - 0.8, deckY, color);
  if (deckY - baseY > 1.0) {
    const n = Math.max(1, Math.round((deckY - baseY) / 0.6));
    stairsZ(c, x, z + len / 2, z + len / 2 + n * 1.8, baseY, deckY, width - 0.6, color);
    stairsZ(c, x, z - len / 2 - n * 1.8, z - len / 2, baseY, deckY, width - 0.6, color);
  }
  if (rail !== false) {
    railingEdge(c, x - width / 2, z - len / 2, x - width / 2, z + len / 2, deckY);
    railingEdge(c, x + width / 2, z - len / 2, x + width / 2, z + len / 2, deckY);
  }
}
function bridgeX(c, z, x0, x1, width, deckY, baseY, color) {
  color = color || COLORS.white;
  slab(c, x0, z - width / 2, x1, z + width / 2, deckY - 0.8, deckY, color);
  if (deckY - baseY > 1.0) {
    const n = Math.max(1, Math.round((deckY - baseY) / 0.6));
    stairsX(c, z, x1, x1 + n * 1.8, baseY, deckY, width - 0.6, color);
    stairsX(c, z, x0 - n * 1.8, x0, baseY, deckY, width - 0.6, color);
  }
  railingEdge(c, x0, z - width / 2, x1, z - width / 2, deckY);
  railingEdge(c, x0, z + width / 2, x1, z + width / 2, deckY);
}

function lion(c, x, z, baseY, dir) {
  dir = dir || 1;
  slab(c, x - 1.5, z - 1.1, x + 1.5, z + 1.1, baseY, baseY + 0.7, COLORS.white2);
  const y = baseY + 0.7;
  box(c, x - 1.05, y, z - 0.5, x + 1.05, y + 1.15, z + 0.5, COLORS.bronze, { land: false });
  box(c, x - 0.5, y + 1.15, z - 0.35, x + 0.45, y + 1.85, z + 0.35, COLORS.bronze2, { land: false });
  box(c, x - 0.15, y + 1.85, z - 0.12, x + 0.25, y + 2.0, z + 0.12, COLORS.bronze, { land: false });
  box(c, x + dir * 0.4, y + 0.05, z - dir * 0.15, x + dir * 0.75, y + 0.45, z + dir * 0.2, COLORS.bronze2, { land: false });
}

function huabiao(c, x, z, baseY) {
  slab(c, x - 1.3, z - 1.3, x + 1.3, z + 1.3, baseY, baseY + 1.4, COLORS.white2);
  box(c, x - 0.65, baseY + 1.4, z - 0.65, x + 0.65, baseY + 10, z + 0.65, COLORS.white, { land: false });
  box(c, x - 2.7, baseY + 8.2, z - 0.45, x + 2.7, baseY + 9.0, z + 0.45, COLORS.white, { land: false });
  slab(c, x - 1.15, z - 1.15, x + 1.15, z + 1.15, baseY + 10, baseY + 10.6, COLORS.white2);
  box(c, x - 0.5, baseY + 10.6, z - 0.5, x + 0.5, baseY + 11.4, z + 0.5, COLORS.gold, { land: false });
}

function vat(c, x, z, baseY) {
  box(c, x - 1.0, baseY, z - 1.0, x + 1.0, baseY + 1.3, z + 1.0, COLORS.bronze2, { jitter: 0.05, land: false });
  box(c, x - 1.1, baseY + 1.3, z - 1.1, x + 1.1, baseY + 1.55, z + 1.1, COLORS.bronze, { land: false });
}
function sundial(c, x, z, baseY) {
  slab(c, x - 1.1, z - 1.1, x + 1.1, z + 1.1, baseY, baseY + 0.7, COLORS.white2);
  box(c, x - 0.7, baseY + 0.7, z - 0.7, x + 0.7, baseY + 2.0, z + 0.7, COLORS.white, { land: false });
  box(c, x - 0.9, baseY + 2.0, z - 0.15, x + 0.9, baseY + 2.7, z + 0.15, COLORS.bronze, { rot: [-0.7, 0, 0], land: false });
}
function craneTurtle(c, x, z, baseY) {
  box(c, x - 0.8, baseY, z - 0.9, x + 0.8, baseY + 1.0, z + 0.9, COLORS.bronze, { land: false });
  box(c, x - 0.45, baseY + 1.0, z - 0.45, x + 0.45, baseY + 2.4, z + 0.45, COLORS.bronze2, { land: false });
  box(c, x - 0.35, baseY + 2.4, z - 0.6, x + 0.55, baseY + 3.0, z + 0.1, COLORS.bronze, { land: false });
}

function tree(c, x, z, baseY, s, kind) {
  s = s || 1;
  const th = 3.4 * s;
  box(c, x - 0.45 * s, baseY, z - 0.45 * s, x + 0.45 * s, baseY + th, z + 0.45 * s, COLORS.trunk, { jitter: 0.09, land: false });
  if (kind === 'cypress') {
    box(c, x - 0.95 * s, baseY + th * 0.25, z - 0.95 * s, x + 0.95 * s, baseY + th * 0.25 + 6.5 * s, z + 0.95 * s, COLORS.tree1, { jitter: 0.08, land: false });
  } else if (kind === 'autumn') {
    box(c, x - 1.8 * s, baseY + th, z - 1.8 * s, x + 1.8 * s, baseY + th + 2.2 * s, z + 1.8 * s, COLORS.autumn, { jitter: 0.07, land: false });
    box(c, x - 1.2 * s, baseY + th + 2.0 * s, z - 1.2 * s, x + 1.2 * s, baseY + th + 3.6 * s, z + 1.2 * s, COLORS.autumn, { jitter: 0.07, land: false });
  } else {
    box(c, x - 1.75 * s, baseY + th, z - 1.75 * s, x + 1.75 * s, baseY + th + 2.1 * s, z + 1.75 * s, COLORS.tree1, { jitter: 0.08, land: false });
    box(c, x - 1.15 * s, baseY + th + 1.9 * s, z - 1.15 * s, x + 1.15 * s, baseY + th + 3.5 * s, z + 1.15 * s, COLORS.tree2, { jitter: 0.08, land: false });
    box(c, x - 0.7 * s, baseY + th + 3.3 * s, z - 0.7 * s, x + 0.7 * s, baseY + th + 4.3 * s, z + 0.7 * s, COLORS.tree3, { jitter: 0.08, land: false });
  }
}
function rockery(c, x, z, baseY, r, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
    const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
    const s = 1.2 + Math.random() * 1.8, sy = 0.8 + Math.random() * 1.6;
    const py = baseY + (r - rr) * 0.55 * (0.4 + Math.random());
    box(c, px - s / 2, py - sy / 2, pz - s / 2, px + s / 2, py + sy / 2, pz + s / 2, Math.random() > 0.5 ? COLORS.rock1 : COLORS.rock2, { jitter: 0.06 });
  }
}

function pavilion(c, x, z, size, colH, roofH, color, baseY) {
  baseY = baseY !== undefined ? baseY : G_IN;
  slab(c, x - size / 2 - 1, z - size / 2 - 1, x + size / 2 + 1, z + size / 2 + 1, baseY, baseY + 0.5, COLORS.white2);
  const hw = size / 2 - 0.8;
  const cps = [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]];
  for (const [dx, dz] of cps) {
    box(c, x + dx - 0.4, baseY + 0.5, z + dz - 0.4, x + dx + 0.4, baseY + 0.5 + colH, z + dz + 0.4, COLORS.column, { land: false });
  }
  pyramidRoof(c, x, z, baseY + 0.5 + colH, size + 1.5, size + 1.5, roofH, color || COLORS.roofGreen);
}
function octagonPavilion(c, x, z, r, colH, roofH, color, baseY) {
  baseY = baseY !== undefined ? baseY : G_IN;
  slab(c, x - r - 1.5, z - r - 1.5, x + r + 1.5, z + r + 1.5, baseY, baseY + 0.6, COLORS.white2);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + Math.PI / 8;
    box(c, x + Math.cos(a) * r - 0.35, baseY + 0.6, z + Math.sin(a) * r - 0.35, x + Math.cos(a) * r + 0.35, baseY + 0.6 + colH, z + Math.sin(a) * r + 0.35, COLORS.column, { land: false });
  }
  pyramidRoof(c, x, z, baseY + 0.6 + colH, r * 2 + 2, r * 2 + 2, roofH, color || COLORS.roofGreen);
}

function cornerTower(c, x, z) {
  slab(c, x - 9, z - 9, x + 9, z + 9, 12.5, 15.2, COLORS.white2);
  box(c, x - 4, 15.2, z - 4, x + 4, 22, z + 4, COLORS.wall, { jitter: 0.02 });
  box(c, x - 1.6, 15.2, z - 7.2, x + 1.6, 22, z - 4, COLORS.wall, { jitter: 0.02 });
  box(c, x - 1.6, 15.2, z + 4, x + 1.6, 22, z + 7.2, COLORS.wall, { jitter: 0.02 });
  box(c, x - 7.2, 15.2, z - 1.6, x - 4, 22, z + 1.6, COLORS.wall, { jitter: 0.02 });
  box(c, x + 4, 15.2, z - 1.6, x + 7.2, 22, z + 1.6, COLORS.wall, { jitter: 0.02 });
  for (let i = 0; i < 6; i++) {
    const bx = x - 3 + i * 1.2;
    box(c, bx - 0.3, 16.5, z - 4.2, bx + 0.3, 21, z - 3.4, COLORS.gold, { fine: true, land: false });
    box(c, bx - 0.3, 16.5, z + 3.4, bx + 0.3, 21, z + 4.2, COLORS.gold, { fine: true, land: false });
  }
  const y1 = hipRoof(c, x, z, 22, 17, 17, 3.2, COLORS.roof, 3);
  const y2 = hipRoof(c, x, z, y1 + 0.2, 12.5, 12.5, 2.6, COLORS.roof, 3);
  const y3 = pyramidRoof(c, x, z, y2 + 0.2, 6.5, 6.5, 3.4, COLORS.roof);
  box(c, x - 3.2, 22, z - 9, x + 3.2, 24.6, z - 5.5, COLORS.roofAlt, { jitter: 0.02 });
  box(c, x - 3.2, 22, z + 5.5, x + 3.2, 24.6, z + 9, COLORS.roofAlt, { jitter: 0.02 });
  box(c, x - 9, 22, z - 3.2, x - 5.5, 24.6, z + 3.2, COLORS.roofAlt, { jitter: 0.02 });
  box(c, x + 5.5, 22, z - 3.2, x + 9, 24.6, z + 3.2, COLORS.roofAlt, { jitter: 0.02 });
  return y3;
}

function screenWall(c, x, z, w, y0, y1, dir, color) {
  box(c, x - w / 2, y0, z - 0.7, x + w / 2, y1, z + 0.7, COLORS.stone, { jitter: 0.02 });
  box(c, x - w / 2 + 0.3, y0 + 0.5, z - dir * 0.05, x + w / 2 - 0.3, y1 - 0.4, z - dir * 0.95, color, { jitter: 0.02 });
  box(c, x - w / 2 + 0.3, y1 - 0.7, z - 0.6, x + w / 2 - 0.3, y1 - 0.2, z + 0.6, COLORS.roofGreen);
}
function dragonScreen(c, x, z, w) {
  const y0 = G_IN, y1 = G_IN + 6.6;
  screenWall(c, x, z, w, y0, y1, -1, 0x2e6e46);
  const dw = (w - 7) / 8;
  for (let k = 0; k < 9; k++) {
    const dx = x - w / 2 + 3.5 + k * dw;
    dragon(c, dx, z - 1.0, y0 + 1.2, y1 - 0.9);
  }
  box(c, x - w / 2 + 0.3, y1 - 0.75, z - 0.65, x + w / 2 - 0.3, y1 - 0.35, z + 0.65, COLORS.roof);
  for (let bx = x - w / 2 + 1; bx < x + w / 2 - 1; bx += 2.5) {
    box(c, bx - 0.3, y1 - 0.4, z - 0.65, bx + 0.3, y1 - 0.1, z + 0.65, COLORS.gold, { fine: true, land: false });
  }
}
function dragon(c, x, z, y0, y1) {
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const dx = Math.sin(t * Math.PI * 2.2) * 0.9;
    const dy = (y1 - y0) * (0.5 + 0.42 * Math.sin(t * Math.PI * 1.8));
    const s = 0.85 - t * 0.3;
    box(c, x + dx - s / 2, y0 + dy - s / 2, z - 0.12, x + dx + s / 2, y0 + dy + s / 2, z + 0.12, COLORS.gold, { fine: true, land: false });
  }
  box(c, x - 0.4, y1 - 0.4, z - 0.15, x + 0.6, y1 + 0.1, z + 0.15, COLORS.gold, { fine: true, land: false });
}

function wallSection(c, x0, z0, x1, z1, y0, y1, color, cap) {
  const SEG = 64;
  const w = x1 - x0, d = z1 - z0;
  const nx = Math.max(1, Math.ceil(w / SEG)), nz = Math.max(1, Math.ceil(d / SEG));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    box(c, x0 + w * i / nx, y0, z0 + d * j / nz, x0 + w * (i + 1) / nx, y1, z0 + d * (j + 1) / nz, color, { jitter: 0.03 });
  }
  if (cap) box(c, x0 - 0.2, y1 - 0.5, z0 - 0.2, x1 + 0.2, y1, z1 + 0.2, cap);
}

// ---------------- 景点标注 ----------------
export const LANDMARKS = [];
function lm(name, group, x, y, z, desc, d, h, a, r) {
  LANDMARKS.push({ name, group, x, y, z, desc, cam: { d: d || 110, h: h || 40, a: a || 180 }, r: r || 30 });
}

// ---------------- 主构建 ----------------
export function buildCity() {
  LANDMARKS.length = 0;
  const c = createCtx();
  const A = c;

  // ======= 1. 地面 =======
  groundPlate(A, -374.5, -480.5, 374.5, 480.5, G_IN, COLORS.brick, { jitter: 0.04 });
  plate(A, -470, -955, 470, -892, G_CORR, COLORS.stone, { jitter: 0.03 });   // 午门前廊道(金水河南)
  plate(A, -470, -858, 470, -700, G_CORR, COLORS.stone, { jitter: 0.03 });   // 午门前廊道(金水河北)
  plate(A, -480, -680, 480, -535, G_CORR, COLORS.stone, { jitter: 0.03 });   // 城前广场

  // ======= 2. 宫墙与护城河 =======
  wallSection(A, -378.5, -484.5, -15, -480.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, -5, -484.5, -2.5, -480.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 2.5, -484.5, 5, -480.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 15, -484.5, 378.5, -480.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, -378.5, 480.5, -16.5, 484.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, -11.5, 480.5, -2.5, 484.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 2.5, 480.5, 11.5, 484.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 16.5, 480.5, 378.5, 484.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, -378.5, -480.5, -374.5, -16.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, -378.5, -11.5, -374.5, -2.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, -378.5, 2.5, -374.5, 11.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, -378.5, 16.5, -374.5, 480.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 374.5, -480.5, 378.5, -16.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 374.5, -11.5, 378.5, -2.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 374.5, 2.5, 378.5, 11.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  wallSection(A, 374.5, 16.5, 378.5, 480.5, G_IN, 12.5, COLORS.cityWall, COLORS.roof);
  for (let x = -376; x <= 376; x += 3.1) {
    box(A, x - 0.45, 12.5, -483.3, x + 0.45, 13.7, -482.3, COLORS.merlon, { land: false });
    box(A, x - 0.45, 12.5, 482.3, x + 0.45, 13.7, 483.3, COLORS.merlon, { land: false });
  }
  for (let z = -478; z <= 478; z += 3.1) {
    box(A, -383.3, 12.5, z - 0.45, -382.3, 13.7, z + 0.45, COLORS.merlon, { land: false });
    box(A, 382.3, 12.5, z - 0.45, 383.3, 13.7, z + 0.45, COLORS.merlon, { land: false });
  }
  // 护城河两岸护坡
  slab(A, -378.5, -487.5, 378.5, -486.2, G_OUT, 0.7, COLORS.stone2);
  slab(A, -378.5, -486.2, 378.5, -484.9, 0.7, 1.4, COLORS.stone);
  slab(A, -378.5, 484.9, 378.5, 486.2, 0.7, 1.4, COLORS.stone);
  slab(A, -378.5, 486.2, 378.5, 487.5, G_OUT, 0.7, COLORS.stone2);
  slab(A, -378.5, -540, 378.5, -538.6, G_OUT, 0.5, COLORS.stone2);
  slab(A, -378.5, -538.6, 378.5, -537.2, 0.5, 0.9, COLORS.stone2);
  slab(A, -378.5, 537.2, 378.5, 538.6, 0.5, 0.9, COLORS.stone2);
  slab(A, -378.5, 538.6, 378.5, 540, G_OUT, 0.5, COLORS.stone2);
  slab(A, -487.5, -484.5, -486.2, 484.5, G_OUT, 0.7, COLORS.stone2);
  slab(A, -486.2, -484.5, -484.9, 484.5, 0.7, 1.4, COLORS.stone);
  slab(A, 484.9, -484.5, 486.2, 484.5, 0.7, 1.4, COLORS.stone);
  slab(A, 486.2, -484.5, 487.5, 484.5, G_OUT, 0.7, COLORS.stone2);
  slab(A, -540, -484.5, -538.6, 484.5, G_OUT, 0.5, COLORS.stone2);
  slab(A, -538.6, -484.5, -537.2, 484.5, 0.5, 0.9, COLORS.stone2);
  slab(A, 537.2, -484.5, 538.6, 484.5, 0.5, 0.9, COLORS.stone2);
  slab(A, 538.6, -484.5, 540, 484.5, G_OUT, 0.5, COLORS.stone2);
  // 四角角楼
  cornerTower(A, -376.5, -482.5); cornerTower(A, 376.5, -482.5);
  cornerTower(A, -376.5, 482.5); cornerTower(A, 376.5, 482.5);
  lm('角楼', '城门与防御', 376.5, 16, 482.5, '城墙四角望楼,十字脊三重檐,九梁十八柱七十二条脊,紫禁城的标志性绝景。', 95, 45, 215, 40);

  // 城门前石桥(跨护城河)
  bridge(A, 0, -512.5, 53, 14, 1.4, G_OUT, COLORS.stone);
  bridge(A, 0, 512.5, 53, 14, 1.4, G_OUT, COLORS.stone);
  bridgeX(A, -30, 393, 449, 12, 1.2, G_OUT, COLORS.stone);
  bridgeX(A, -30, -449, -393, 12, 1.2, G_OUT, COLORS.stone);

  // ======= 3. 南端:天安门 → 端门 → 午门 =======
  // 外金水河(五桥)
  bridge(A, -60, -880, 18, 9, 1.2, G_CORR, COLORS.white);
  bridge(A, -30, -880, 18, 9, 1.2, G_CORR, COLORS.white);
  bridge(A, 0, -880, 18, 12, 1.2, G_CORR, COLORS.white);
  bridge(A, 30, -880, 18, 9, 1.2, G_CORR, COLORS.white);
  bridge(A, 60, -880, 18, 9, 1.2, G_CORR, COLORS.white);
  slab(A, -228, -892, -220, -858, -0.3, 0.3, COLORS.stone2);
  slab(A, 220, -892, 228, -858, -0.3, 0.3, COLORS.stone2);
  slab(A, -220, -892, 220, -886, -0.3, 0.3, COLORS.stone2);
  slab(A, -220, -864, 220, -858, -0.3, 0.3, COLORS.stone2);
  // 天安门
  {
    const z = -920, d2 = 18;
    const gaps = [[-42, -31.5], [-14, -7], [-3.5, 3.5], [7, 14], [31.5, 42]];
    slab(A, -59, z - d2, -42, z + d2, G_CORR, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, -31.5, z - d2, -14, z + d2, G_CORR, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, -7, z - d2, -3.5, z + d2, G_CORR, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, 3.5, z - d2, 7, z + d2, G_CORR, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, 14, z - d2, 31.5, z + d2, G_CORR, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, 42, z - d2, 59, z + d2, G_CORR, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, -59, z - d2, 59, z + d2, 0, 3, COLORS.white2);
    hall(A, { x: 0, z, w: 62, d: 24, floorY: 12, wallH: 10, bays: 9, doorBays: [2, 3, 4, 5, 6], doorBoth: true, roofType: 'double', roofH: 11, lanterns: true, dougong: true, tower: true });
    for (let i = 0; i < 9; i++) windowPanel(A, -31 + i * 7.75, 12, z + 12, 'z', 1, 4, 10);
    // 门洞(最后下挖,保证屋顶/城楼不堵门)
    for (const [g0, g1] of gaps) {
      slab(A, g0, z - d2, g1, z + d2, G_CORR, G_CORR + 0.4, COLORS.stone2, { land: false });
      A.hm.set(g0, z - d2, g1, z + d2, G_CORR + 0.4);
      doorPanel(A, (g0 + g1) / 2, G_CORR, z - d2, 'z', -1, g1 - g0 - 1, 9);
      doorPanel(A, (g0 + g1) / 2, G_CORR, z + d2, 'z', 1, g1 - g0 - 1, 9);
    }
    box(A, -59, 0, z - 18.4, 59, 0.8, z - 17.4, COLORS.white2);
    huabiao(A, -86, z - 14, G_CORR); huabiao(A, -78, z - 14, G_CORR);
    huabiao(A, 78, z - 14, G_CORR); huabiao(A, 86, z - 14, G_CORR);
    lion(A, -33, z - 24, G_CORR, 1); lion(A, 33, z - 24, G_CORR, -1);
    lm('天安门', '中轴线', 0, 12, z, '明清皇城正门,重檐城楼五座门洞,前有外金水河、石狮与华表。', 130, 50, 180, 60);
  }
  // 端门
  {
    const z = -700, d2 = 15;
    const gaps = [[-28, -22], [-7, 7], [22, 28]];
    slab(A, -50, z - d2, -28, z + d2, G_CORR, 10, COLORS.wall, { jitter: 0.02 });
    slab(A, -22, z - d2, -7, z + d2, G_CORR, 10, COLORS.wall, { jitter: 0.02 });
    slab(A, 7, z - d2, 22, z + d2, G_CORR, 10, COLORS.wall, { jitter: 0.02 });
    slab(A, 28, z - d2, 50, z + d2, G_CORR, 10, COLORS.wall, { jitter: 0.02 });
    hall(A, { x: 0, z, w: 50, d: 20, floorY: 10, wallH: 9, bays: 7, doorBays: [2, 3, 4], doorBoth: true, roofType: 'hip', roofH: 8, lanterns: true, tower: true });
    for (const [g0, g1] of gaps) {
      slab(A, g0, z - d2, g1, z + d2, G_CORR, G_CORR + 0.4, COLORS.stone2, { land: false });
      A.hm.set(g0, z - d2, g1, z + d2, G_CORR + 0.4);
      doorPanel(A, (g0 + g1) / 2, G_CORR, z - d2, 'z', -1, g1 - g0 - 1, 8);
      doorPanel(A, (g0 + g1) / 2, G_CORR, z + d2, 'z', 1, g1 - g0 - 1, 8);
    }
    lm('端门', '中轴线', 0, 10, z, '午门前的礼仪之门,形制仿天安门,朝廷大典的仪仗集结地。', 115, 42, 180, 55);
  }
  // 阙左门/阙右门
  hall(A, { x: 130, z: -640, w: 22, d: 14, floorY: G_CORR, wallH: 5, bays: 3, doorBays: [1], doorBoth: true, roofType: 'hip', roofH: 5, roofColor: COLORS.roofGreen });
  hall(A, { x: -130, z: -640, w: 22, d: 14, floorY: G_CORR, wallH: 5, bays: 3, doorBays: [1], doorBoth: true, roofType: 'hip', roofH: 5, roofColor: COLORS.roofGreen });
  // 午门
  {
    const gaps = [[-15, -5], [-2.5, 2.5], [5, 15]];
    // 城台实体(门洞之间的部分)
    slab(A, -65, -486, -15, -451, G_IN, 14, COLORS.wall, { jitter: 0.02 });
    slab(A, -5, -486, -2.5, -451, G_IN, 14, COLORS.wall, { jitter: 0.02 });
    slab(A, 2.5, -486, 5, -451, G_IN, 14, COLORS.wall, { jitter: 0.02 });
    slab(A, 15, -486, 65, -451, G_IN, 14, COLORS.wall, { jitter: 0.02 });
    // 两翼(雁翅楼)
    for (const s of [-1, 1]) {
      const xw = 48 * s;
      slab(A, xw - 6.5, -450, xw + 6.5, -408, G_IN, 14, COLORS.wall, { jitter: 0.02 });
      box(A, xw - 3.5, 14, -443, xw + 3.5, 19, -435, COLORS.wall, { jitter: 0.02 });
      hipRoof(A, xw, -439, 19, 9, 9, 4.2, COLORS.roof, 3);
      box(A, xw - 5, 14, -426, xw + 5, 19.5, -416, COLORS.wall, { jitter: 0.02 });
      pyramidRoof(A, xw, -421, 19.5, 11.5, 11.5, 5.5, COLORS.roof);
    }
    // 主楼
    hall(A, { x: 0, z: -460, w: 60, d: 22, floorY: 14, wallH: 11, bays: 9, doorBays: [2, 3, 4, 5, 6], doorBoth: true, roofType: 'double', roofH: 12, lanterns: true, dougong: true });
    for (let i = 0; i < 9; i++) windowPanel(A, -30 + i * 7.5, 14, -449, 'z', 1, 4, 11);
    for (let i = 0; i < 9; i++) windowPanel(A, -30 + i * 7.5, 14, -471, 'z', -1, 4, 11);
    railingEdge(A, -65, -486, 65, -486, 14); railingEdge(A, -65, -451, 65, -451, 14);
    railingEdge(A, -65, -486, -65, -451, 14); railingEdge(A, 65, -486, 65, -451, 14);
    // 门洞与掖门(最后下挖,保证城楼与屋顶不堵门)
    for (const [g0, g1] of gaps) {
      slab(A, g0, -486, g1, -451, G_CORR, G_IN + 0.4, COLORS.stone2, { land: false });
      A.hm.set(g0, -486, g1, -451, G_IN);
      doorPanel(A, (g0 + g1) / 2, G_IN, -486, 'z', -1, g1 - g0 - 1, 11);
    }
    for (const s of [-1, 1]) {
      const xw = 48 * s;
      slab(A, xw - 2.6, -452, xw + 2.6, -446, G_IN, G_IN + 0.4, COLORS.stone2, { land: false });
      A.hm.set(xw - 2.6, -452, xw + 2.6, -446, G_IN);
      doorPanel(A, xw, G_IN, xw - s * 2.6, 'x', -s, 5, 9);
    }
    lm('午门', '中轴线', 0, 14, -455, '紫禁城正门,凹字形城台,五座门洞;正中门洞为皇帝专用,两侧掖门供百官出入。', 140, 60, 180, 75);
  }
  // 午门内广场
  groundPlate(A, -65, -445, 65, -330, G_IN, COLORS.stone, { jitter: 0.03 });
  brickLines(A, -65, -445, 65, -330, G_IN, 6);
  groundPlate(A, -2.6, -445, 2.6, -330, G_IN, COLORS.stone2);
  bridge(A, -24, -417, 20, 8, 3, G_IN, COLORS.white);
  bridge(A, -12, -417, 20, 8, 3, G_IN, COLORS.white);
  bridge(A, 0, -417, 20, 10, 3, G_IN, COLORS.white);
  bridge(A, 12, -417, 20, 8, 3, G_IN, COLORS.white);
  bridge(A, 24, -417, 20, 8, 3, G_IN, COLORS.white);
  lm('内金水桥', '中轴线', 0, 2, -417, '内金水河自宫墙西北引入,蜿蜒如弓横贯太和门前,上跨五座汉白玉石桥。', 120, 55, 0, 60);

  // 太和门及两翼门
  {
    plate(A, -30, -352, 30, -338, 4.5, COLORS.white);
    stairsZ(A, 0, -357, -352, G_IN, 4.5, 14, COLORS.white);
    stairsZ(A, 0, -333, -338, G_IN, 4.5, 14, COLORS.white);
    hall(A, { x: 0, z: -345, w: 54, d: 24, floorY: 4.5, wallH: 9, bays: 9, doorBays: [3, 4, 5], doorBoth: true, roofType: 'double', roofH: 10, lanterns: true, dougong: true });
    for (const gx of [-80, 80, -160, 160]) {
      slab(A, gx - 9, -348.5, gx + 9, -341.5, 2, 3, COLORS.wall);
      box(A, gx - 0.5, 3, -347, gx + 0.5, 8, -343, COLORS.column, { land: false });
      box(A, gx - 0.5, 3, -343, gx + 0.5, 8, -342, COLORS.column, { land: false });
      doorPanel(A, gx, 3, -348.5, 'z', -1, 9, 5); doorPanel(A, gx, 3, -341.5, 'z', 1, 9, 5);
      hipRoof(A, gx, -345, 8, 17, 9, 4.5, COLORS.roof, 3);
    }
    wallSection(A, -214, -348.5, -169, -341.5, 2, 7, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 169, -348.5, 214, -341.5, 2, 7, COLORS.wall, COLORS.roofGreen);
    wallSection(A, -89, -348.5, -71, -341.5, 2, 7, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 71, -348.5, 89, -341.5, 2, 7, COLORS.wall, COLORS.roofGreen);
    lion(A, -31, -358, G_IN, 1); lion(A, 31, -358, G_IN, -1);
    lm('太和门', '中轴线', 0, 4.5, -345, '前朝正门,九间重檐歇山顶,明代皇帝在此"御门听政"。', 105, 40, 180, 60);
  }

  // ======= 4. 三大殿 =======
  {
    const st = [];
    for (let t = 1; t <= 3; t++) st.push({ tier: t, side: 's', x: 0, w: 14 }, { tier: t, side: 'n', x: 0, w: 14 });
    platform(A, -70, -285, 70, -85, G_IN, 9.5, 3, 5, true, { stairs: st });
    for (let t = 0; t < 3; t++) {
      const y0 = G_IN + t * 2.5, y1 = y0 + 2.5, z0 = -285 + t * 5 - 4.5;
      const len = 4.6;
      box(A, -3.2, (y0 + y1) / 2 - 0.2, z0 - len / 2 + 0.5, 3.2, (y0 + y1) / 2 + 0.15, z0 + len / 2 + 0.5, COLORS.rampGold, { rot: [-Math.atan2(2.5, len), 0, 0], land: false });
      for (let i = 0; i <= len; i++) A.hm.fill(-3.2, z0 + i - 0.5, 3.2, z0 + i + 0.5, y0 + (y1 - y0) * i / len);
    }
  }
  // 太和殿前广场(金砖墁地 + 御路)与三台两侧台阶
  groundPlate(A, -140, -330, 140, -285, G_IN, COLORS.brick, { jitter: 0.04 });
  brickLines(A, -140, -330, 140, -285, G_IN, 6);
  groundPlate(A, -2.6, -330, 2.6, -285, G_IN, COLORS.stone2);
  stairsX(A, -242, 70, 74, G_IN, 4.5, 9, COLORS.white);
  stairsX(A, -242, -74, -70, G_IN, 4.5, 9, COLORS.white);
  groundPlate(A, -60, -92, 60, -77, G_IN, COLORS.brick, { jitter: 0.04 });
  hall(A, { x: 0, z: -242, w: 64, d: 38, floorY: 9.5, wallH: 12, bays: 11, doorBays: [2, 3, 4, 5, 6, 7, 8], roofType: 'double', roofH: 12.5, lanterns: true, dougong: true });
  for (let i = 0; i < 11; i++) {
    if ([2, 3, 4, 5, 6, 7, 8].indexOf(i) < 0) windowPanel(A, -32 + i * 6.4, 9.5, -223, 'z', 1, 4.4, 12);
  }
  craneTurtle(A, -35, -272, 9.5); craneTurtle(A, -27, -272, 9.5);
  craneTurtle(A, 35, -272, 9.5); craneTurtle(A, 27, -272, 9.5);
  sundial(A, 30, -278, 4.5);
  box(A, -32, 4.5, -279, -29.4, 6.2, -276.4, COLORS.bronze);
  box(A, -31.6, 6.2, -278.6, -29.8, 7.0, -276.8, COLORS.bronze2);
  lm('太和殿', '中轴线', 0, 9.5, -242, '俗称金銮殿,紫禁城最高大的宫殿:十一间重檐庑殿顶,坐三层汉白玉须弥座上。登基、大婚、册封等大典之所。', 140, 60, 150, 55);
  hall(A, { x: 0, z: -169, w: 25, d: 25, floorY: 9.5, wallH: 7.5, bays: 5, doorBays: [2], roofType: 'pyramid', roofH: 7.5 });
  lm('中和殿', '中轴线', 0, 9.5, -169, '四角攒尖顶方殿,大典前皇帝在此休息受贺。', 90, 40, 150, 35);
  hall(A, { x: 0, z: -114, w: 56, d: 26, floorY: 9.5, wallH: 11, bays: 9, doorBays: [2, 3, 4, 5, 6], roofType: 'double', roofH: 11, lanterns: true, dougong: true });
  {
    const y0 = 9.5, len = 9;
    box(A, -3.5, y0 - 0.15, -99 - len / 2, 3.5, y0 + 0.2, -99 + len / 2, COLORS.rampGold, { rot: [-Math.atan2(2.5, len), 0, 0], land: false });
    for (let i = 0; i <= len; i++) A.hm.fill(-3.5, -99 - len / 2 + i - 0.5, 3.5, -99 - len / 2 + i + 0.5, y0 - 2.5 * i / len + 0.1);
  }
  lm('保和殿', '中轴线', 0, 9.5, -114, '重檐歇山顶,殿试与盛大宴会之所;北面云龙大石雕是故宫最大石雕。', 115, 45, 150, 45);
  for (const s of [-1, 1]) {
    const x = 100 * s;
    slab(A, x - 11, -316, x + 11, -294, G_IN, 4, COLORS.white2);
    stairsZ(A, x, -319.6, -316, G_IN, 4, 8, COLORS.white);
    box(A, x - 6, 4, -311, x + 6, 13, -299, COLORS.wall, { jitter: 0.02 });
    box(A, x - 7.5, 13, -312.5, x + 7.5, 14, -297.5, COLORS.roofUnder);
    hipRoof(A, x, -305, 14, 17, 17, 4.6, COLORS.roof, 3);
    doorPanel(A, x, 4, -311, 'z', -1, 5, 9);
  }
  lm('体仁阁', '前朝两翼', 100, 5, -305, '太和殿广场东侧楼阁,内务府库房,重楼庑殿顶。', 95, 40, 150, 30);
  lm('弘义阁', '前朝两翼', -100, 5, -305, '太和殿广场西侧楼阁,与体仁阁遥相对称。', 95, 40, 210, 30);

  // ======= 5. 内廷:乾清门 → 后三宫 =======
  wallSection(A, -214, -75, -169, -69, 2, 7, COLORS.wall, COLORS.roofGreen);
  wallSection(A, 169, -75, 214, -69, 2, 7, COLORS.wall, COLORS.roofGreen);
  wallSection(A, -150, -75, -98, -69, 2, 7, COLORS.wall, COLORS.roofGreen);
  wallSection(A, 98, -75, 150, -69, 2, 7, COLORS.wall, COLORS.roofGreen);
  wallSection(A, -88, -75, -38, -69, 2, 7, COLORS.wall, COLORS.roofGreen);
  wallSection(A, 38, -75, 88, -69, 2, 7, COLORS.wall, COLORS.roofGreen);
  for (const gx of [-160, 160]) {
    slab(A, gx - 8, -76, gx + 8, -68, 2, 3, COLORS.wall);
    box(A, gx - 0.5, 3, -74, gx + 0.5, 7.5, -70, COLORS.column, { land: false });
    box(A, gx - 0.5, 3, -70, gx + 0.5, 7.5, -69.5, COLORS.column, { land: false });
    doorPanel(A, gx, 3, -75.5, 'z', -1, 8, 4.5); doorPanel(A, gx, 3, -68.5, 'z', 1, 8, 4.5);
    hipRoof(A, gx, -72, 7.5, 15, 9, 4, COLORS.roof, 3);
  }
  {
    slab(A, -21, -77, 21, -67, 2, 3.6, COLORS.white2);
    stairsZ(A, 0, -81.4, -77, G_IN, 3.6, 12, COLORS.white);
    stairsZ(A, 0, -67, -62.6, G_IN, 3.6, 12, COLORS.white);
    hall(A, { x: 0, z: -72, w: 40, d: 16, floorY: 3.6, wallH: 6.5, bays: 5, doorBays: [1, 2, 3], doorBoth: true, roofType: 'hip', roofH: 7, lanterns: true });
    screenWall(A, -30, -70, 12, 2, 7, -1, COLORS.wall);
    screenWall(A, 30, -70, 12, 2, 7, -1, COLORS.wall);
    lion(A, -15, -82, G_IN, 1); lion(A, 15, -82, G_IN, -1);
    lm('乾清门', '中轴线', 0, 4, -72, '内廷正门,清帝在此御门听政;门前一对鎏金铜狮,两侧八字影壁。', 95, 38, 180, 45);
  }
  {
    const st1 = [], st2 = [];
    for (let t = 1; t <= 2; t++) { st1.push({ tier: t, side: 's', x: 0, w: 12 }, { tier: t, side: 'n', x: 0, w: 12 }); }
    platform(A, -33, -40, 33, 4, G_IN, 6.5, 2, 4, true, { stairs: st1 });
    hall(A, { x: 0, z: -18, w: 52, d: 28, floorY: 6.5, wallH: 10, bays: 9, doorBays: [2, 3, 4, 5, 6], roofType: 'double', roofH: 11, lanterns: true, dougong: true });
    lm('乾清宫', '中轴线', 0, 6.5, -18, '内廷之首,明代与清初皇帝寝宫,后为召见臣工、批阅奏章之处。', 115, 45, 180, 45);
    slab(A, -15, 16, 15, 44, G_IN, 4, COLORS.white2);
    stairsZ(A, 0, 12.4, 16, G_IN, 4, 8, COLORS.white);
    stairsZ(A, 0, 47.6, 44, G_IN, 4, 8, COLORS.white);
    hall(A, { x: 0, z: 30, w: 24, d: 24, floorY: 4, wallH: 7, bays: 3, doorBays: [1], roofType: 'pyramid', roofH: 6.5 });
    lm('交泰殿', '中轴线', 0, 4, 30, '内廷中心方殿,存放"二十五宝",皇后在此受贺。', 80, 35, 180, 30);
    platform(A, -33, 62, 33, 106, G_IN, 6, 2, 4, true, { stairs: st2 });
    hall(A, { x: 0, z: 84, w: 50, d: 26, floorY: 6, wallH: 9.5, bays: 9, doorBays: [2, 3, 4, 5, 6], roofType: 'double', roofH: 10.5, lanterns: true });
    lm('坤宁宫', '中轴线', 0, 6, 84, '明代皇后寝宫;清代东间改为帝后大婚洞房,西间为萨满祭祀场所。', 110, 45, 180, 40);
  }
  {
    slab(A, -14, 106, 14, 114, G_IN, 3, COLORS.white2);
    hall(A, { x: 0, z: 110, w: 26, d: 12, floorY: 3, wallH: 5, bays: 3, doorBays: [1], doorBoth: true, roofType: 'hip', roofH: 5, roofColor: COLORS.roofGreen });
    lm('坤宁门', '中轴线', 0, 3, 110, '内廷后门,出此门即入御花园。', 70, 30, 180, 25);
  }

  // ======= 6. 御花园 =======
  {
    groundPlate(A, -55, 120, 55, 265, G_IN, COLORS.stone, { jitter: 0.03 });
    groundPlate(A, 0, 120, 3.5, 265, G_IN, COLORS.stone2);
    slab(A, -9, 142, 9, 150, G_IN, 3, COLORS.white2);
    hall(A, { x: 0, z: 146, w: 16, d: 10, floorY: 3, wallH: 4, bays: 3, doorBays: [1], doorBoth: true, roofType: 'hip', roofH: 4, roofColor: COLORS.roofGreen });
    slab(A, -17, 184, 17, 214, G_IN, 4.5, COLORS.white2);
    stairsZ(A, 0, 179.6, 184, G_IN, 4.5, 8, COLORS.white);
    hall(A, { x: 0, z: 199, w: 22, d: 16, floorY: 4.5, wallH: 7, bays: 5, doorBays: [2], roofType: 'double', roofH: 8.5, lanterns: true });
    lm('钦安殿', '中轴线', 0, 4.5, 199, '御花园主殿,重檐盝顶,内供真武大帝,是紫禁城中轴线上最北的宫殿。', 80, 32, 180, 30);
    octagonPavilion(A, 38, 168, 4.6, 4, 5.5, COLORS.roofGreen);
    octagonPavilion(A, -38, 168, 4.6, 4, 5.5, COLORS.roofGreen);
    pavilion(A, 30, 226, 5, 4, 4.5, COLORS.roofGreen, G_IN - 0.5);
    pavilion(A, -30, 226, 5, 4, 4.5, COLORS.roofGreen, G_IN - 0.5);
    hall(A, { x: -30, z: 248, w: 16, d: 10, floorY: G_IN, wallH: 5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 4.5, roofColor: COLORS.roofGreen });
    hall(A, { x: 30, z: 142, w: 18, d: 10, floorY: G_IN, wallH: 4.5, bays: 5, doorBays: [2], roofType: 'hip', roofH: 4, roofColor: COLORS.roofGreen });
    rockery(A, 32, 158, G_IN, 5.5, 70);
    pavilion(A, 32, 158, 5, 3, 4.5, COLORS.roofGreen, 10);
    slab(A, -10, 258, 10, 266, G_IN, 3, COLORS.wall);
    box(A, -0.5, 3, 260, 0.5, 8.5, 264, COLORS.column, { land: false });
    box(A, -0.5, 3, 261, 0.5, 8.5, 265, COLORS.column, { land: false });
    doorPanel(A, 0, 3, 258.5, 'z', -1, 8, 5); doorPanel(A, 0, 3, 265.5, 'z', 1, 8, 5);
    hipRoof(A, 0, 262, 8.5, 17, 10, 4, COLORS.roof, 3);
    const tps = [[-45, 130], [45, 130], [-48, 160], [48, 160], [-20, 175], [20, 178], [-10, 160], [10, 162], [-45, 205], [45, 205], [-20, 235], [20, 238], [-48, 240], [48, 240], [-35, 260], [35, 258], [15, 190], [-15, 192], [6, 240], [-6, 242], [40, 185], [-40, 185], [-50, 220], [50, 220], [-52, 140], [52, 140], [-8, 168], [8, 168], [-36, 150], [36, 150], [-25, 250], [25, 252]];
    for (const [tx, tz] of tps) tree(A, tx, tz, G_IN, 0.9 + Math.random() * 0.5, Math.random() > 0.6 ? 'cypress' : (Math.random() > 0.7 ? 'autumn' : null));
    rockery(A, -28, 160, G_IN, 4, 30);
    lm('御花园', '中轴线', 0, 3, 200, '紫禁城后花园,古柏参天,亭台错落,堆秀山为园中制高点。', 150, 70, 150, 70);
  }

  // ======= 7. 前朝两翼:文华殿、武英殿 =======
  for (const s of [-1, 1]) {
    const x = 210 * s, zh = -345;
    slab(A, x - 12, zh - 8, x + 12, zh + 8, G_IN, 3, COLORS.white2);
    hall(A, { x, z: zh, w: 22, d: 14, floorY: 3, wallH: 5, bays: 3, doorBays: [1], doorBoth: true, roofType: 'hip', roofH: 5 });
    slab(A, x - 22, -312, x + 22, -296, G_IN, 4, COLORS.white2);
    stairsZ(A, x, -316.4, -312, G_IN, 4, 9, COLORS.white);
    stairsZ(A, x, -291.6, -296, G_IN, 4, 9, COLORS.white);
    hall(A, { x, z: -304, w: 30, d: 20, floorY: 4, wallH: 7.5, bays: 7, doorBays: [2, 3, 4], roofType: 'hip', roofH: 7, lanterns: true });
    hall(A, { x, z: -268, w: 22, d: 15, floorY: G_IN, wallH: 6, bays: 5, doorBays: [2], roofType: 'hip', roofH: 5.5 });
    wallSection(A, x - 26, -322, x + 26, -316, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, x - 26, -256, x + 26, -250, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, x - 26, -316, x - 20, -250, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, x + 20, -316, x + 26, -250, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    tree(A, x - 18, -282, G_IN, 1.1, 'cypress'); tree(A, x + 18, -282, G_IN, 1.1, 'cypress');
    tree(A, x - 18, -305, G_IN, 1.0, 'cypress'); tree(A, x + 18, -305, G_IN, 1.0, 'cypress');
  }
  lm('文华殿', '前朝两翼', 210, 4, -304, '前朝东侧主殿,太子视事与经筵讲学之所,后殿主敬殿。', 90, 35, 180, 40);
  lm('武英殿', '前朝两翼', -210, 4, -304, '前朝西侧主殿,明末李自成在此登基;清代为修书刻书之处。', 90, 35, 180, 40);
  {
    slab(A, 186, -244, 234, -224, G_IN, 4, COLORS.white2);
    stairsZ(A, 210, -248.4, -244, G_IN, 4, 7, COLORS.white);
    hall(A, { x: 210, z: -234, w: 24, d: 15, floorY: 4, wallH: 6.5, bays: 5, doorBays: [2], roofType: 'hip', roofH: 6.5, roofColor: COLORS.roofBlack });
    lm('文渊阁', '前朝两翼', 210, 4, -234, '皇家藏书楼,黑色琉璃瓦顶,曾藏《四库全书》。', 80, 30, 180, 30);
  }
  hall(A, { x: -210, z: -232, w: 14, d: 10, floorY: G_IN, wallH: 4.5, bays: 3, doorBays: [1], roofType: 'pyramid', roofH: 4, roofColor: COLORS.roofBlack });
  bridge(A, -250, -332, 24, 8, 2.6, G_IN, COLORS.white);
  lm('断虹桥', '前朝两翼', -250, 2, -332, '武英殿西侧金水河上的元代石桥,故宫最古老的桥梁。', 70, 25, 0, 25);

  // ======= 8. 东西六宫 =======
  const palaceNames = {
    east: [['景仁宫', 88], ['承乾宫', 150], ['钟粹宫', 88], ['延禧宫', 150], ['永和宫', 88], ['景阳宫', 150]],
    west: [['永寿宫', -88], ['翊坤宫', -150], ['储秀宫', -88], ['长春宫', -150], ['咸福宫', -88], ['太极殿', -150]],
  };
  const compoundRowZ = [-42, 28, 98];
  const buildCompound = (x, z) => {
    wallSection(A, x - 27, z - 27, x + 27, z - 21, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, x - 27, z + 21, x + 27, z + 27, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, x - 27, z - 21, x - 21, z + 21, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, x + 21, z - 21, x + 27, z + 21, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    slab(A, x - 6, z - 27, x + 6, z - 19, G_IN, 3, COLORS.wall);
    doorPanel(A, x, 3, z - 26.5, 'z', -1, 7, 5);
    hipRoof(A, x, z - 23, 7, 10, 9, 3.6, COLORS.roof, 3);
    slab(A, x - 13, z - 2, x + 13, z + 12, G_IN, 2.8, COLORS.white2);
    hall(A, { x, z: z + 5, w: 20, d: 12, floorY: 2.8, wallH: 5.5, bays: 5, doorBays: [2], roofType: 'hip', roofH: 5 });
    hall(A, { x, z: z - 9, w: 14, d: 9, floorY: G_IN, wallH: 4.5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 4 });
    hall(A, { x: x - 16.5, z: z + 5, w: 11, d: 7, floorY: G_IN, wallH: 4, bays: 3, doorBays: [1], roofType: 'hip', roofH: 3.6 });
    hall(A, { x: x + 16.5, z: z + 5, w: 11, d: 7, floorY: G_IN, wallH: 4, bays: 3, doorBays: [1], roofType: 'hip', roofH: 3.6 });
    tree(A, x - 14, z - 15, G_IN, 0.8, 'cypress'); tree(A, x + 14, z - 15, G_IN, 0.8, 'cypress');
    vat(A, x - 8, z - 14, G_IN); vat(A, x + 8, z - 14, G_IN);
  };
  const eNames = [], wNames = [];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 2; col++) {
    const idx = r * 2 + col;
    const [en, ex] = palaceNames.east[idx];
    const [wn, wx] = palaceNames.west[idx];
    buildCompound(ex, compoundRowZ[r]);
    buildCompound(wx, compoundRowZ[r]);
    eNames.push(en); wNames.push(wn);
  }
  lm('东六宫', '内廷东路', 119, 3, 28, eNames.join('、') + '——后妃居住的六座宫院。', 160, 75, 90, 70);
  lm('西六宫', '内廷西路', -119, 3, 28, wNames.join('、') + '——后妃居住的六座宫院。', 160, 75, 270, 70);
  // 东西长街古柏
  for (let i = 0; i < 5; i++) {
    tree(A, 119, -30 + i * 32, G_IN, 0.9, 'cypress');
    tree(A, -119, -30 + i * 32, G_IN, 0.9, 'cypress');
  }

  // ======= 9. 内廷东路:奉先殿、斋宫、毓庆宫、箭亭 =======
  {
    wallSection(A, 196, -42, 254, -36, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 196, 24, 254, 30, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 196, -36, 202, 24, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 248, -36, 254, 24, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    slab(A, 210, -20, 240, 8, G_IN, 3.6, COLORS.white2);
    stairsZ(A, 225, -24.4, -20, G_IN, 3.6, 10, COLORS.white);
    hall(A, { x: 225, z: -6, w: 26, d: 18, floorY: 3.6, wallH: 7, bays: 5, doorBays: [1, 2, 3], roofType: 'double', roofH: 8.5 });
    hall(A, { x: 225, z: 12, w: 18, d: 11, floorY: G_IN, wallH: 5.5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 5 });
    lm('奉先殿', '内廷东路', 225, 4, -6, '皇室家庙,前殿后殿规制,祭祀历代帝后神位。', 90, 35, 180, 35);
    wallSection(A, 258, -30, 300, -24, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 258, 22, 300, 28, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 258, -24, 264, 22, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 294, -24, 300, 22, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    hall(A, { x: 279, z: 2, w: 20, d: 14, floorY: G_IN, wallH: 5.5, bays: 5, doorBays: [2], roofType: 'hip', roofH: 5 });
    lm('斋宫', '内廷东路', 279, 3, -1, '皇帝祭天前斋戒之所,宫院素净。', 80, 30, 180, 30);
    wallSection(A, 188, 55, 232, 61, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 188, 111, 232, 117, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 188, 61, 194, 111, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 226, 61, 232, 111, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    hall(A, { x: 210, z: 90, w: 18, d: 12, floorY: G_IN, wallH: 5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 5 });
    hall(A, { x: 210, z: 72, w: 13, d: 9, floorY: G_IN, wallH: 4, bays: 3, doorBays: [1], roofType: 'hip', roofH: 3.6 });
    tree(A, 200, 85, G_IN, 1.0, 'cypress'); tree(A, 220, 85, G_IN, 1.0, 'cypress');
    lm('毓庆宫', '内廷东路', 210, 3, 86, '康熙朝太子宫,后为皇子读书处。', 80, 30, 180, 30);
    slab(A, 195, 124, 215, 146, G_IN, 2.5, COLORS.white2);
    for (const [dx, dz] of [[-5, -8], [5, -8], [-5, 8], [5, 8]]) {
      box(A, 205 + dx - 0.5, 2.5, 135 + dz - 0.5, 205 + dx + 0.5, 8, 135 + dz + 0.5, COLORS.column, { land: false });
    }
    hipRoof(A, 205, 135, 8, 13, 21, 4.5, COLORS.roof, 3);
    lm('箭亭', '内廷东路', 205, 3, 135, '开敞式方亭,皇帝在此阅射演武,亭周设跑马道。', 75, 28, 180, 30);
  }

  // ======= 10. 宁寿宫区(外东路) =======
  {
    dragonScreen(A, 270, 195, 62);
    lm('九龙壁', '内廷东路', 270, 4, 195, '宁寿宫区琉璃影壁,九条蟠龙腾跃于波涛云气之间。', 90, 30, 180, 45);
    slab(A, 246, 214, 294, 234, G_IN, 3, COLORS.white2);
    hall(A, { x: 270, z: 224, w: 44, d: 18, floorY: 3, wallH: 7, bays: 5, doorBays: [1, 2, 3], doorBoth: true, roofType: 'hip', roofH: 7, lanterns: true });
    {
      const st = [];
      for (let t = 1; t <= 2; t++) st.push({ tier: t, side: 's', x: 270, w: 14 }, { tier: t, side: 'n', x: 270, w: 14 });
      platform(A, 244, 246, 296, 292, G_IN, 7.5, 2, 4, true, { stairs: st });
      hall(A, { x: 270, z: 269, w: 48, d: 28, floorY: 7.5, wallH: 10, bays: 9, doorBays: [2, 3, 4, 5, 6], roofType: 'double', roofH: 10.5, lanterns: true, dougong: true });
    }
    lm('皇极殿', '内廷东路', 270, 7.5, 269, '宁寿宫区主殿,仿太和殿形制而建,乾隆晚年以太上皇身份在此举行典礼。', 110, 45, 180, 45);
    slab(A, 250, 300, 290, 324, G_IN, 3, COLORS.white2);
    hall(A, { x: 270, z: 312, w: 36, d: 20, floorY: 3, wallH: 7, bays: 7, doorBays: [2, 3, 4], roofType: 'hip', roofH: 7 });
    lm('宁寿宫', '内廷东路', 270, 3, 312, '太上皇宫寝主殿,前有月台,殿宇宏敞。', 90, 35, 180, 35);
    slab(A, 252, 340, 288, 362, G_IN, 2.8, COLORS.white2);
    hall(A, { x: 270, z: 351, w: 32, d: 18, floorY: 2.8, wallH: 6.5, bays: 7, doorBays: [2, 3, 4], roofType: 'hip', roofH: 6.5 });
    lm('养性殿', '内廷东路', 270, 3, 351, '仿养心殿形制,太上皇理政之所。', 85, 32, 180, 30);
    hall(A, { x: 270, z: 392, w: 34, d: 16, floorY: G_IN, wallH: 6.5, bays: 7, doorBays: [3], roofType: 'hip', roofH: 6 });
    {
      const x = 238, z = 348;
      slab(A, x - 9, z - 9, x + 9, z + 9, G_IN, 3, COLORS.white2);
      box(A, x - 6, 3, z - 6, x + 6, 9, z + 6, COLORS.wall, { jitter: 0.02 });
      box(A, x - 8.5, 9, z - 8.5, x + 8.5, 9.9, z + 8.5, COLORS.roofUnder);
      hipRoof(A, x, z, 9.9, 19, 19, 2.6, COLORS.roofGreen, 2);
      box(A, x - 5, 12, z - 5, x + 5, 17, z + 5, COLORS.wall, { jitter: 0.02 });
      box(A, x - 7.5, 17, z - 7.5, x + 7.5, 17.9, z + 7.5, COLORS.roofUnder);
      hipRoof(A, x, z, 17.9, 17, 17, 2.4, COLORS.roofGreen, 2);
      box(A, x - 4, 19.8, z - 4, x + 4, 23.5, z + 4, COLORS.wall, { jitter: 0.02 });
      pyramidRoof(A, x, z, 23.5, 12, 12, 4, COLORS.roof);
      hall(A, { x: 282, z, w: 20, d: 12, floorY: G_IN, wallH: 6, bays: 3, doorBays: [1], roofType: 'hip', roofH: 5.5 });
    }
    lm('畅音阁', '内廷东路', 238, 5, 348, '三层大戏楼,清代宫廷演剧之所,对岸阅是楼为观戏处。', 100, 40, 180, 40);
    {
      wallSection(A, 148, 262, 205, 268, G_IN, 5, COLORS.wall, COLORS.roofGreen);
      wallSection(A, 148, 392, 205, 398, G_IN, 5, COLORS.wall, COLORS.roofGreen);
      wallSection(A, 148, 268, 154, 392, G_IN, 5, COLORS.wall, COLORS.roofGreen);
      wallSection(A, 199, 268, 205, 392, G_IN, 5, COLORS.wall, COLORS.roofGreen);
      pavilion(A, 176, 282, 6, 4, 5, COLORS.roofGreen);
      hall(A, { x: 176, z: 318, w: 15, d: 10, floorY: G_IN, wallH: 5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 4.5, roofColor: COLORS.roofGreen });
      hall(A, { x: 176, z: 356, w: 14, d: 9, floorY: G_IN, wallH: 7, bays: 3, doorBays: [1], roofType: 'hip', roofH: 4, roofColor: COLORS.roofGreen });
      rockery(A, 164, 336, G_IN, 4.5, 40);
      rockery(A, 190, 376, G_IN, 4, 30);
      tree(A, 162, 296, G_IN, 1.1, 'cypress'); tree(A, 190, 300, G_IN, 1.0, 'cypress');
      tree(A, 168, 372, G_IN, 1.0, 'cypress'); tree(A, 186, 344, G_IN, 0.9, 'autumn');
      tree(A, 158, 380, G_IN, 1.0, 'cypress'); tree(A, 194, 330, G_IN, 0.9, 'autumn');
    }
    lm('乾隆花园', '内廷东路', 176, 3, 330, '宁寿宫花园,四进院落,叠石奇巧,亭台错落。', 110, 55, 150, 50);
  }

  // ======= 11. 内廷西路:慈宁宫区 =======
  {
    slab(A, -282, -60, -228, -8, G_IN, 3.6, COLORS.white2);
    stairsZ(A, -255, -64.4, -60, G_IN, 3.6, 12, COLORS.white);
    stairsZ(A, -255, -3.6, -8, G_IN, 3.6, 12, COLORS.white);
    hall(A, { x: -255, z: -34, w: 40, d: 22, floorY: 3.6, wallH: 8, bays: 7, doorBays: [2, 3, 4], roofType: 'double', roofH: 9 });
    hall(A, { x: -255, z: -12, w: 20, d: 10, floorY: G_IN, wallH: 5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 5 });
    wallSection(A, -288, -64, -222, -58, G_IN, 5.5, COLORS.wall, COLORS.roofGreen);
    lm('慈宁宫', '内廷西路', -255, 4, -34, '太后寝宫,重檐大殿;前有慈宁宫花园,为太后礼佛游憩之所。', 105, 40, 180, 40);
    pavilion(A, -255, 22, 6, 4, 5, COLORS.roofGreen);
    hall(A, { x: -255, z: 40, w: 14, d: 9, floorY: G_IN, wallH: 4.5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 4, roofColor: COLORS.roofGreen });
    tree(A, -268, 18, G_IN, 1.1, 'cypress'); tree(A, -242, 18, G_IN, 1.0, 'cypress');
    tree(A, -268, 38, G_IN, 1.0, 'autumn'); tree(A, -242, 38, G_IN, 1.1, 'cypress');
    tree(A, -245, 56, G_IN, 0.9, 'autumn'); tree(A, -265, 56, G_IN, 1.0, 'cypress');
    rockery(A, -252, 50, G_IN, 3, 20);
    lm('慈宁宫花园', '内廷西路', -255, 3, 26, '太后礼佛游憩的花园,临溪亭跨水而立,花木扶疏。', 90, 45, 150, 40);
    slab(A, -278, 62, -232, 106, G_IN, 3, COLORS.white2);
    hall(A, { x: -255, z: 84, w: 30, d: 18, floorY: 3, wallH: 6.5, bays: 5, doorBays: [2], roofType: 'hip', roofH: 6.5 });
    lm('寿康宫', '内廷西路', -255, 3, 84, '太后太妃寝宫,规制森严。', 80, 30, 180, 30);
    slab(A, -278, 126, -232, 166, G_IN, 3, COLORS.white2);
    hall(A, { x: -255, z: 146, w: 30, d: 18, floorY: 3, wallH: 6.5, bays: 5, doorBays: [2], roofType: 'hip', roofH: 6.5 });
    tree(A, -268, 130, G_IN, 1.0, 'cypress'); tree(A, -242, 130, G_IN, 1.0, 'cypress');
    lm('寿安宫', '内廷西路', -255, 3, 146, '太后宴居之所,宫前古柏森森。', 80, 30, 180, 30);
    hall(A, { x: -215, z: 186, w: 20, d: 14, floorY: G_IN, wallH: 5.5, bays: 5, doorBays: [2], roofType: 'hip', roofH: 5 });
    {
      const x = -205, z = -20;
      slab(A, x - 8, z - 8, x + 8, z + 8, G_IN, 3, COLORS.white2);
      let y = 3;
      for (let i = 0; i < 3; i++) {
        box(A, x - 5 + i * 0.6, y, z - 5 + i * 0.6, x + 5 - i * 0.6, y + 4, z + 5 - i * 0.6, COLORS.wall, { jitter: 0.02 });
        y += 4;
        hipRoof(A, x, z, y - 1, 13 - i, 13 - i, 2.2, i === 2 ? COLORS.roof : COLORS.roofGreen, 2);
      }
      box(A, x - 2, y - 0.5, z - 2, x + 2, y + 3, z + 2, COLORS.wall, { jitter: 0.02 });
      pyramidRoof(A, x, z, y + 3, 6, 6, 3.2, COLORS.roof);
    }
    lm('雨花阁', '内廷西路', -205, 8, -20, '四层藏式佛楼,紫禁城西侧最高的建筑之一,供奉密宗诸佛。', 85, 35, 180, 30);
    wallSection(A, -208, 140, -162, 146, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, -208, 190, -162, 196, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, -208, 146, -202, 190, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, -168, 146, -162, 190, G_IN, 5, COLORS.wall, COLORS.roofGreen);
    hall(A, { x: -185, z: 172, w: 18, d: 12, floorY: G_IN, wallH: 5.5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 5 });
    tree(A, -196, 156, G_IN, 0.9, 'cypress'); tree(A, -174, 156, G_IN, 0.9, 'cypress');
    lm('重华宫', '内廷西路', -185, 3, 168, '乾隆皇帝潜邸,登基后为家宴之所。', 80, 30, 180, 30);
  }

  // ======= 12. 城门:神武门、东华门、西华门 =======
  {
    const z0 = 476.5, z1 = 489.5;
    const gaps = [[-16.5, -11.5], [-2.5, 2.5], [11.5, 16.5]];
    slab(A, -22, z0, -16.5, z1, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, -11.5, z0, -2.5, z1, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, 2.5, z0, 11.5, z1, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, 16.5, z0, 22, z1, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    // 城楼(南北面开门)
    {
      const cx = 0, cz = 482, w = 44, d = 14, y0 = 12, wallH = 9;
      const x0 = -w / 2, x1 = w / 2, zz0 = cz - d / 2, zz1 = cz + d / 2;
      for (const [g0, g1] of gaps) {
        box(A, g0, y0, zz0 - 0.6, g1, y0 + wallH, zz0 + 0.8, COLORS.wall, { jitter: 0.02, land: false });
        box(A, g0, y0, zz1 - 0.8, g1, y0 + wallH, zz1 + 0.6, COLORS.wall, { jitter: 0.02, land: false });
        doorPanel(A, (g0 + g1) / 2, y0, zz0, 'z', -1, g1 - g0 - 1, wallH - 1);
        doorPanel(A, (g0 + g1) / 2, y0, zz1, 'z', 1, g1 - g0 - 1, wallH - 1);
      }
      const segs = [[x0, -16.5], [-11.5, -2.5], [2.5, 11.5], [16.5, x1]];
      for (const [a0, a1] of segs) {
        box(A, a0 + 0.2, y0, zz0 - 0.6, a1 - 0.2, y0 + wallH, zz0 + 0.8, COLORS.wall, { jitter: 0.03 });
        box(A, a0 + 0.2, y0, zz1 - 0.8, a1 - 0.2, y0 + wallH, zz1 + 0.6, COLORS.wall, { jitter: 0.03 });
      }
      box(A, x0 - 0.7, y0, zz0 + 0.7, x0 + 0.7, y0 + wallH, zz1 - 0.7, COLORS.wall, { jitter: 0.03 });
      box(A, x1 - 0.7, y0, zz0 + 0.7, x1 + 0.7, y0 + wallH, zz1 - 0.7, COLORS.wall, { jitter: 0.03 });
      eaveRing(A, x0, zz0, x1, zz1, y0 + wallH, false);
      doubleRoof(A, cx, cz, y0 + wallH, w, d, 10, COLORS.roof);
      lanternRow(A, x0 + 6, x1 - 6, zz0, y0 + wallH - 1.2, 3);
    }
    // 门洞(最后下挖)
    for (const [g0, g1] of gaps) {
      slab(A, g0, z0, g1, z1, G_IN, G_IN + 0.4, COLORS.stone2, { land: false });
      A.hm.set(g0, z0, g1, z1, G_IN);
      stairsZ(A, (g0 + g1) / 2, z1, z1 + 6, G_IN, G_OUT, g1 - g0 - 1.2, COLORS.stone2);
      doorPanel(A, (g0 + g1) / 2, G_IN, z0, 'z', 1, g1 - g0 - 1, 9);
      doorPanel(A, (g0 + g1) / 2, G_IN, z1, 'z', -1, g1 - g0 - 1, 9);
    }
    lm('神武门', '中轴线', 0, 12, 482, '紫禁城北门,五间城楼三门洞,帝后出宫游园之门。', 110, 45, 180, 45);
  }
  for (const s of [-1, 1]) {
    const x = 378 * s;
    const x0 = s > 0 ? 363 : -391, x1 = s > 0 ? 391 : -363;
    const gaps = [[-16.5, -11.5], [-2.5, 2.5], [11.5, 16.5]];
    slab(A, Math.min(x0, x1), -27, Math.max(x0, x1), -16.5, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, Math.min(x0, x1), -11.5, Math.max(x0, x1), -2.5, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, Math.min(x0, x1), 2.5, Math.max(x0, x1), 11.5, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    slab(A, Math.min(x0, x1), 16.5, Math.max(x0, x1), 27, G_IN, 12, COLORS.wall, { jitter: 0.02 });
    gateTowerEW(A, x, -30, 50, 22, 12, 8, 7.5, gaps);
    // 门洞(最后下挖)
    for (const [g0, g1] of gaps) {
      slab(A, Math.min(x0, x1), g0, Math.max(x0, x1), g1, G_IN, G_IN + 0.4, COLORS.stone2, { land: false });
      A.hm.set(Math.min(x0, x1), g0, Math.max(x0, x1), g1, G_IN);
      const outerX = s > 0 ? 391 : -391;
      stairsX(A, (g0 + g1) / 2, outerX, outerX + s * 6, G_IN, G_OUT, g1 - g0 - 1.2, COLORS.stone2);
      doorPanel(A, (g0 + g1) / 2, G_IN, x0, 'x', s, g1 - g0 - 1, 9);
      doorPanel(A, (g0 + g1) / 2, G_IN, x1, 'x', -s, g1 - g0 - 1, 9);
    }
    lm(s > 0 ? '东华门' : '西华门', '城门与防御', x, 12, -30, s > 0 ? '紫禁城东门,官员上朝出入之门。' : '紫禁城西门,帝后出宫游园之门。', 90, 35, s > 0 ? 270 : 90, 40);
  }
  lm('城墙与护城河', '城门与防御', 0, 8, 0, '高约十米的宫墙环护宫城,外绕五十二米宽的筒子河,四角角楼雄踞。', 700, 500, 45, 400);

  // ======= 13. 城外:太庙、社稷坛 =======
  {
    wallSection(A, 80, -708, 356, -702, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 80, -550, 356, -544, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 80, -702, 86, -544, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    wallSection(A, 350, -702, 356, -544, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    hall(A, { x: 218, z: -698, w: 40, d: 18, floorY: G_OUT, wallH: 7, bays: 5, doorBays: [1, 2, 3], doorBoth: true, roofType: 'hip', roofH: 7 });
    hall(A, { x: 218, z: -672, w: 26, d: 14, floorY: G_OUT, wallH: 6, bays: 3, doorBays: [1], doorBoth: true, roofType: 'hip', roofH: 5.5 });
    {
      const st = [];
      for (let t = 1; t <= 3; t++) st.push({ tier: t, side: 's', x: 218, w: 12 }, { tier: t, side: 'n', x: 218, w: 12 });
      platform(A, 186, -652, 250, -608, G_OUT, 7, 3, 3, true, { stairs: st });
      hall(A, { x: 218, z: -630, w: 50, d: 28, floorY: 7, wallH: 11, bays: 9, doorBays: [2, 3, 4, 5, 6], roofType: 'double', roofH: 12 });
    }
    hall(A, { x: 218, z: -584, w: 34, d: 18, floorY: G_OUT, wallH: 7, bays: 5, doorBays: [2], roofType: 'hip', roofH: 7 });
    hall(A, { x: 218, z: -562, w: 24, d: 13, floorY: G_OUT, wallH: 5.5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 5 });
    for (let i = 0; i < 14; i++) tree(A, 100 + i * 17, -660 + (i % 3) * 12, G_OUT, 1.2, 'cypress');
    for (let i = 0; i < 14; i++) tree(A, 100 + i * 17, -570 + (i % 3) * 12, G_OUT, 1.1, 'cypress');
    lm('太庙', '城外', 218, 6, -630, '紫禁城东南皇家祖庙,享殿重檐、三层汉白玉台基,与太和殿同制。', 140, 60, 150, 60);
    wallSection(A, -356, -708, -80, -702, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    wallSection(A, -356, -550, -80, -544, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    wallSection(A, -356, -702, -350, -544, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    wallSection(A, -86, -702, -80, -544, G_OUT, 6, COLORS.wall, COLORS.roofGreen);
    hall(A, { x: -218, z: -680, w: 26, d: 14, floorY: G_OUT, wallH: 6, bays: 3, doorBays: [1], doorBoth: true, roofType: 'hip', roofH: 5.5 });
    hall(A, { x: -218, z: -642, w: 34, d: 18, floorY: G_OUT, wallH: 7, bays: 5, doorBays: [2], roofType: 'hip', roofH: 7 });
    {
      slab(A, -232, -598, -204, -570, G_OUT, 2, COLORS.white2);
      slab(A, -231, -597, -205, -571, 2, 3.2, COLORS.white);
      stairsZ(A, -218, -602.4, -598, G_OUT, 2, 4.4, COLORS.white);
      stairsZ(A, -218, -565.6, -570, G_OUT, 2, 4.4, COLORS.white);
      const cells = [[COLORS.soilYellow, COLORS.soilBlack, COLORS.soilYellow], [COLORS.soilWhite, COLORS.soilYellow, COLORS.soilCyan], [COLORS.soilYellow, COLORS.soilRed, COLORS.soilYellow]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        slab(A, -218 + (j - 1) * 8.6 - 4.3, -584 + (i - 1) * 8.6 - 4.3, -218 + (j - 1) * 8.6 + 4.3, -584 + (i - 1) * 8.6 + 4.3, 3.2, 3.7, cells[i][j]);
      }
    }
    for (let i = 0; i < 12; i++) tree(A, -100 - i * 17, -660 + (i % 3) * 12, G_OUT, 1.2, 'cypress');
    lm('社稷坛', '城外', -218, 3, -590, '紫禁城西南祭坛,五色土象征"普天之下莫非王土",拜殿今为中山堂。', 140, 60, 210, 60);
  }

  // ======= 14. 城内其余院落:南三所、乾东五所、军机处 =======
  for (const [sx, sz] of [[245, -255], [300, -255], [300, -215]]) {
    wallSection(A, sx - 13, sz - 11, sx + 13, sz - 5, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, sx - 13, sz + 13, sx + 13, sz + 19, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, sx - 13, sz - 5, sx - 7, sz + 13, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, sx + 7, sz - 5, sx + 13, sz + 13, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    hall(A, { x: sx, z: sz + 4, w: 14, d: 9, floorY: G_IN, wallH: 4, bays: 3, doorBays: [1], roofType: 'hip', roofH: 3.6 });
    tree(A, sx - 7, sz - 8, G_IN, 0.7, 'cypress'); tree(A, sx + 7, sz - 8, G_IN, 0.7, 'cypress');
  }
  for (const [sx, sz] of [[130, 162], [165, 162], [200, 162]]) {
    wallSection(A, sx - 13, sz - 11, sx + 13, sz - 5, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, sx - 13, sz + 8, sx + 13, sz + 14, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, sx - 13, sz - 5, sx - 7, sz + 8, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    wallSection(A, sx + 7, sz - 5, sx + 13, sz + 8, G_IN, 4.5, COLORS.wall, COLORS.roofGreen);
    hall(A, { x: sx, z: sz + 1, w: 12, d: 8, floorY: G_IN, wallH: 3.6, bays: 3, doorBays: [1], roofType: 'hip', roofH: 3.2 });
  }
  hall(A, { x: -110, z: -50, w: 16, d: 10, floorY: G_IN, wallH: 4.5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 4 });
  hall(A, { x: -110, z: -28, w: 16, d: 10, floorY: G_IN, wallH: 4.5, bays: 3, doorBays: [1], roofType: 'hip', roofH: 4 });

  // ======= 15. 城外散景:树木 =======
  for (let i = 0; i < 40; i++) {
    const tx = -580 + Math.random() * 1160, tz = -340 + Math.random() * 760;
    if (tz > -80 && tz < 560) continue;
    tree(A, tx, tz, G_OUT, 0.9 + Math.random() * 0.7, Math.random() > 0.6 ? 'cypress' : null);
  }
  for (let i = 0; i < 26; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    tree(A, side * (470 + Math.random() * 90), -1000 + Math.random() * 1650, G_OUT, 0.9 + Math.random() * 0.7, Math.random() > 0.6 ? 'cypress' : null);
  }
  for (let i = 0; i < 12; i++) {
    tree(A, -320 + i * 24, -672, G_CORR, 1.1, 'cypress');
    tree(A, -320 + i * 24, -640, G_CORR, 1.1, 'cypress');
    tree(A, 30 + i * 24, -672, G_CORR, 1.0, 'cypress');
    tree(A, 30 + i * 24, -640, G_CORR, 1.0, 'cypress');
  }

  // ======= 16. 陈设(铜缸等) =======
  for (let i = 0; i < 9; i++) vat(A, -56 + i * 14, -295, G_IN);
  for (const [vx, vz] of [[-74, -270], [74, -270], [-74, -240], [74, -240], [-74, -210], [74, -210], [-74, -180], [74, -180], [-74, -150], [74, -150], [-74, -120], [74, -120]]) vat(A, vx, vz, G_IN);
  for (let i = 0; i < 6; i++) vat(A, -36 + i * 14.4, -100, G_IN);
  for (let i = 0; i < 5; i++) { vat(A, -24 + i * 12, -56, G_IN); vat(A, -24 + i * 12, 46, G_IN); }
  vat(A, -270, -52, 3.6); vat(A, -240, -52, 3.6);
  vat(A, 258, 252, G_IN); vat(A, 282, 252, G_IN);
  vat(A, 262, 306, 3); vat(A, 278, 306, 3);
  vat(A, -12, 160, G_IN); vat(A, 12, 160, G_IN);
  vat(A, -45, 136, G_IN); vat(A, 45, 136, G_IN);

  // ======= 17. 水面 =======
  const waterGeom = buildWaterGeom();

  // ======= 汇总 =======
  const chunks = [];
  for (const ch of c.cs.map.values()) {
    chunks.push({
      cx: ch.cx, cz: ch.cz,
      sm: Float32Array.from(ch.sm), sc: Float32Array.from(ch.sc),
      fm: Float32Array.from(ch.fm), fc: Float32Array.from(ch.fc),
    });
  }
  return { chunks, hm: c.hm, waterGeom, stats: c.stats };
}

// ---------------- 水面几何 ----------------
const WATER_QUADS = [];
function waterRect(x0, z0, x1, z1, y) {
  const seg = 14;
  const nx = Math.max(1, Math.ceil((x1 - x0) / seg)), nz = Math.max(1, Math.ceil((z1 - z0) / seg));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const X0 = x0 + (x1 - x0) * i / nx, X1 = x0 + (x1 - x0) * (i + 1) / nx;
    const Z0 = z0 + (z1 - z0) * j / nz, Z1 = z0 + (z1 - z0) * (j + 1) / nz;
    WATER_QUADS.push([X0, Z0, X1, Z1, y]);
  }
}
function waterRibbon(pts, w, y) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / 12));
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n;
      const x0 = ax + dx * t0, z0 = az + dz * t0, x1 = ax + dx * t1, z1 = az + dz * t1;
      const px = -dz / len * w / 2, pz = dx / len * w / 2;
      WATER_QUADS.push([x0 + px, z0 + pz, x1 + px, z1 + pz, y]);
      WATER_QUADS.push([x0 - px, z0 - pz, x1 - px, z1 - pz, y]);
    }
  }
}
function buildWaterGeom() {
  WATER_QUADS.length = 0;
  // 护城河(筒子河)
  waterRect(-378.5, -537.5, 378.5, -487.5, 0.05);
  waterRect(-378.5, 487.5, 378.5, 537.5, 0.05);
  waterRect(-537.5, -484.5, -487.5, 484.5, 0.05);
  waterRect(487.5, -484.5, 537.5, 484.5, 0.05);
  waterRect(-537.5, -537.5, -378.5, -487.5, 0.05);
  waterRect(378.5, -537.5, 537.5, -487.5, 0.05);
  waterRect(-537.5, 487.5, -378.5, 537.5, 0.05);
  waterRect(378.5, 487.5, 537.5, 537.5, 0.05);
  // 内金水河
  waterRibbon([[-378, -318], [-280, -330], [-210, -358], [-140, -388], [-80, -413], [-30, -420], [30, -418], [80, -409], [140, -378], [210, -354], [280, -328], [378, -314]], 7.5, 1.97);
  // 外金水河
  waterRect(-220, -887, 220, -873, 0.05);
  // 浮碧亭/澄瑞亭水池
  waterRect(24, 220, 36, 232, 1.95);
  waterRect(-36, 220, -24, 232, 1.95);
  // 文渊阁前水池
  waterRect(186, -262, 234, -250, 1.95);

  const pos = [], idx = [];
  for (const [x0, z0, x1, z1, y] of WATER_QUADS) {
    const b = pos.length / 3;
    pos.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    idx.push(b, b + 2, b + 1, b + 2, b + 3, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
