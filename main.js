import * as THREE from 'https://esm.sh/three@0.164.1';
import { OrbitControls } from 'https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/RGBELoader.js';

/* --------------------------------------------------------------------------
 * Lightweight Loader UI (JS-injected HTML + CSS)
 * -------------------------------------------------------------------------- */
function createLoaderUI() {
  const style = document.createElement('style');
  style.textContent = `
    #loader{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
      background:rgba(10,10,10,.92);transition:opacity .25s ease}
    #loader.hidden{opacity:0;pointer-events:none}
    .loader-box{min-width:220px;padding:16px 18px;background:rgba(20,20,20,.95);border-radius:12px;
      box-shadow:0 12px 40px rgba(0,0,0,.45);color:#fff;font:14px/1.4 system-ui,sans-serif;
      display:grid;gap:10px;justify-items:center}
    .spinner{width:32px;height:32px;border-radius:50%;border:3px solid rgba(255,255,255,.2);
      border-top-color:#fff;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .loader-text strong{display:block;font-size:15px}
    #loader-progress{opacity:.8}
    @media (prefers-reduced-motion: reduce){
      .spinner{animation:none;border-top-color:rgba(255,255,255,.7)}
      #loader{transition:none}
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'loader';
  root.innerHTML = `
    <div class="loader-box" role="status" aria-live="polite">
      <div class="spinner" aria-hidden="true"></div>
      <div class="loader-text">
        <strong>Loading model…</strong>
        <span id="loader-progress">0%</span>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const progressEl = root.querySelector('#loader-progress');

  return {
    root,
    progressEl,
    show(initial = 0) {
      root.classList.remove('hidden');
      progressEl.textContent = `${initial}%`;
    },
    set(pct) {
      progressEl.textContent = `${Math.max(0, Math.min(100, Math.round(pct)))}%`;
    },
    fail(msg = 'Failed to load') {
      progressEl.textContent = msg;
    },
    hide() {
      root.classList.add('hidden');
    }
  };
}

const loaderUI = createLoaderUI();
function addVersionDropdown() {
  const panel = document.getElementById('controls-panel') || document.querySelector('.controls-panel');
  if (!panel) return;

  // Avoid duplicates if hot-reloaded
  if (panel.querySelector('#versionSelect')) return;

  const group = document.createElement('div');
  group.className = 'control-group';
  group.style.marginTop = '10px';

  group.innerHTML = `
    <label for="versionSelect" style="display:block;margin-bottom:6px;font-weight:600;">Version</label>
    <select id="versionSelect" style="width:100%;padding:6px 8px;border-radius:8px;background:#222;color:#fff;border:1px solid rgba(255,255,255,0.15)">
      <option value="sf" selected>SF</option>
      <option value="hf">HF</option>
      <option value="uhf">UHF</option>
    </select>
  `;

  panel.appendChild(group);

  const sel = group.querySelector('#versionSelect');
  sel.addEventListener('change', () => {
    setActiveVersion(sel.value);
  });
}

/* --------------------------------------------------------------------------
 * Shared LoadingManager (tracks HDRI + GLB + any textures)
 * -------------------------------------------------------------------------- */
const loadingManager = new THREE.LoadingManager();
let safetyTimer = null;

loadingManager.onStart = () => {
  loaderUI.show(0);
  // Optional “stuck” hint if server doesn’t provide totals:
  clearTimeout(safetyTimer);
  safetyTimer = setTimeout(() => loaderUI.set('…'), 4000);
};
loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  // Coarse progress across all assets being tracked by the manager
  if (itemsTotal) loaderUI.set((itemsLoaded / itemsTotal) * 100);
};
loadingManager.onLoad = () => {
  clearTimeout(safetyTimer);
  // Give the renderer a tick to present the first frame, then fade:
  requestAnimationFrame(() => loaderUI.hide());
};

/* --------------------------------------------------------------------------
 * Globals
 * -------------------------------------------------------------------------- */
let scene, camera, renderer, controls, model, hemiLight, spotLight, pmrem;

