// ============================================================
//  紫禁城 · 体素沙盘 —— 渲染与控制
//  模式:上帝视角(轨道环绕/缩放/平移) + 第一人称(行走/飞行)
// ============================================================
import * as THREE from './three.module.min.js';
import { buildCity, LANDMARKS, CHUNK, G_IN } from './buildCity.js';

// ---------- 构建城市 ----------
const t0 = performance.now();
const built = buildCity();
const { chunks, hm, waterGeom, stats } = built;
const buildMs = (performance.now() - t0).toFixed(0);

// ---------- 基础 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 900, 3800);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 1, 7000);
camera.rotation.order = 'YXZ';

// ---------- 天空穹顶 ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    uTop: { value: new THREE.Color(0x4f8bd8) },
    uBottom: { value: new THREE.Color(0xd8e6f2) },
    uExp: { value: 0.55 },
  },
  vertexShader: `varying vec3 vDir;
    void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; uniform float uExp; varying vec3 vDir;
    void main(){ float h = normalize(vDir).y; float t = pow(max(h,0.0), uExp); gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(3600, 24, 16), skyMat);
sky.frustumCulled = false;
scene.add(sky);

// ---------- 灯光 ----------
const hemi = new THREE.HemisphereLight(0xe8f1fa, 0x9a8b74, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.0);
sun.position.set(350, 520, -350);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -260; sun.shadow.camera.right = 260;
sun.shadow.camera.top = 260; sun.shadow.camera.bottom = -260;
sun.shadow.camera.near = 50; sun.shadow.camera.far = 1400;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);
// 夜间灯笼光源
const nightLights = [
  [0, 20, -242, 0xffa850], [0, 15, -18, 0xffa850], [0, 12, 199, 0xffa850], [-60, 10, -417, 0xffa850],
].map(([x, y, z, col]) => {
  const l = new THREE.PointLight(col, 0, 130, 1.8);
  l.position.set(x, y, z);
  scene.add(l);
  return l;
});

// ---------- 水面 ----------
const waterMat = new THREE.ShaderMaterial({
  transparent: true, opacity: 0.92,
  uniforms: { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x2e5f74) }, uShallow: { value: new THREE.Color(0x5d9fb8) } },
  vertexShader: `uniform float uTime; varying vec3 vP;
    void main(){
      vec3 p = position;
      p.y += 0.10*sin(position.x*0.22 + uTime*1.1) + 0.08*sin(position.z*0.18 + uTime*0.85) + 0.05*sin((position.x+position.z)*0.08 + uTime*1.4);
      vP = p;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `uniform vec3 uDeep; uniform vec3 uShallow; uniform float uTime; varying vec3 vP;
    void main(){
      float w = 0.5 + 0.5*sin(vP.x*0.35 + vP.z*0.3 - uTime*0.7);
      vec3 col = mix(uDeep, uShallow, w);
      gl_FragColor = vec4(col, 0.92);
    }`,
});
const water = new THREE.Mesh(waterGeom, waterMat);
water.receiveShadow = true;
scene.add(water);

// ---------- 地面(草地) ----------
const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(3400, 2800),
  new THREE.MeshLambertMaterial({ color: 0x7f9c58 })
);
grass.rotation.x = -Math.PI / 2;
grass.position.set(0, 0, -450);
grass.receiveShadow = true;
scene.add(grass);

// ---------- 体素网格 ----------
const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
const matStruct = new THREE.MeshLambertMaterial({ color: 0xffffff });
const matFine = new THREE.MeshLambertMaterial({ color: 0xffffff });
const cityRoot = new THREE.Group();

function makeInstanced(mArr, cArr, material, castShadow) {
  const n = mArr.length / 16;
  if (!n) return null;
  const mesh = new THREE.InstancedMesh(cubeGeo, material, n);
  mesh.instanceMatrix.array.set(mArr);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(cArr, 3);
  mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}
