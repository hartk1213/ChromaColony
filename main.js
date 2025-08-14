import * as THREE from 'https://esm.sh/three@0.164.1';
import { OrbitControls } from 'https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'https://esm.sh/three@0.164.1/examples/jsm/loaders/RGBELoader.js';


let scene, camera, renderer, controls, model, hemiLight, spotLight;
let extruderKnob = null;
// ---------- scene / renderer ----------
scene = new THREE.Scene();
scene.background = new THREE.Color(0xdddddd);

camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 5000);
camera.position.set(0, 0.5, 2);


//scene.add(new THREE.AxesHelper(500)) /Axis helper to show X,Y,Z axes

renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// after creating `renderer`
//renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);

// ---------- controls (yaw only; no zoom/pan) ----------
controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableZoom = true;
controls.enablePan = true;
// ---------- lighting (bright neutral) ----------
// replace your current light block with:
// scene.add(new THREE.HemisphereLight(0xffffff, 0xeeeeee, 1.1));

// const key  = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(5, 6, 4);   scene.add(key);
// const fill = new THREE.DirectionalLight(0xffffff, 1.0); fill.position.set(-4, 3, -2); scene.add(fill);
// const rim  = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(0, 5, -6);  scene.add(rim);

// scene.add(new THREE.AmbientLight(0xffffff, 0.45));
hemiLight = new THREE.HemisphereLight(0xffffff, 0x080820, 4);
scene.add(hemiLight);
hemiLight.intensity = 1;
spotLight = new THREE.SpotLight(0xffffff, 2)
spotLight.castShadow = true;
spotLight.shadow.mapSize.width = 1024 * 4; 
spotLight.intensity = 1;
spotLight.shadow.mapSize.height = 1024 * 4; 
scene.add(spotLight);
// ---------- load model ----------
loadModel('./assets/toolhead.glb'); // change path/name if needed

const pmrem = new THREE.PMREMGenerator(renderer);
new RGBELoader().load('./assets/hdri/bg.hdr', (texture) => {
    const envMap = pmrem.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    // scene.background = envMap;  // visible background
    texture.dispose();
});


function loadModel(url) {
//   const draco = new DRACOLoader();
//   draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/libs/draco/');

  const loader = new GLTFLoader();
//   loader.setDRACOLoader(draco);

  loader.load(url, (gltf) => {
    model = gltf.scene.children[0];
    // Compute bounding box
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
   // Orientation fix for Z-up CAD exports: rotate -90° about X (flip sign if wrong)
    model.rotation.x = -Math.PI / 2;
    // Shift model so center is at the origin
    model.position.x += (model.position.x - center.x);
    model.position.y += (model.position.y - center.y);
    model.position.z += (model.position.z - center.z);
    
        // Put on floor
    box.setFromObject(model);
    const yMin = box.min.y;
    model.position.y -= (yMin - (yMin/12)); //

// Floor geometry (big plane)
const floorSize = 1000; // Large enough to look infinite
const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);

// Floor material
// const floorMat = new THREE.MeshStandardMaterial({
//   color: 0xdddddd,   // light gray
//   roughness: 1,
//   metalness: 0,opacity: 1 
// });
const floorMat = new THREE.ShadowMaterial({ opacity: 0.3 });
// Create the mesh
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2; // Make it horizontal
floor.position.y = 0; // Align with Y=0 floor line

// Optional: receive shadows if you have lighting + shadow enabled
floor.receiveShadow = true;

scene.add(floor);

    scene.add(model);

    // Optional: Recompute controls target to keep rotation around new center
    controls.target.set(0, 0, 0);
    controls.update();

    //   // Bounding box helper
    // const helper = new THREE.Box3Helper(new THREE.Box3().setFromObject(model), 0xffff00);
    // scene.add(helper);

    model.traverse(obj => {
    if (!obj.isMesh) return;
    
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (obj.material.map) obj.material.map.anisotropy = 16;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => {
        if (!m) return;
        if ('roughness' in m) m.roughness = 0.35;  // was likely ~0.6
        if ('metalness' in m) m.metalness = 0.1;   // printed parts aren’t metallic
        // If your GLB has vertex colors that are darkening things, disable them:
        // if ('vertexColors' in m && m.vertexColors) { m.vertexColors = false; m.needsUpdate = true; }
    });
    });

    frameModel();
    applyCurrentColors();
    dumpMeshNames();         // <— add this
    window.model = model;    // optional: expose for manual console poking
  }, undefined, (err) => {
    console.error('GLB load error:', err);
  });
}



// ---------- frame model centered & comfy distance ----------
function frameModel() {
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Math.max(sphere.radius, 0.001);

  controls.target.copy(center);

  const distance = radius * 2.2; // tweak 1.8–2.8 to taste
  camera.position.set(center.x, center.y, center.z + distance);

  camera.near = Math.max(0.01, radius / 100);
  camera.far = Math.max(1000, radius * 10);
  camera.updateProjectionMatrix();
  controls.update();
}

// ---------- color rules ----------
const primaryInput = document.getElementById('primaryColor');
const accentInput  = document.getElementById('accentColor');
const ledInput = document.getElementById('clearColor');
const hardwareInput = document.getElementById('hardwareColor');
const frameInput = document.getElementById('frameColor');