/* --------------------------------------------------------------------------
 * Scene / Camera / Renderer Setup
 * -------------------------------------------------------------------------- */
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdddddd);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 5000);
  camera.position.set(0, 0.5, 2);

  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  // Cap device pixel ratio for mobile performance (1.25–1.5 is a sweet spot)
  const DPR_CAP = 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));

  // Small bump so colors don’t look washed out on phones
  renderer.toneMappingExposure = 0.9; // was 0.5

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  pmrem = new THREE.PMREMGenerator(renderer);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enableZoom = true;
  controls.enablePan = true;
}

/* --------------------------------------------------------------------------
 * Lighting
 * -------------------------------------------------------------------------- */
function initLighting() {
  hemiLight = new THREE.HemisphereLight(0xffffff, 0x080820, 1);
  scene.add(hemiLight);

  spotLight = new THREE.SpotLight(0xffffff, 1);
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 4096;
  spotLight.shadow.mapSize.height = 4096;
  scene.add(spotLight);
}

/* --------------------------------------------------------------------------
 * Environment Map
 * -------------------------------------------------------------------------- */
function loadEnvironmentMap(path) {
  // Track HDRI via the shared manager
  new RGBELoader(loadingManager).load(
    path,
    (texture) => {
      const envMap = pmrem.fromEquirectangular(texture).texture;
      scene.environment = envMap;
      texture.dispose();
    },
    // xhr progress for HDRI (optional; many servers omit totals)
    (xhr) => {
      if (xhr.total) {
        const pct = Math.min(99, Math.round((xhr.loaded / xhr.total) * 100));
        loaderUI.set(pct);
      }
    },
    (err) => {
      console.error('HDRI load error:', err);
      loaderUI.fail('Env map failed');
      // Don’t block forever:
      setTimeout(() => loaderUI.hide(), 1200);
    }
  );
}

/* --------------------------------------------------------------------------
 * Hardware Material Presets
 * -------------------------------------------------------------------------- */
const hardwareMaterials = {
  blackOxide: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.85, roughness: 0.4 }),
  stainlessSteel: new THREE.MeshStandardMaterial({ metalness: 0.95, roughness: 0.15}),
  blackNickel: new THREE.MeshStandardMaterial({ color: 0x222b36, metalness: 0.9, roughness: 0.25 })
};

function applyHardwareMaterial(material) {
  if (!model) return;
  model.traverse(obj => {
    if (obj.isMesh && classifyByComponent(obj) === "hardware") {
      obj.material = material.clone();
    }
  });
}

function bindHardwareRadioButtons() {
  document.querySelectorAll('input[name="hardwareColor"]').forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.key;
      applyHardwareMaterial(hardwareMaterials[key]);
    });
  });
}

// Extract suffix version from the class returned by classifyByComponent
// Returns: 'sf' | 'hf' | 'uhf' | null
function getClassVersion(cls) {
  if (!cls) return null;
  if (cls.endsWith('-sf'))  return 'sf';
  if (cls.endsWith('-hf'))  return 'hf';
  if (cls.endsWith('-uhf')) return 'uhf';
  return null;
}

// Current selected version (default SF)
let ACTIVE_VERSION = 'sf';

// Show only meshes that match ACTIVE_VERSION; non-versioned always visible
function applyVersionVisibility(root = model) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const cls = classifyByComponent(o);
    const ver = getClassVersion(cls);
    // Visible if: no version tag OR matches current selection
    o.visible = (ver === null) || (ver === ACTIVE_VERSION);
  });
}

let fan4010Node = null;
let fan4010BaseY = null;