let totalInstances = 0;
for (const ch of chunks) {
  if (ch.sm.length) {
    const m = makeInstanced(ch.sm, ch.sc, matStruct, true);
    if (m) { totalInstances += ch.sm.length / 16; cityRoot.add(m); }
  }
  if (ch.fm.length) {
    const m = makeInstanced(ch.fm, ch.fc, matFine, false);
    if (m) { totalInstances += ch.fm.length / 16; cityRoot.add(m); }
  }
}
scene.add(cityRoot);

// ---------- 相机状态 ----------
const state = {
  mode: 'god',
  // god
  target: new THREE.Vector3(0, 8, -60),
  yaw: Math.PI, pitch: 0.52, dist: 1500,
  // fp
  pos: new THREE.Vector3(0, G_IN + 1.7, -470),
  fpYaw: 0, fpPitch: 0, vy: 0, grounded: true, fly: false,
  // misc
  night: 0, nightTarget: 0,
  labelsOn: true,
  dragging: false, panning: false,
  keys: {},
  tween: null,
};
let lastGod = null;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function setGodCam() {
  const dir = _v1.set(Math.cos(state.pitch) * Math.sin(state.yaw), Math.sin(state.pitch), Math.cos(state.pitch) * Math.cos(state.yaw));
  camera.position.copy(state.target).addScaledVector(dir, state.dist);
  camera.lookAt(state.target);
}
setGodCam();

// ---------- 输入 ----------
const keys = state.keys;
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Digit1') enterGod();
  if (e.code === 'Digit2') enterFP();
  if (e.code === 'KeyF' && state.mode === 'fp') { state.fly = !state.fly; updateHint(); }
  if (e.code === 'KeyN') toggleNight();
  if (e.code === 'KeyL') toggleLabels();
  if (e.code === 'KeyH') toggleHelp();
  if (e.code === 'KeyM') togglePanel();
  if (e.code === 'Space' && state.mode === 'fp') e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// 上帝视角轨道控制
const pointers = new Map();
let pinchDist = 0;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'god') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, btn: e.button });
  if (e.button === 0) state.dragging = true;
  if (e.button === 2 || e.button === 1) state.panning = true;
  state.tween = null;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (state.mode === 'god') hoverPick(e.clientX, e.clientY);
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    if (state.dragging) {
      state.yaw -= dx * 0.0052;
      state.pitch += dy * 0.0052;
      state.pitch = Math.max(-1.48, Math.min(1.48, state.pitch));
    } else if (state.panning) {
      panTarget(dx, dy, state.dist);
    }
  } else if (pointers.size === 2) {
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (pinchDist > 0) {
      state.dist = THREE.MathUtils.clamp(state.dist * (pinchDist / d), 40, 2600);
    }
    pinchDist = d;
    panTarget(dx / 2, dy / 2, state.dist);
  }
});
function panTarget(dx, dy, dist) {
  const dir = _v1.set(Math.cos(state.pitch) * Math.sin(state.yaw), Math.sin(state.pitch), Math.cos(state.pitch) * Math.cos(state.yaw)).normalize();
  const right = _v2.crossVectors(dir, _v3.set(0, 1, 0)).normalize();
  const up = _v3.crossVectors(right, dir).normalize();
  const k = dist * 0.0016;
  state.target.addScaledVector(right, -dx * k);
  state.target.addScaledVector(up, dy * k);
  state.target.y = Math.max(0, Math.min(600, state.target.y));
  state.target.x = THREE.MathUtils.clamp(state.target.x, -1600, 1600);
  state.target.z = THREE.MathUtils.clamp(state.target.z, -1800, 1200);
}
canvas.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  state.dragging = false; state.panning = false;
});
canvas.addEventListener('wheel', (e) => {
  if (state.mode !== 'god') return;
  e.preventDefault();
  state.tween = null;
  state.dist = THREE.MathUtils.clamp(state.dist * Math.exp(e.deltaY * 0.0012), 40, 2600);
}, { passive: false });

