import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONFIG } from './config.js';

export const isSmall = matchMedia('(max-width: 760px), (pointer: coarse)').matches;

/* ============================================================ setup */
const app = document.getElementById('app');
let renderer;
try{
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
}catch(e){ document.getElementById('err').style.display='grid'; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio||1, isSmall ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1113);
scene.fog = new THREE.Fog(0x0f1113, 26, 85);

const camera = new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 0.1, 200);
const camFrom = new THREE.Vector3(14.5, 9.2, 16.5), camTo = new THREE.Vector3(8.2, 3.6, 10.4);
camera.position.copy(camFrom);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06;
controls.target.set(1.2, -0.4, 0);
controls.minDistance = 4; controls.maxDistance = 40;
controls.maxPolarAngle = 1.52;
controls.autoRotateSpeed = 0.7;
controls.enabled = false;
controls.addEventListener('start', ()=>{ controls.autoRotate = false; app.classList.add('dragging'); });
controls.addEventListener('end',   ()=>{ app.classList.remove('dragging'); });

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

scene.add(new THREE.HemisphereLight(0xcdd3da, 0x23262b, 0.5));
const key = new THREE.DirectionalLight(0xfff0dd, 2.6);
key.position.set(7, 12, 8);
key.castShadow = true;
key.shadow.mapSize.set(CONFIG.shadow.high, CONFIG.shadow.high);
Object.assign(key.shadow.camera, { left:-9, right:9, top:9, bottom:-9, near:4, far:40 });
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.03;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4d4, 0.55);
rim.position.set(-10, 5, -8);
scene.add(rim);


/* ---- pós-processamento: bloom em HDR (valores > 1.0 brilham) ---- */
const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type:THREE.HalfFloatType, samples:4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), CONFIG.bloom.strength, CONFIG.bloom.radius, CONFIG.bloom.threshold));
composer.addPass(new OutputPass());          // tone mapping ACES + sRGB
composer.setSize(innerWidth, innerHeight);  // o composer aplica o DPR uma única vez (rt nasce em px CSS)
export const fx = { bloom:true };
export function render(){ fx.bloom ? composer.render() : renderer.render(scene, camera); }
export function resizeGL(){ renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); }

/* ---- sombras: 'high' | 'low' | 'off' ---- */
export function setShadowQuality(q){
  const on = q !== 'off', size = q === 'low' ? CONFIG.shadow.low : CONFIG.shadow.high, was = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = on; key.castShadow = on;
  key.shadow.mapSize.set(size, size);
  if (key.shadow.map){ key.shadow.map.dispose(); key.shadow.map = null; }
  if (was !== on) scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
}
export { app, renderer, scene, camera, controls, camFrom, camTo };