function setActiveVersion(v) {
  const vNorm = String(v || '').toLowerCase();
  if (!['sf','hf','uhf'].includes(vNorm)) return;
  ACTIVE_VERSION = vNorm;

  applyVersionVisibility();

  // convert desired offsets
  const offsetMeters =
    vNorm === 'hf'  ? -mm(8.5) :
    vNorm === 'uhf' ? -mm(17)  : 0;

  model.traverse(o => {
    if (!o.isMesh) return;
    const cls = classifyByComponent(o);
    if (cls !== 'fan-4010') return;

    // must have a cached base from load-time
    if (!o.userData.basePos) o.userData.basePos = o.position.clone();

    // 1) hard reset to base (ensures no cumulative drift)
    o.position.copy(o.userData.basePos);

    // 2) apply offset along world-down in parent space
    if (offsetMeters !== 0) {
      const dirLocal = localDownDir(o);
      o.position.addScaledVector(dirLocal, offsetMeters);
    }
  });
}

/* --------------------------------------------------------------------------
 * Model Loading
 * -------------------------------------------------------------------------- */
function loadModel(url) {
  // Use the shared manager so the overlay tracks this too
  const loader = new GLTFLoader(loadingManager);

  loader.load(
    url,
    (gltf) => {
      model = gltf.scene.children[0];

      // Fix orientation & center
      model.rotation.x = -Math.PI / 2;
      centerModel();

      // Add floor
      addFloor();

      scene.add(model);

      // Mesh settings
      model.traverse(obj => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material.map) obj.material.map.anisotropy = 16;

        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (!m) return;
          if ('roughness' in m) m.roughness = 0.35;
          if ('metalness' in m) m.metalness = 0.1;
        });
      });

      // Frame and apply colors
      frameModel();
      applyCurrentColors();

      model.traverse(o => {
  if (!o.isMesh) return;
  const cls = classifyByComponent(o);
  if (cls === 'fan-4010') {
    // only set once
    if (!o.userData.basePos) o.userData.basePos = o.position.clone();
  }
});

      setActiveVersion('sf');
      // Apply default hardware color
      const defaultKey = document.querySelector('input[name="hardwareColor"]:checked')?.dataset.key;
      if (defaultKey && hardwareMaterials[defaultKey]) {
        applyHardwareMaterial(hardwareMaterials[defaultKey]);
      }

      // Warm up shaders so first frame looks crisp before we hide loader
      renderer.compile(scene, camera);
      window.model = model;
      dumpMeshNames();
    },
    // Fine-grained % for GLB fetch (if server provides totals)
    (xhr) => {
      if (xhr.total) {
        const pct = Math.min(99, Math.round((xhr.loaded / xhr.total) * 100));
        loaderUI.set(pct);
      }

    },
    (err) => {
      console.error('GLB load error:', err);
      loaderUI.fail('Model failed');
      setTimeout(() => loaderUI.hide(), 1500);
    }
  );
}


function centerModel() {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);

  box.setFromObject(model);
  const yMin = box.min.y;
  model.position.y -= (yMin - yMin / 12);
}

function addFloor() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.ShadowMaterial({ opacity: 0.3 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);
}

/* --------------------------------------------------------------------------
 * Framing & Resizing
 * -------------------------------------------------------------------------- */
function frameModel() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Math.max(sphere.radius, 0.001);

  controls.target.copy(center);
  camera.position.set(center.x, center.y, center.z + radius * 2.2);
  camera.near = Math.max(0.01, radius / 100);
  camera.far = Math.max(1000, radius * 10);
  camera.updateProjectionMatrix();
  controls.update();
}

let resizeTO;
function resize() {
  if (!renderer || !camera) return; // ← guard until initScene() runs
  const w = document.documentElement.clientWidth || window.innerWidth;
  const h = document.documentElement.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  clearTimeout(resizeTO);
  resizeTO = setTimeout(resize, 150);
}, { passive: true });

/* --------------------------------------------------------------------------
 * Component Classification
 * -------------------------------------------------------------------------- */
function nodePath(obj) {
  const parts = [];
  for (let n = obj; n; n = n.parent) parts.push(n.name || '(unnamed)');
  return parts.reverse().join(' / ');
}