// 第一人称
canvas.addEventListener('click', () => {
  if (state.mode === 'fp' && document.pointerLockElement !== canvas) lockPointer();
});
document.addEventListener('mousemove', (e) => {
  if (state.mode === 'fp' && document.pointerLockElement === canvas) {
    state.fpYaw += e.movementX * 0.0022;
    state.fpPitch += e.movementY * 0.0022;
    state.fpPitch = THREE.MathUtils.clamp(state.fpPitch, -1.55, 1.55);
  }
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state.mode === 'fp') {
    document.getElementById('lockHint').style.display = 'flex';
  } else {
    document.getElementById('lockHint').style.display = 'none';
  }
});
function lockPointer() {
  try { canvas.requestPointerLock(); } catch (err) { /* 某些浏览器拒绝时忽略 */ }
}

// ---------- 碰撞与移动 ----------
function groundY(x, z) { return hm.get(x, z); }
function fpStep(dt) {
  const s = state;
  const sprint = !!keys['ShiftLeft'] || !!keys['ShiftRight'];
  let speed, f = 0, strafe = 0, upv = 0;
  if (keys['KeyW'] || keys['ArrowUp']) f += 1;
  if (keys['KeyS'] || keys['ArrowDown']) f -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) strafe += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) strafe -= 1;
  if (s.fly) {
    speed = sprint ? 34 : 20;
    if (keys['Space']) upv += 1;
    if (keys['ControlLeft'] || keys['KeyC']) upv -= 1;
    camera.getWorldDirection(_v1);
    const right = _v2.crossVectors(_v1, _v3.set(0, 1, 0)).normalize();
    const mv = _v3.set(0, 0, 0);
    mv.addScaledVector(_v1, f).addScaledVector(right, strafe);
    if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed);
    mv.y += upv * speed;
    s.pos.addScaledVector(mv, dt);
    const g = groundY(s.pos.x, s.pos.z);
    if (s.pos.y < g + 0.4) s.pos.y = g + 0.4;
  } else {
    speed = sprint ? 10.5 : 6;
    const fwd = _v1.set(Math.sin(s.fpYaw), 0, Math.cos(s.fpYaw));
    const right = _v2.set(Math.cos(s.fpYaw), 0, -Math.sin(s.fpYaw));
    const mv = _v3.set(0, 0, 0);
    mv.addScaledVector(fwd, f).addScaledVector(right, strafe);
    if (mv.lengthSq() > 0) mv.normalize().multiplyScalar(speed);
    const nx = s.pos.x + mv.x * dt, nz = s.pos.z + mv.z * dt;
    const g0 = groundY(s.pos.x, s.pos.z);
    if (groundY(nx, s.pos.z) - g0 <= 1.05) s.pos.x = nx;
    if (groundY(s.pos.x, nz) - g0 <= 1.05) s.pos.z = nz;
    s.vy -= 20 * dt;
    s.pos.y += s.vy * dt;
    const g = groundY(s.pos.x, s.pos.z);
    if (s.pos.y < g + 1.7) { s.pos.y = g + 1.7; s.vy = 0; s.grounded = true; }
    if (s.grounded && keys['Space']) { s.vy = 6.8; s.grounded = false; }
  }
  camera.position.copy(s.pos);
  camera.rotation.set(s.fpPitch, s.fpYaw, 0, 'YXZ');
}

// ---------- 模式切换 ----------
function enterGod() {
  if (state.mode === 'fp' && lastGod) {
    state.target.copy(lastGod.target); state.yaw = lastGod.yaw; state.pitch = lastGod.pitch; state.dist = lastGod.dist;
  }
  if (document.pointerLockElement) document.exitPointerLock();
  state.mode = 'god';
  document.getElementById('lockHint').style.display = 'none';
  setGodCam();
  updateHint();
  setModeButtons();
}
function enterFP() {
  if (state.mode !== 'fp') {
    lastGod = { target: state.target.clone(), yaw: state.yaw, pitch: state.pitch, dist: state.dist };
    // 从当前位置的东南方向进入
    state.pos.set(0, groundY(0, -470) + 1.7, -470);
    state.fpYaw = 0; state.fpPitch = 0; state.vy = 0; state.fly = false;
  }
  state.mode = 'fp';
  state.tween = null;
  lockPointer();
  updateHint();
  setModeButtons();
}

