import * as THREE from 'https://esm.sh/three@0.164.1';
import { OrbitControls } from 'https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/RGBELoader.js';

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

  renderer = new THREE.WebGLRenderer({ antialias: true });
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
  new RGBELoader().load(path, (texture) => {
    const envMap = pmrem.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    texture.dispose();
  });
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

/* --------------------------------------------------------------------------
 * Model Loading
 * -------------------------------------------------------------------------- */
function loadModel(url) {
  const loader = new GLTFLoader();
  loader.load(url, (gltf) => {
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

    // Apply default hardware color
    const defaultKey = document.querySelector('input[name="hardwareColor"]:checked')?.dataset.key;
    if (defaultKey && hardwareMaterials[defaultKey]) {
      applyHardwareMaterial(hardwareMaterials[defaultKey]);
    }

   // dumpMeshNames();
  //  window.model = model; // for debugging
  }, undefined, (err) => {
    console.error('GLB load error:', err);
  });
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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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

function classifyByComponent(obj) {
  const compName = getComponentName(obj).toLowerCase();
  if ((!/body\d+$/i.test(compName) || /(hcs|sts|nut|fan|36sth)/i.test(compName)) &&
      compName !== '' && !/(nitehawk-36_v13)/i.test(compName)) {

    if (/(?:a_|\/a_)/.test(compName)) return 'accent';
    if (/(?:c_|\/c_)/.test(compName)) return 'led';
    if (/(extrusion)/i.test(compName)) return 'opaque';
    if (/(36sth)/i.test(compName)) return 'motor';
    if (/(hcs|sts|nut)/i.test(compName)) return 'hardware';
    if (compName.includes('fan')) return 'fan';
    if ((!compName.startsWith('a_') && !compName.startsWith('c_') && !compName.startsWith('o_')) &&
        (/_x\d+_?$/i.test(compName) || !/body\d+$/i.test(compName)))
      return 'primary';

    return 'other';
  }
  return null;
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

function applyCurrentColors() {
  if (!model) return;
  const primaryColor = new THREE.Color(primaryInput.value);
  const accentColor = new THREE.Color(accentInput.value);
  const ledColor = new THREE.Color(ledInput.value);

  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const cls = classifyByComponent(obj);
    let chosen = null;

    switch (cls) {
      case "accent": chosen = accentColor; break;
      case "primary": chosen = primaryColor; break;
      case "led": chosen = ledColor; break;
      case "extrusion": chosen = frameInput.value; break;
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
          m.roughness = 0.4;
        }
      }
    });
  });
}

/* --------------------------------------------------------------------------
 * Animation Loop
 * -------------------------------------------------------------------------- */
function animate() {
  spotLight.position.set(camera.position.x + 1, camera.position.y + 1, camera.position.z + 1);
  renderer.render(scene, camera);
  controls.update();
  requestAnimationFrame(animate);
}

/* --------------------------------------------------------------------------
 * Init
 * -------------------------------------------------------------------------- */
initScene();
initLighting();
loadEnvironmentMap('./assets/hdri/bg.hdr');
bindHardwareRadioButtons();
loadModel('./assets/toolhead.glb');
animate();
