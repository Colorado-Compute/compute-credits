// The 3D view: one bar per row, grouped on one plate per lane. three.js comes in from app.js; the orbit controls are
// written here because cdnjs ships no OrbitControls for current three.js. Height is monthly price on a log scale,
// and a free row is a flat tile.

const PLATE = 7.4;
const GAP = 1.6;
const SIDE = 7; // slots per plate side
const BAR = 0.78;
const FLAT = 0.14;

export function createScene({ THREE, host, rows, lanes, laneNames, reduced, onPick, onLane }) {
  const css = getComputedStyle(host);
  const col = (name) => new THREE.Color(css.getPropertyValue(name).trim());
  const C = {
    free: col('--stage-free'), paid: col('--stage-paid'), none: col('--stage-none'),
    ghost: col('--stage-ghost'), plate: col('--stage-plate'), white: new THREE.Color('#ffffff'),
  };

  const holder = host.querySelector('.scene-canvas');
  const labelBox = host.querySelector('.scene-labels');
  const tip = host.querySelector('.scene-tip');

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D view with one bar per plan, grouped by lane. The cards below list the same plans.');
  holder.append(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-9, 22, 14);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);

  // ----- data -----
  const maxPrice = Math.max(1, ...rows.map((r) => r.price_month || 0));
  const heightOf = (r) => (r.price_month > 0 ? 0.35 + 4.6 * (Math.log1p(r.price_month) / Math.log1p(maxPrice)) : FLAT);
  const kindColor = (r) => (r.price_month === 0 ? C.free : r.price_month > 0 ? C.paid : C.none);
  const byLane = Object.fromEntries(lanes.map((l) => [l, []]));
  for (const r of rows) byLane[r.lanes[0]]?.push(r);
  for (const l of lanes) byLane[l].sort((a, b) => (a.price_month ?? 0) - (b.price_month ?? 0) || a.name.localeCompare(b.name));
  const items = []; // one per instance
  lanes.forEach((l, li) => byLane[l].forEach((r, k) => items.push({ r, lane: li, slot: k, x: 0, z: 0 })));
  const n = items.length;

  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), n);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const plateGeo = new THREE.BoxGeometry(PLATE, 0.2, PLATE);
  const plateMat = new THREE.MeshLambertMaterial({ color: C.plate });
  const plates = lanes.map(() => { const m = new THREE.Mesh(plateGeo, plateMat); scene.add(m); return m; });

  const curH = new Float32Array(n);
  const tgtH = new Float32Array(n);
  const curC = items.map(() => new THREE.Color(C.ghost));
  const tgtC = items.map(() => new THREE.Color(C.ghost));
  const vis = new Uint8Array(n).fill(1);
  const delay = items.map((it) => (reduced ? 0 : it.lane * 0.07 + it.slot * 0.014));
  let hover = -1;
  let cols = 3;

  // ----- layout: plates in a grid of 3 columns, or 2 on a tall panel -----
  const centers = [];
  function layout(c) {
    cols = c;
    const rowsN = Math.ceil(lanes.length / cols);
    lanes.forEach((_, i) => {
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const cx = (gx - (cols - 1) / 2) * (PLATE + GAP);
      const cz = (gy - (rowsN - 1) / 2) * (PLATE + GAP);
      centers[i] = { x: cx, z: cz };
      plates[i].position.set(cx, -0.1, cz);
    });
    for (const it of items) {
      const sx = it.slot % SIDE;
      const sz = Math.floor(it.slot / SIDE);
      it.x = centers[it.lane].x + (sx - (SIDE - 1) / 2);
      it.z = centers[it.lane].z + ((SIDE - 1) / 2 - sz); // cheapest at the front, dearest at the back
    }
  }

  // ----- camera: our own orbit -----
  const target = new THREE.Vector3(0, 1.4, 0);
  const orbit = { theta: 0, phi: 0.98, zoom: 1, auto: !reduced, baseR: 34 };
  let sway = 0;
  let clock = 0;
  function place() {
    if (orbit.auto) sway = Math.sin(clock * 0.32) * (cols === 2 ? 0.3 : 0.5);
    const R = orbit.baseR * orbit.zoom;
    const th = orbit.theta + sway;
    camera.position.set(target.x + R * Math.sin(orbit.phi) * Math.sin(th), target.y + R * Math.cos(orbit.phi), target.z + R * Math.sin(orbit.phi) * Math.cos(th));
    camera.lookAt(target);
  }
  function stopAuto() {
    if (!orbit.auto) return;
    orbit.theta += sway;
    sway = 0;
    orbit.auto = false;
    api.onAuto?.(false);
  }
  let w = 1;
  let hgt = 1;
  function fit() {
    const rowsN = Math.ceil(lanes.length / cols);
    const planW = cols * PLATE + (cols - 1) * GAP;
    const planD = rowsN * PLATE + (rowsN - 1) * GAP;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = w / hgt;
    const Rw = (planW * 0.62 + planD * 0.16) / (t * aspect);
    const Rh = ((planD * 0.45 + 9) * 0.7) / t;
    orbit.baseR = Math.max(Rw, Rh, 24);
  }

  // ----- labels -----
  const labels = lanes.map((l, i) => {
    const count = document.createElement('span');
    count.className = 'n';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'i');
    icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${l}`);
    icon.append(use);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lane-label';
    b.append(icon, laneNames[l], count);
    b.addEventListener('click', () => onLane(l));
    labelBox.append(b);
    return { b, count, i };
  });
  const v3 = new THREE.Vector3();
  function placeLabels() {
    labels.forEach(({ b, i }) => {
      v3.set(centers[i].x, 0, centers[i].z + PLATE / 2 + 1.3).project(camera);
      b.classList.add('on');
      b.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * hgt}px) translate(-50%, -50%)`;
    });
  }

  // ----- drawing -----
  const dummy = new THREE.Object3D();
  const hot = new THREE.Color();
  let dirty = true;
  let last = 0;
  let animating = true;
  let t0 = 0;
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    clock += dt;
    if (!t0) t0 = clock;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 7);
    let moving = false;
    for (let i = 0; i < n; i++) {
      const want = clock - t0 >= delay[i] ? tgtH[i] : 0;
      curH[i] += (want - curH[i]) * k;
      if (Math.abs(want - curH[i]) > 0.003) moving = true; else curH[i] = want;
      curC[i].lerp(tgtC[i], k);
      const hh = Math.max(curH[i], 0.001);
      const it = items[i];
      dummy.position.set(it.x, hh / 2, it.z);
      dummy.scale.set(BAR, hh, BAR);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      hot.copy(curC[i]);
      if (i === hover) hot.lerp(C.white, 0.4);
      mesh.setColorAt(i, hot);
    }
    animating = moving;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  // ----- picking -----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pending = null;
  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    mesh.computeBoundingSphere();
    for (const hit of ray.intersectObject(mesh)) if (vis[hit.instanceId]) return hit.instanceId;
    return -1;
  }
  function showTip(i, clientX, clientY) {
    if (i < 0) { tip.hidden = true; return; }
    const r = items[i].r;
    const price = r.price_month === 0 ? 'Free' : r.price_month > 0 ? `${r.currency === 'EUR' ? '€' : '$'}${r.price_month}/mo` : 'No set price';
    tip.replaceChildren();
    const a = document.createElement('div'); a.className = 'tip-head'; a.textContent = r.name;
    const b = document.createElement('div'); b.className = 'tip-line'; b.textContent = `${r.provider}, ${price}`;
    tip.append(a, b);
    tip.hidden = false;
    const hr = host.getBoundingClientRect();
    const x = Math.min(clientX - hr.left + 14, hr.width - tip.offsetWidth - 8);
    const y = Math.min(clientY - hr.top + 14, hr.height - tip.offsetHeight - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  // ----- input -----
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved > 5) {
        stopAuto();
        orbit.theta -= dx * 0.008;
        if (e.pointerType === 'mouse') orbit.phi = Math.min(1.45, Math.max(0.3, orbit.phi - dy * 0.006));
        dirty = true;
      }
    } else if (e.pointerType === 'mouse') {
      pending = { x: e.clientX, y: e.clientY };
      dirty = true;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const was = drag;
    drag = null;
    if (was && was.moved <= 5) {
      const i = pickAt(e.clientX, e.clientY);
      if (i >= 0) onPick(items[i].r.id);
    }
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { pending = null; if (hover >= 0) { hover = -1; showTip(-1); dirty = true; } });
  canvas.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return; // a plain scroll belongs to the page
    e.preventDefault();
    api.zoom(Math.exp(e.deltaY * 0.002));
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const keys = { ArrowLeft: () => { orbit.theta += 0.12; }, ArrowRight: () => { orbit.theta -= 0.12; },
      ArrowUp: () => { orbit.phi = Math.max(0.3, orbit.phi - 0.08); }, ArrowDown: () => { orbit.phi = Math.min(1.45, orbit.phi + 0.08); },
      '+': () => api.zoom(0.88), '=': () => api.zoom(0.88), '-': () => api.zoom(1.14) };
    if (!keys[e.key]) return;
    e.preventDefault();
    stopAuto();
    keys[e.key]();
    dirty = true;
  });

  // ----- size and loop -----
  function resize() {
    const r = host.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width));
    hgt = Math.max(1, Math.round(r.height));
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    const want = w / hgt < 1.15 ? 2 : 3;
    if (want !== cols) layout(want);
    fit();
    dirty = true;
  }
  new ResizeObserver(resize).observe(host);

  let onScreen = true;
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; if (onScreen) { last = performance.now(); dirty = true; } }).observe(host);
  function frame(now) {
    requestAnimationFrame(frame);
    if (!onScreen || document.hidden) return;
    if (pending) {
      const i = pickAt(pending.x, pending.y);
      if (i !== hover) { hover = i; canvas.style.cursor = i >= 0 ? 'pointer' : drag ? 'grabbing' : 'grab'; }
      showTip(i, pending.x, pending.y);
      pending = null;
    }
    if (!(dirty || animating || orbit.auto)) return;
    step(now);
    place();
    placeLabels();
    renderer.render(scene, camera);
    dirty = false;
  }

  // ----- public -----
  const api = {
    onAuto: null,
    setVisible(ids, laneFilter) {
      items.forEach((it, i) => {
        const on = ids.has(it.r.id);
        vis[i] = on ? 1 : 0;
        tgtH[i] = on ? heightOf(it.r) : 0.05;
        tgtC[i].copy(on ? kindColor(it.r) : C.ghost);
      });
      labels.forEach(({ b, count, i }) => {
        count.textContent = String(byLane[lanes[i]].filter((r) => ids.has(r.id)).length);
        b.setAttribute('aria-pressed', String(laneFilter.includes(lanes[i])));
      });
      dirty = true;
    },
    zoom(f) { orbit.zoom = Math.min(1.8, Math.max(0.45, orbit.zoom * f)); dirty = true; },
    reset() { orbit.theta = 0; orbit.phi = 0.98; orbit.zoom = 1; sway = 0; dirty = true; },
    setAuto(on) { if (on) { orbit.theta = 0; orbit.auto = true; } else stopAuto(); dirty = true; },
    get auto() { return orbit.auto; },
  };
  layout(3);
  resize();
  tgtC.forEach((c, i) => c.copy(kindColor(items[i].r)));
  items.forEach((it, i) => { tgtH[i] = heightOf(it.r); });
  requestAnimationFrame(frame);

  // the host's own buttons
  host.querySelector('[data-act=rotate]').addEventListener('click', (e) => { api.setAuto(!orbit.auto); e.currentTarget.setAttribute('aria-pressed', String(orbit.auto)); });
  api.onAuto = (on) => host.querySelector('[data-act=rotate]').setAttribute('aria-pressed', String(on));
  host.querySelector('[data-act=reset]').addEventListener('click', () => api.reset());
  host.querySelector('[data-act=in]').addEventListener('click', () => api.zoom(0.85));
  host.querySelector('[data-act=out]').addEventListener('click', () => api.zoom(1.18));
  host.querySelector('[data-act=rotate]').setAttribute('aria-pressed', String(orbit.auto));
  return api;
}
