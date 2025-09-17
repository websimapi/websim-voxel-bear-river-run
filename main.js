import * as THREE from 'three';
import nipplejs from 'nipplejs';

const canvas = document.getElementById('c');
const scoreEl = document.getElementById('score');
const restartBtn = document.getElementById('restart');

let renderer, scene, camera;
let bear, bearShadow;
let river, lanes = [];
let platforms = []; // active objects (logs + pads)
let pool = []; // object pool
let clock = new THREE.Clock();
let forwardSpeed = 5.0; // world scroll m/s
let laneWidth = 2.1;
let laneDepth = 2.1;
let worldZ = 0; // accumulated forward distance
let lateral = 0; // current lane index offset
let targetLateral = 0;
let hopPhase = 0; // 0..1 for hop animation
let alive = true;
let score = 0;
const rng = mulberry32(1337);

init();
animate();

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);

  scene = new THREE.Scene();
  scene.background = null;

  // Isometric-ish orthographic camera
  const aspect = innerWidth / innerHeight;
  const frustumSize = 18;
  camera = new THREE.OrthographicCamera(
    (frustumSize * aspect) / -2,
    (frustumSize * aspect) / 2,
    frustumSize / 2,
    frustumSize / -2,
    0.1,
    200
  );
  camera.position.set(12, 18, 14);
  camera.lookAt(0, 0, 0);

  addLights();
  addRiver();
  addBear();
  initLanes();
  spawnInitial();

  setupInput();
  window.addEventListener('resize', onResize);
  restartBtn.addEventListener('click', restart);
}

function addLights() {
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 10, 6);
  scene.add(sun);
  const fill = new THREE.HemisphereLight(0xffffff, 0xbdd7ff, 0.6);
  scene.add(fill);
}

function addRiver() {
  const blue = 0x56b6ff;
  const geo = new THREE.PlaneGeometry(200, 100, 1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: blue });
  river = new THREE.Mesh(geo, mat);
  river.rotation.x = -Math.PI / 2;
  river.position.y = -0.01;
  scene.add(river);
}

function addBear() {
  const g = new THREE.Group();

  // Materials (simple cheerful palette)
  const fur = new THREE.MeshLambertMaterial({ color: 0x9b6b43 });
  const darker = new THREE.MeshLambertMaterial({ color: 0x7d5536 });
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const black = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const pink = new THREE.MeshLambertMaterial({ color: 0xff97b1 });

  // Body (voxel blocks)
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 2.0), fur);
  body.position.set(0, 0.9, 0);
  g.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), fur);
  head.position.set(0, 1.8, 0.6);
  g.add(head);

  // Ears
  const earGeo = new THREE.BoxGeometry(0.4, 0.4, 0.2);
  const earL = new THREE.Mesh(earGeo, fur);
  earL.position.set(-0.45, 2.3, 0.7);
  const earR = earL.clone();
  earR.position.x *= -1;
  g.add(earL, earR);

  // Snout
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), darker);
  snout.position.set(0, 1.5, 1.1);
  g.add(snout);

  // Nose
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.15), black);
  nose.position.set(0, 1.55, 1.35);
  g.add(nose);

  // Eyes
  const eyeGeo = new THREE.BoxGeometry(0.12, 0.12, 0.06);
  const eyeL = new THREE.Mesh(eyeGeo, black);
  eyeL.position.set(-0.28, 1.7, 1.0);
  const eyeR = eyeL.clone();
  eyeR.position.x *= -1;
  g.add(eyeL, eyeR);

  // Belly patch
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.2), white);
  belly.position.set(0, 1.0, 0.7);
  g.add(belly);

  // Cheeks
  const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), pink);
  cheek.position.set(0.42, 1.5, 0.95);
  const cheek2 = cheek.clone();
  cheek2.position.x *= -1;
  g.add(cheek, cheek2);

  // Legs (simple blocks)
  const legGeo = new THREE.BoxGeometry(0.4, 0.6, 0.5);
  const lf = new THREE.Mesh(legGeo, darker); lf.position.set(-0.45, 0.3, 0.5);
  const rf = lf.clone(); rf.position.x *= -1;
  const lb = lf.clone(); lb.position.z = -0.5;
  const rb = lb.clone(); rb.position.x *= -1;
  g.add(lf, rf, lb, rb);

  // Simple "shadow"
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.95, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  bearShadow = shadow;

  g.position.set(0, 0, 0);
  scene.add(g, shadow);
  bear = g;
}