function getComponentName(obj) {
  return (nodePath(obj) || '').trim();
}
// Normalize + tokenize once
function tokenizeName(raw) {
  const norm = String(raw || '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')   // " / " → "/"
    .replace(/\([^)]*\)/g, '')   // remove "(1)", "(v8)", etc.
    .replace(/[\s]+/g, ' ')      // collapse stray spaces
    .trim();

  // Split on "/", "_", "-" (keep words); drop empty + pure version tokens
  const tokens = norm
    .split(/[\/_\-]+/)
    .filter(Boolean)
    .filter(t => !/^v?\d+$/.test(t)); // drop "v8", "12", etc.

  return { norm, tokens };
}

const has = (tokens, word) => tokens.includes(word);
const hasAny = (tokens, list) => list.some(w => tokens.includes(w));
// --- Classifier ------------------------------------------------------------
function classifyByComponent(objOrName) {
  const compName = typeof objOrName === 'string' ? objOrName : getComponentName(objOrName);
  const { norm, tokens } = tokenizeName(compName);

  // 1) Quick direct buckets
  if (has(tokens, 'led'))         return 'led';
  if (has(tokens, 'misumi'))      return 'frame';
  if (has(tokens, 'motor'))       return 'motor';
  if (has(tokens, 'fasteners'))   return 'hardware';
   

  // Helpers for radio family
  const isUHF = has(tokens, 'uhf');
  const isHF  = !isUHF && has(tokens, 'hf'); // guard so UHF wins over HF
  const isSF  = (!isHF && !isUHF) && (has(tokens, 'sf') || has(tokens, 'standard') || (has(tokens, 'beacon') && has(tokens, 'mount')));

  // 2) Accent branch
  if (has(tokens, 'accent')) {
    const inDucts = has(tokens, 'duct') || has(tokens, 'ducts');
    if (inDucts) {
      if (isUHF) return 'accent-uhf';
      if (isHF)  return 'accent-hf';
      if (isSF)  return 'accent-sf';
    }
    return 'accent';
  }
    if (hasAny(tokens, ['fan','fans'])) {
    if (tokens.includes('blower') || tokens.some(t => t.startsWith('blower'))) {
      return 'fan-4010';       // special class for blower fans
    }
    if (tokens.includes('axial') || tokens.some(t => t.startsWith('2510'))) {
      return 'fan-2510';       // special class for blower fans
    }
    return 'fan';
  }
  // 3) Primary branch
  if (has(tokens, 'primary')) {
    // Your original check looked for the literal "main_bodies".
    // Because we split on "_", detect either the literal or both tokens.
    const inMainBodies = norm.includes('main_bodies')
                      || (has(tokens, 'main') && has(tokens, 'bodies'))
                      || (has(tokens, 'probe') && has(tokens, 'mounts'))

    if (inMainBodies) {
      if (isUHF) return 'primary-uhf';
      if (isHF)  return 'primary-hf';
      if (isSF)  return 'primary-sf';
    }
    return 'primary';
  }

  // 4) Fallback
  return 'other';
}


function dumpMeshNames() {
  if (!model) return console.warn('No model loaded yet.');
  const rows = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    const cls = classifyByComponent(o);
    if (!cls) return;
    rows.push({ class: cls, name: o.name || '(unnamed)', path: nodePath(o) });
  });
  rows.sort((a, b) => a.class.localeCompare(b.class) || a.name.localeCompare(b.name));
  console.table(rows);
}

/* --------------------------------------------------------------------------
 * Color Application
 * -------------------------------------------------------------------------- */
const primaryInput = document.getElementById('primaryColor');
const accentInput = document.getElementById('accentColor');
const ledInput = document.getElementById('ledColor');
const frameInput = document.getElementById('frameColor');

[primaryInput, accentInput, ledInput, frameInput].forEach(input => {
  input.addEventListener('input', applyCurrentColors);
});