primaryInput.addEventListener('input', applyCurrentColors);
accentInput.addEventListener('input', applyCurrentColors);
ledInput.addEventListener('input', applyCurrentColors);
frameInput.addEventListener('input', applyCurrentColors);

function getSelectedHardwareColor() {
  const selected = document.querySelector('input[name="hardwareColor"]:checked');
  return selected ? selected.value : '#1c1c26';
}
// Example: apply to all hardware-tagged meshes
function applyHardwareColor() {
  const color = getSelectedHardwareColor();
  model.traverse(o => {
    if (!o.isMesh) return;
    if (classifyByComponent(o) === 'hardware') {
      o.material.color.set(color);
    }
  });
}

// Event listener
document.querySelectorAll('input[name="hardwareColor"]').forEach(radio => {
  radio.addEventListener('change', applyHardwareColor);
});


// --- Debug helpers: name/path + classification ---
function nodePath(obj) {
  const parts = [];
  for (let n = obj; n; n = n.parent) parts.push(n.name || '(unnamed)');
  return parts.reverse().join(' / ');
}

function dumpMeshNames() {
  if (!model) return console.warn('No model loaded yet.');
  const rows = [];
  model.traverse(o => {
    if (!o.isMesh) return;
      // Match by name
    


   const cls = classifyByComponent(o);
    if (!cls) return; // only keep "other"
    rows.push({ class: cls, name: o.name || '(unnamed)', path: nodePath(o) });
  });
  rows.sort((a,b)=> a.class.localeCompare(b.class) || a.name.localeCompare(b.name));
  console.table(rows);
}

function getPath(obj) {
let node = obj;
let path
while (node) {
    if (path)
    {
     path = '/' + node.name + path
    }
    else
    {
     path = '/' + node.name 
    }
    node = node.parent
}
return path;
}

function getComponentName(obj) {
  let node = obj;
  let path = nodePath(obj);
    const name = (path || '').trim();
      return name; 
}

function classifyByComponent(obj) {
  const compName = getComponentName(obj).toLowerCase();
  if ((!/body\d+$/i.test(compName) || /(hcs|sts|nut)/i.test(compName)|| /(fan)/i.test(compName) || /(36STH)/i.test(compName) ) && compName !== '' && !/(Nitehawk-36_V13)/i.test(compName)) {

    // Skip unnamed
 
  // Printed part prefixes
   if (/(?:a_|\/a_)/.test(compName)) return 'accent';
  else if (/(?:c_|\/c_)/.test(compName)) return 'led';
  else if (/(Extrusion)/i.test(compName)) return 'opaque';
  else if (/(36STH)/i.test(compName)) return 'motor';
  // Hardware detection
  else if (/(hcs|sts|nut)/i.test(compName))
    return 'hardware';
  // Fan detection
  else if ( compName.includes('fan'))
    return 'fan';
  // Primary detection
  else if ( (!compName.startsWith('a_') && !compName.startsWith('c_') && !compName.startsWith('o_')) &&   ( /_x\d+_?$/i.test(compName)  ||  !/body\d+$/i.test(compName) )  )
    return 'primary';
  else
    return 'other';
  }
  else
     return null;
}
function hasParentWithName(node, targetName) {
  let current = node?.parent;
  const n = (current.name || '').trim().toLowerCase();

  while (current) {
    if (n === targetName.toLowerCase()) {
      return true;
    }
    current = current.parent;
  }

  return false;
}
function applyCurrentColors() {
  if (!model) return;
  applyHardwareColor();
  const primaryColor = new THREE.Color(primaryInput.value);
  const accentColor  = new THREE.Color(accentInput.value);
  const ledColor = new THREE.Color(ledInput.value);
 
  let counts = { primary:0, accent:0, clear:0, frame:0 , hardware:0, fan:0, motor:0};

  model.traverse((obj) => {
    if (!obj.isMesh) return;

    const cls = classifyByComponent(obj);
    let chosen = null;
    switch(cls)
    {
        case "accent":
            chosen = accentColor;
            counts.accent++;
            break;
        case "primary":
            chosen = primaryColor;
            counts.primary++;
            break;
        case "led":
            chosen = ledColor;
            counts.clear++;
            break;
        case "extrusion":
            chosen = frameColor;
            counts.frame++;
            break;
        case "motor":
            chosen = new THREE.Color(0x222222); // deep black
            counts.motor = (counts.motor || 0) + 1;
    break;
        default:
            counts[cls] = (counts[cls]||0) + 1; return; 

    }
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((m) => {
    if (m && m.color) {
        if (cls === "motor") {
            m.color.copy(chosen);
            m.metalness = 1.0;     // full metal effect
            m.roughness = 0.4;    // slight surface roughness
        }
        else {
            m.color.copy(chosen);
        }
    }
});
  });

  console.log(`Recolored → primary:${counts.primary}, accent:${counts.accent}. Left unchanged → clear:${counts.clear}, opaque:${counts.opaque}`);
}

// ---------- render loop ----------
function animate() {

  renderer.render(scene, camera);
  spotLight.position.set(
    camera.position.x+1,
    camera.position.y+1,
    camera.position.z+1
  )
  requestAnimationFrame(animate);
  controls.update();
}
animate();

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