function initLanes() {
  // lanes are x positions: -2, -1, 0, 1, 2
  for (let i = -2; i <= 2; i++) lanes.push(i);
}

function spawnInitial() {
  // Pre-fill a forward strip of platforms
  for (let i = 0; i < 40; i++) {
    spawnRow(i * laneDepth + 6);
  }
}

function spawnRow(zPos) {
  // Each row gets a mix of lily pads and logs with gaps
  // Probability tuning for playability
  const pattern = rng() < 0.6 ? 'pads' : 'logs';

  lanes.forEach((laneIdx) => {
    const x = laneIdx * laneWidth;
    if (pattern === 'pads') {
      if (rng() < 0.75) {
        const pad = getPad();
        pad.position.set(x, 0, -zPos);
        pad.userData.type = 'pad';
        scene.add(pad);
        platforms.push(pad);
      }
    } else {
      if (rng() < 0.55) {
        const log = getLog(rng() < 0.5 ? 1 : 2);
        log.position.set(x, 0, -zPos);
        log.userData.type = 'log';
        scene.add(log);
        platforms.push(log);
      }
    }
  });

  // guarantee at least one platform in the row
  if (!platforms.some(p => Math.abs(p.position.z + zPos) < 0.001)) {
    const laneIdx = lanes[Math.floor(rng() * lanes.length)];
    const x = laneIdx * laneWidth;
    const pad = getPad();
    pad.position.set(x, 0, -zPos);
    pad.userData.type = 'pad';
    scene.add(pad);
    platforms.push(pad);
  }
}

function getPad() {
  const pad = takeFromPool('pad') || makePad();
  stylePad(pad);
  return pad;
}
function makePad() {
  const group = new THREE.Group();
  group.userData.kind = 'pad';
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.2, 16), new THREE.MeshLambertMaterial());
  top.position.y = 0.1;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.1, 16), new THREE.MeshLambertMaterial());
  rim.position.y = 0.05;
  group.add(top, rim);
  return group;
}
function stylePad(pad) {
  const greens = [0x7ddf64, 0x6ccc52, 0x8aea73, 0x77d85e];
  pad.children[0].material.color.setHex(pick(greens));
  pad.children[1].material.color.setHex(0x4fa043);
}

function getLog(len = 2) {
  const log = takeFromPool('log') || makeLog();
  const color = pick([0x9c6b3f, 0x8a5c36, 0x7a4f2d]);
  log.children.forEach(m => m.material.color.setHex(color));
  // set size by scaling z
  log.scale.set(1, 1, len);
  return log;
}
function makeLog() {
  const group = new THREE.Group();
  group.userData.kind = 'log';
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.8, 8), new THREE.MeshLambertMaterial());
  body.rotation.z = Math.PI / 2;
  const cap1 = new THREE.Mesh(new THREE.CircleGeometry(0.45, 8), new THREE.MeshLambertMaterial({ color: 0x6b3f22 }));
  cap1.rotation.y = Math.PI / 2;
  cap1.position.x = -0.9;
  const cap2 = cap1.clone();
  cap2.position.x = 0.9;
  group.add(body, cap1, cap2);
  return group;
}