// ---------- 景点飞越 ----------
function flyTo(lm) {
  if (state.mode === 'fp') enterGod();
  const a = lm.cam.a * Math.PI / 180;
  const endTarget = _v1.set(lm.x, lm.y * 0.6 + 3, lm.z);
  const endPos = _v2.set(lm.x + Math.sin(a) * lm.cam.d, lm.y + lm.cam.h, lm.z + Math.cos(a) * lm.cam.d);
  const sPos = camera.position.clone(), sTgt = state.target.clone();
  const dir = _v3.copy(endPos).sub(endTarget);
  state.tween = { t: 0, sPos, sTgt, ePos: endPos.clone(), eTgt: endTarget.clone() };
  const d = Math.hypot(dir.x, dir.z), h = dir.y;
  state.yaw = Math.atan2(dir.x, dir.z);
  state.pitch = Math.atan2(h, d);
  state.dist = Math.hypot(d, h);
}
function updateTween(dt) {
  const tw = state.tween;
  if (!tw) return;
  tw.t += dt / 1.7;
  const t = Math.min(1, tw.t);
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  camera.position.lerpVectors(tw.sPos, tw.ePos, e);
  state.target.lerpVectors(tw.sTgt, tw.eTgt, e);
  camera.lookAt(state.target);
  if (t >= 1) state.tween = null;
}

// ---------- 昼夜 ----------
function toggleNight() {
  state.nightTarget = state.nightTarget > 0.5 ? 0 : 1;
}