function applyCurrentColors(doItRight = false) {
  if (!model) return;

  if (doItRight === true) {
    primaryInput.value = '#63666a';
    accentInput.value = '#44d62c';
    ledInput.value = '#ffffff';
    frameInput.value = '#020202ff';
    doItRight = false;
  }

  const primaryColor = new THREE.Color(primaryInput.value);
  const accentColor = new THREE.Color(accentInput.value);
  const ledColor = new THREE.Color(ledInput.value);
  const frameColor = new THREE.Color(frameInput.value);

  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const cls = classifyByComponent(obj);
    let chosen = null;

switch (cls) {
  case "accent":
  case "accent-uhf":
  case "accent-hf":
  case "accent-sf":
    chosen = accentColor;
    break;

  case "primary":
  case "primary-uhf":
  case "primary-hf":
  case "primary-sf":
    chosen = primaryColor;
    break;

  case "led":
    chosen = ledColor;
    break;

  case "frame":
    chosen = frameColor;
    break;
    

  case "fan-4010":
  case "fan-2510":
    chosen = new THREE.Color(0x222222);
    break;

  case "motor":
    chosen = new THREE.Color(0x222222);
    break;

  default:
    return;
}

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach(m => {
      if (m && m.color) {
        m.color.copy(chosen);
        if (cls === "motor") {
          m.metalness = 1.0;
          m.roughness  = 0.4;
        }
      }
    });
  });
}

/* --------------------------------------------------------------------------
 * Animation Loop
 * -------------------------------------------------------------------------- */
let running = true;
document.addEventListener('visibilitychange', () => {
  running = document.visibilityState === 'visible';
}, { passive: true });

function animate() {
  requestAnimationFrame(animate);
  if (!running) return;
  spotLight.position.set(camera.position.x + 1, camera.position.y + 1, camera.position.z + 1);
  controls.update();
  renderer.render(scene, camera);
}

/* --------------------------------------------------------------------------
 * Init
 * -------------------------------------------------------------------------- */
initScene();
initLighting();
loadEnvironmentMap('./assets/hdri/bg.hdr');
bindHardwareRadioButtons();
addVersionDropdown();   
loadModel('./assets/toolhead1.glb');
resize();

// Mobile-only tap-to-slide bottom sheet
(function setupMobileSheetToggle() {
  const panel   = document.getElementById('controls-panel') || document.querySelector('.controls-panel');
  const grabber = panel?.querySelector('.panel-grabber');
  if (!panel || !grabber) return;

  const mq = window.matchMedia('(max-width: 640px)');

  function isClosed() { return panel.classList.contains('closed'); }
  function setOpen(open) {
    panel.classList.toggle('closed', !open);
    grabber.setAttribute('aria-expanded', String(open));
    grabber.textContent = open ? 'Hide Controls' : 'Show Controls';
  }
  function syncForViewport() {
    if (!mq.matches) {
      setOpen(true);
    } else {
      if (!grabber.dataset._init) setOpen(false);
    }
    grabber.dataset._init = '1';
  }

  grabber.addEventListener('click', () => {
    if (!mq.matches) return; // ignore on desktop
    setOpen(isClosed());
  }, { passive: true });

  (mq.addEventListener ? mq.addEventListener('change', syncForViewport)
                       : mq.addListener(syncForViewport)); // Safari fallback
  window.addEventListener('resize', syncForViewport, { passive: true });

  syncForViewport();
})();

document.getElementById('screenshotFab')?.addEventListener('click', () => {
  try {
    const imageDataURL = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = imageDataURL;
    a.download = `ChromaColony-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error('Screenshot failed:', err);
  }
});

document.getElementById('doitright')?.addEventListener('click', () => {
  try {
    applyCurrentColors(true);
  } catch (err) {}
});

animate();


window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    dumpMeshNames();
  }
});

const mm = (n) => n / 1000;

// world-down expressed in the mesh's *parent* space
function localDownDir(obj) {
  if (!obj.parent) return new THREE.Vector3(0, 1, 0);
  const parentRot = new THREE.Matrix4().extractRotation(obj.parent.matrixWorld);
  const invParentRot = new THREE.Matrix4().copy(parentRot).invert();
  return new THREE.Vector3(0, 1, 0).applyMatrix4(invParentRot).normalize();
}