function animate() {
  const dt = clock.getDelta();
  if (alive) update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function update(dt) {
  const scroll = forwardSpeed * dt;
  worldZ += scroll;

  // Auto hop animation cycles each laneDepth distance
  hopPhase += scroll / laneDepth;
  if (hopPhase >= 1) {
    hopPhase -= 1;
    // On each hop, spawn a new row ahead
    spawnRow(worldZ + 30);
    score += 1;
    scoreEl.textContent = String(score);
    checkLanding(); // validate current lane has a platform underfoot
  }

  // Bear lateral smoothing towards target lane
  lateral += (targetLateral - lateral) * Math.min(1, dt * 12);

  const bearX = lateral * laneWidth;
  const hopY = hopCurve(hopPhase) * 0.9; // bounce height
  const bearZ = -mod(worldZ, laneDepth); // local z oscillation for pace illusion

  bear.position.set(bearX, hopY, bearZ);
  bearShadow.position.set(bearX, 0.001, bearZ);
  bearShadow.material.opacity = 0.18 - hopY * 0.12;

  // Move platforms backward (by updating their world z relative to scroll)
  platforms.forEach(p => {
    p.position.z += scroll;
  });

  // Recycle platforms that moved behind camera
  for (let i = platforms.length - 1; i >= 0; i--) {
    const p = platforms[i];
    if (p.position.z > 8) {
      scene.remove(p);
      giveToPool(p);
      platforms.splice(i, 1);
    }
  }
}

function checkLanding() {
  // Find the nearest platform below bear's feet within small radius
  const x = bear.position.x;
  const z = bear.position.z;
  const thresholdX = laneWidth * 0.45;
  const thresholdZ = laneDepth * 0.6;

  let onPlatform = false;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (Math.abs(p.position.x - x) < thresholdX && Math.abs(p.position.z - z) < thresholdZ) {
      onPlatform = true;
      // fun nudge for pads
      if (p.userData.type === 'pad') {
        p.position.y = 0.03;
        setTimeout(() => { p.position.y = 0; }, 80);
      }
      break;
    }
  }
  if (!onPlatform) {
    gameOver();
  }
}

function gameOver() {
  alive = false;
  restartBtn.classList.remove('hidden');
}

function restart() {
  // reset world
  platforms.forEach(p => { scene.remove(p); giveToPool(p); });
  platforms = [];
  worldZ = 0;
  hopPhase = 0;
  lateral = 0;
  targetLateral = 0;
  score = 0;
  scoreEl.textContent = '0';
  alive = true;
  restartBtn.classList.add('hidden');
  spawnInitial();
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  const aspect = innerWidth / innerHeight;
  const frustumSize = 18;
  camera.left = -(frustumSize * aspect) / 2;
  camera.right = (frustumSize * aspect) / 2;
  camera.top = frustumSize / 2;
  camera.bottom = -frustumSize / 2;
  camera.updateProjectionMatrix();
}

/* Input */
const pressed = { left: false, right: false };
function setupInput() {
  window.addEventListener('keydown', (e) => {
    if (!alive && (e.key === ' ' || e.key === 'Enter')) restart();
    if (e.key === 'a' || e.key === 'ArrowLeft') { pressed.left = true; moveLeft(); }
    if (e.key === 'd' || e.key === 'ArrowRight') { pressed.right = true; moveRight(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'a' || e.key === 'ArrowLeft') pressed.left = false;
    if (e.key === 'd' || e.key === 'ArrowRight') pressed.right = false;
  });

  // Mobile joystick
  const zone = document.getElementById('joystick');
  if (zone) {
    nipplejs.create({
      zone,
      mode: 'static',
      position: { left: '70%', top: '70%' },
      size: 120,
      color: 'black',
      restOpacity: 0.2
    }).on('move', (evt, data) => {
      const dx = data.vector.x || 0;
      if (dx > 0.35) moveRight();
      else if (dx < -0.35) moveLeft();
    });
  }
}

function moveLeft() {
  if (!alive) return;
  targetLateral = clamp(targetLateral - 1, lanes[0], lanes[lanes.length - 1]);
}
function moveRight() {
  if (!alive) return;
  targetLateral = clamp(targetLateral + 1, lanes[0], lanes[lanes.length - 1]);
}

/* Utilities */
function hopCurve(t) {
  // simple parabolic hop, 0..1
  return 4 * t * (1 - t);
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mod(n, m) { return ((n % m) + m) % m; }
function pick(arr) { return arr[(arr.length * rng()) | 0]; }

function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Object pooling */
function takeFromPool(kind) {
  const idx = pool.findIndex(p => p.userData.kind === kind);
  if (idx >= 0) return pool.splice(idx, 1)[0];
  return null;
}
function giveToPool(obj) {
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  pool.push(obj);
}