// ---------- 标注 ----------
const labelContainer = document.getElementById('labels');
const labelEls = [];
for (const lm of LANDMARKS) {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = lm.name;
  labelContainer.appendChild(div);
  labelEls.push({ lm, div, v: new THREE.Vector3() });
}
function toggleLabels() {
  state.labelsOn = !state.labelsOn;
  document.getElementById('labels').style.display = state.labelsOn ? '' : 'none';
  document.getElementById('btnLabels').classList.toggle('active', state.labelsOn);
}
function updateLabels() {
  const show = state.labelsOn;
  const camPos = camera.position;
  camera.getWorldDirection(_v1);
  for (const el of labelEls) {
    const { lm, div, v } = el;
    v.set(lm.x, lm.y + 16, lm.z);
    const to = _v2.copy(v).sub(camPos);
    const dist = to.length();
    let visible = show && to.dot(_v1) > 0;
    if (state.mode === 'fp') visible = visible && dist < 150 && to.dot(_v1) > dist * 0.35;
    if (visible) {
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      if (v.z < 1 && x > -60 && x < window.innerWidth + 60 && y > -40 && y < window.innerHeight + 40) {
        div.style.display = '';
        div.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%,-130%)`;
        continue;
      }
    }
    div.style.display = 'none';
  }
}

// ---------- 悬停拾取(上帝视角) ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
const hoverBoxes = LANDMARKS.map((lm) => {
  const r = lm.r || 30;
  return { lm, box: new THREE.Box3(new THREE.Vector3(lm.x - r, lm.y - 2, lm.z - r), new THREE.Vector3(lm.x + r, lm.y + 34, lm.z + r)) };
});
function hoverPick(cx, cy) {
  ndc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let best = null, bestT = Infinity;
  const hit = new THREE.Vector3();
  for (const hb of hoverBoxes) {
    const t = raycaster.ray.intersectBox(hb.box, hit);
    if (t && t < bestT) { bestT = t; best = hb.lm; }
  }
  if (best && !state.dragging && !state.panning) {
    tooltip.style.display = 'block';
    tooltip.style.left = (cx + 16) + 'px';
    tooltip.style.top = (cy + 12) + 'px';
    tooltip.innerHTML = `<b>${best.name}</b><br>${best.desc}`;
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.style.display = 'none';
    canvas.style.cursor = '';
  }
}
canvas.addEventListener('click', (e) => {
  if (state.mode !== 'god') return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let best = null, bestT = Infinity;
  const hit = new THREE.Vector3();
  for (const hb of hoverBoxes) {
    const t = raycaster.ray.intersectBox(hb.box, hit);
    if (t && t < bestT) { bestT = t; best = hb.lm; }
  }
  if (best) flyTo(best);
});

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
function setModeButtons() {
  $('btnGod').classList.toggle('active', state.mode === 'god');
  $('btnFP').classList.toggle('active', state.mode === 'fp');
  $('btnFly').style.display = state.mode === 'fp' ? '' : 'none';
  $('btnFly').classList.toggle('active', state.fly);
}
function updateHint() {
  const el = $('hint');
  if (state.mode === 'god') {
    el.innerHTML = '🖱 左键拖拽旋转 · 滚轮缩放 · 右键/中键平移 · WASD 移动 · 点击建筑或列表飞越 · <b>2</b> 切换第一人称';
  } else if (state.fly) {
    el.innerHTML = '<b>飞行模式</b> · WASD 移动 · 空格上升 · Ctrl 下降 · 鼠标环视 · <b>F</b> 步行 · <b>1</b> 上帝视角';
  } else {
    el.innerHTML = '<b>步行模式</b> · WASD 行走 · 空格跳跃 · Shift 奔跑 · 鼠标环视 · <b>F</b> 飞行 · <b>1</b> 上帝视角';
  }
}
$('btnGod').onclick = () => enterGod();
$('btnFP').onclick = () => enterFP();
$('btnFly').onclick = () => { state.fly = !state.fly; updateHint(); setModeButtons(); };
$('btnNight').onclick = toggleNight;
$('btnLabels').onclick = toggleLabels;
$('btnHelp').onclick = toggleHelp;
$('btnPanel').onclick = togglePanel;
function toggleHelp() { $('overlay').classList.toggle('hidden'); }
function togglePanel() { $('panel').classList.toggle('hidden'); }

// 景点列表
const groups = {};
for (const lm of LANDMARKS) (groups[lm.group] = groups[lm.group] || []).push(lm);
const panelList = $('panelList');
for (const gname of ['中轴线', '前朝两翼', '内廷东路', '内廷西路', '城门与防御', '城外']) {
  const h = document.createElement('div');
  h.className = 'pgroup';
  h.textContent = gname;
  panelList.appendChild(h);
  for (const lm of groups[gname] || []) {
    const b = document.createElement('button');
    b.className = 'pitem';
    b.textContent = lm.name;
    b.title = lm.desc;
    b.onclick = () => flyTo(lm);
    panelList.appendChild(b);
  }
}

// ---------- 罗盘 ----------
const compass = $('compassArrow');
function updateCompass() {
  let ang;
  if (state.mode === 'god') ang = -state.yaw;
  else ang = -state.fpYaw;
  compass.style.transform = `rotate(${ang}rad)`;
}

// ---------- 主循环 ----------
let last = performance.now(), frames = 0, fpsT = 0, fps = 0;
const fpsEl = $('fps');
const nightSkyTop = new THREE.Color(0x0a1424), nightSkyBottom = new THREE.Color(0x1a2433);
const daySkyTop = new THREE.Color(0x4f8bd8), daySkyBottom = new THREE.Color(0xd8e6f2);
const dayFog = new THREE.Color(0xcfe0ee), nightFog = new THREE.Color(0x0e1726);
const tmpC = new THREE.Color();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // 昼夜渐变
  const nt = state.nightTarget;
  state.night += (nt - state.night) * Math.min(1, dt * 2.2);
  const n = state.night;
  skyMat.uniforms.uTop.value.copy(daySkyTop).lerp(nightSkyTop, n);
  skyMat.uniforms.uBottom.value.copy(daySkyBottom).lerp(nightSkyBottom, n);
  skyMat.uniforms.uExp.value = 0.55 + n * 0.3;
  scene.fog.color.copy(dayFog).lerp(nightFog, n);
  scene.fog.near = 700 - n * 300;
  scene.fog.far = 3200 - n * 900;
  hemi.intensity = 0.85 - n * 0.7;
  hemi.color.copy(tmpC.setHex(0xe8f1fa)).lerp(tmpC.setHex(0x2a3a55), n);
  hemi.groundColor.copy(tmpC.setHex(0x9a8b74)).lerp(tmpC.setHex(0x0c0f14), n);
  sun.intensity = 2.0 - n * 1.72;
  sun.color.copy(tmpC.setHex(0xfff1d6)).lerp(tmpC.setHex(0xa9b8dc), n);
  for (const l of nightLights) l.intensity = n * 900;

  // 阴影跟随相机
  const follow = state.mode === 'fp' ? state.pos : camera.position;
  const sx = Math.round(follow.x / 24) * 24, sz = Math.round(follow.z / 24) * 24;
  sun.position.set(sx + 350, 520, sz - 350);
  sun.target.position.set(sx, 0, sz);
  sun.target.updateMatrixWorld();
  sun.castShadow = camera.position.y < 520;

  // 更新
  if (state.mode === 'fp') {
    fpStep(dt);
  } else {
    if (!state.tween && !state.selftestLock) {
      // 上帝视角 WASD 平移
      let f = 0, s = 0;
      if (keys['KeyW']) f += 1;
      if (keys['KeyS']) f -= 1;
      if (keys['KeyD']) s += 1;
      if (keys['KeyA']) s -= 1;
      if (f || s) panTarget(-s * 30 * dt, f * 30 * dt, state.dist);
      setGodCam();
    }
  }
  updateTween(dt);
  waterMat.uniforms.uTime.value = now / 1000;
  updateLabels();
  updateCompass();

  renderer.render(scene, camera);

  // fps
  frames++; fpsT += dt;
  if (fpsT >= 0.5) {
    fps = Math.round(frames / fpsT);
    fpsEl.textContent = `FPS ${fps} · 体素 ${totalInstances.toLocaleString()} · 生成 ${buildMs}ms`;
    frames = 0; fpsT = 0;
    if (window.__selftest && !window.__selftestDone) {
      window.__selftestFrames = (window.__selftestFrames || 0) + 1;
      if (window.__selftestFrames > 4) {
        window.__selftestDone = true;
        const ok = document.createElement('div');
        ok.id = 'selftest';
        ok.textContent = `SELFTEST_OK fps=${fps} voxels=${totalInstances} chunks=${chunks.length} landmarks=${LANDMARKS.length} calls=${renderer.info.render.calls} webgl=${renderer.capabilities.isWebGL2 ? 'gl2' : 'gl1'}`;
        document.body.appendChild(ok);
      }
    }
  }
}
window.__selftest = location.search.includes('selftest');

// ---------- 启动 ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

$('btnStart').onclick = () => {
  $('overlay').classList.add('hidden');
  if (!document.pointerLockElement && state.mode === 'fp') lockPointer();
};
if (window.__selftest) {
  $('overlay').classList.add('hidden');
  const view = new URLSearchParams(location.search).get('view');
  const presets = {
    taidian: { pos: [150, 62, -112], tgt: [0, 14, -242] },
    top: { pos: [0, 1950, 60], tgt: [0, 0, -40] },
    wumen: { pos: [-70, 42, -575], tgt: [0, 14, -458] },
    fp: { pos: [0, 4.5, -470], tgt: [0, 6, -420] },
  };
  const p = presets[view];
  if (p) {
    state.selftestLock = true;
    setTimeout(() => {
      camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
      camera.lookAt(p.tgt[0], p.tgt[1], p.tgt[2]);
      state.target.set(p.tgt[0], p.tgt[1], p.tgt[2]);
      if (view === 'fp') state.mode = 'fp';
    }, 50);
  }
}
$('statLine').textContent = `体素方块 ${stats.struct.toLocaleString()}+${stats.fine.toLocaleString()} · 景点 ${LANDMARKS.length} 处 · 生成耗时 ${buildMs}ms`;

updateHint();
setModeButtons();
window.addEventListener('error', (e) => {
  const el = document.createElement('div');
  el.id = 'selftest';
  el.textContent = 'ERROR ' + (e.message || '');
  document.body.appendChild(el);
});
requestAnimationFrame(animate);
