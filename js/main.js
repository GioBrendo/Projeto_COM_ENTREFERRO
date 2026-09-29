import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { sim, params, view, step, turnsRatio } from './physics.js';
import { renderer, scene, camera, controls, camFrom, camTo, fx, isSmall, render, resizeGL, setShadowQuality } from './scene.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { initFeatures, record, updateAudio, updateCamera, INFERNO_GLSL } from './features.js';
import { matSteel, matCore, matCast, matCopper, matCoil, matBrass, matRubber, matPhen, matFloor, stripeBase, texN, texS, plateTexture } from './materials.js';
const rbox = (w, h, d, r, s = 3) => new RoundedBoxGeometry(w, h, d, s, r);
// RoundedBoxGeometry é não indexada; mergeGeometries exige todas indexadas ou todas não → uniformiza antes de fundir
const mergeMixed = gs => { const g = mergeGeometries(gs.map(x => x.index ? x.toNonIndexed() : x)); if (!g) throw new Error('mergeGeometries falhou (atributos incompatíveis)'); return g; };   // arestas com bisel: captam highlights

const { R, T } = CONFIG.disc;
const C_AMBER = new THREE.Color(0xffb454), C_CYAN = new THREE.Color(0x63c7d6);

/* ============================================================ geometry helpers */
function rrPoint(u, hx, hy, r){                       // point on rounded-rect perimeter, u∈[0,1)
  const ex = hx - r, ey = hy - r;
  const P = 4*ex + 4*ey + 2*Math.PI*r;
  let s = (((u % 1) + 1) % 1) * P;
  if (s < 2*ey)                 return { x: hx, y: -ey + s };           s -= 2*ey;
  if (s < Math.PI*r/2){ const a = s/r;               return { x: ex + r*Math.cos(a),      y: ey + r*Math.sin(a) }; } s -= Math.PI*r/2;
  if (s < 2*ex)                 return { x: ex - s, y: hy };           s -= 2*ex;
  if (s < Math.PI*r/2){ const a = Math.PI/2 + s/r;   return { x: -ex + r*Math.cos(a),     y: ey + r*Math.sin(a) }; } s -= Math.PI*r/2;
  if (s < 2*ey)                 return { x: -hx, y: ey - s };           s -= 2*ey;
  if (s < Math.PI*r/2){ const a = Math.PI + s/r;     return { x: -ex + r*Math.cos(a),     y: -ey + r*Math.sin(a) }; } s -= Math.PI*r/2;
  if (s < 2*ex)                 return { x: -ex + s, y: -hy };           s -= 2*ex;
  const a = 1.5*Math.PI + s/r;
  return { x: ex + r*Math.cos(a), y: -ey + r*Math.sin(a) };
}
class RectHelix extends THREE.Curve{
  constructor(hx,hy,cr,cy,z0,z1,turns){ super(); this.hx=hx; this.hy=hy; this.cr=cr; this.cy=cy; this.z0=z0; this.z1=z1; this.turns=turns; }
  getPoint(t, tgt = new THREE.Vector3()){
    const p = rrPoint(this.turns*t, this.hx, this.hy, this.cr);
    return tgt.set(p.x, p.y + this.cy, this.z0 + (this.z1 - this.z0)*t);
  }
}

const pickables = [];
const PARTS = {
  disc:  ['DISCO CONDUTOR','Cu · Ø640 × 50 mm · correntes de Foucault → calor'],
  hub:   ['CUBO E FURAÇÃO','6 × M12 em Ø116 · chavetado ao eixo'],
  shaft: ['EIXO DE ACIONAMENTO','Ø68 aço · 2 mancais de rolamento'],
  coilA: ['BOBINA A (FRONTAL)','240 espiras Cu · 12 A ef. CA · ∥ ao disco'],
  coilB: ['BOBINA B (TRASEIRA)','240 espiras Cu · em série (aditiva) · ∥ ao disco'],
  coreA: ['NÚCLEO EM C LAMINADO','aço-Si · par de polos · entreferros de 3 mm'],
  ped:   ['MANCAL DE APOIO','rolamento · graxa vedada'],
  base:  ['BASE DE FIXAÇÃO','estrutura de aço soldada'],
  feed:  ['CAIXA DE ALIMENTAÇÃO CA','2 fios blindados · alimentação das bobinas'],
};
function tag(mesh, part){ mesh.userData.part = part; pickables.push(mesh); return mesh; }

/* ============================================================ static scene */
{ // floor + polar grid
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), matFloor);
  floor.rotation.x = -Math.PI/2; floor.position.y = -5.3; floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.PolarGridHelper(26, 12, 6, 64, 0x2c3138, 0x22262b);
  grid.position.y = -5.28;
  grid.material.transparent = true; grid.material.opacity = 0.55;
  scene.add(grid);
}
{ // base plate
  const m = matCast.clone();
  const base = tag(new THREE.Mesh(rbox(11, 0.45, 9.6, 0.05), m), 'base');
  base.position.y = -5.27; base.castShadow = base.receiveShadow = true;
  scene.add(base);
  const bg = new THREE.CylinderGeometry(0.13, 0.13, 0.12, 12);
  [[4.9,-3.9],[-4.9,-3.9],[4.9,3.9],[-4.9,3.9]].forEach(p=>{
    const b = new THREE.Mesh(bg, matSteel.clone());
    b.rotation.x = Math.PI/2; b.position.set(p[0], -5.02, p[1]);
    scene.add(tag(b,'base'));
  });
}
{ // pedestals + bearings
  for (const zc of [3.6, -3.6]){
    const m = matCast.clone();
    const body = tag(new THREE.Mesh(rbox(1.9, 4.6, 1.6, 0.06), m), 'ped');
    body.position.set(0, -2.75, zc); body.castShadow = body.receiveShadow = true;
    scene.add(body);
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.2, 32), m);
    boss.rotation.x = Math.PI/2; boss.position.set(0, 0, zc); boss.castShadow = true;
    scene.add(tag(boss,'ped'));
    for (const xs of [0.72, -0.72]){
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.42, 10), matSteel.clone());
      bolt.position.set(xs, -0.2, zc);
      scene.add(tag(bolt,'ped'));
    }
  }
}

/* ============================================================ rotating groups */
{ // coluna de apoio do núcleo em C
  const col = tag(new THREE.Mesh(rbox(0.7, 4.6, 1.2, 0.05), matCast.clone()), 'base');
  col.position.set(4.15, -2.8, 0); col.castShadow = col.receiveShadow = true; scene.add(col);
}
const shaftGroup = new THREE.Group(); scene.add(shaftGroup);
{
  const shaft = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 9, 28), matSteel.clone()), 'shaft');
  shaft.rotation.x = Math.PI/2; shaft.castShadow = true;
  shaftGroup.add(shaft);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 7.4),
    new THREE.MeshStandardMaterial({ color:0x24262a, roughness:0.6, metalness:0.4 }));
  stripe.position.y = 0.355; shaftGroup.add(stripe);
  for (const zc of [4.0, -4.0]){
    const hubc = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 28), matSteel.clone()), 'shaft');
    hubc.rotation.x = Math.PI/2; hubc.position.z = zc; hubc.castShadow = true;
    shaftGroup.add(hubc);
    for (let i=0;i<6;i++){
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), matSteel.clone());
      b.rotation.x = Math.PI/2;
      b.position.set(Math.cos(i*Math.PI/3)*0.36, Math.sin(i*Math.PI/3)*0.36, zc);
      shaftGroup.add(tag(b,'shaft'));
    }
  }
}

const discGroup = new THREE.Group(); scene.add(discGroup);
const discMat = matCopper;
{
  const disc = tag(new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 96), discMat), 'disc');
  disc.rotation.x = Math.PI/2; disc.castShadow = disc.receiveShadow = true;
  discGroup.add(disc);
  const hub = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.95, 48), matCast.clone()), 'hub');
  hub.rotation.x = Math.PI/2; hub.castShadow = true;
  discGroup.add(hub);
  for (let i=0;i<6;i++){
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.06, 10), matSteel.clone());
    b.rotation.x = Math.PI/2;
    b.position.set(Math.cos(i*Math.PI/3)*0.58, Math.sin(i*Math.PI/3)*0.58, 0);
    discGroup.add(tag(b,'hub'));
  }
}

/* ---- mapa de calor: 100% em fragment shader (sem canvas, sem upload CPU→GPU) ---- */
const uHM = { value:0 }, uBase = { value:0 }, heatMats = [];
const uHeat = { phi:{ value:0 }, om:{ value:0 }, eN:{ value:0 }, temp:{ value:28 }, trk:{ value:0 } };
const JET = INFERNO_GLSL;   // paleta inferno (perceptualmente uniforme) no lugar do jet
// Rastro analítico: o polo fixo no mundo varre o disco a -phi; o ponto a "lag" rad atrás foi aquecido há lag/ω s
// e decai com exp(-idade/τ). A soma de todas as voltas é uma série geométrica (forma fechada).
const HEAT_GLSL = `
float heatI(vec2 p){
  vec2 q = vec2(p.x, p.y*uFlip);
  float rho = length(q), sg = uOm < 0. ? -1. : 1., lag = mod(sg*(atan(q.y, q.x) + uPhi), 6.2831853);
  float sl = lag > 3.1415927 ? lag - 6.2831853 : lag;
  float rp = ${CONFIG.poleX.toFixed(3)}, sig = 0.45*(0.37 + 0.57*uEN);
  float dr = (rho - rp)/sig, rad = exp(-dr*dr);
  float a = min(0.35, uEN*0.2), en = smoothstep(0.02, 0.05, uEN);
  float om = max(abs(uOm), 0.3), wt = om*${CONFIG.heat.tau.toFixed(2)};
  float dep = (a/0.033)*1.7725*sig/(rp*om);
  float trail = dep*exp(-lag/wt)/(1. - exp(-6.2831853/wt));
  float ha = rp*sl/sig, hd = 3.*a*exp(-ha*ha);
  float v = 1. - exp(-(trail + hd)*rad*en);
  float g = clamp((uTemp - 140.)/260., 0., 1.), dg = (rho - 2.8)/0.3;
  return clamp(v + 0.7*g*exp(-dg*dg), 0., 1.);
}`;
const HEAT_FRAG = `#include <map_fragment>
float hv = heatI(vHp);
if (uHM > .5){ float h = clamp((uTemp - ${CONFIG.phys.ambient.toFixed(1)} + uTrk*sqrt(hv))/${(CONFIG.heat.tMax-CONFIG.phys.ambient).toFixed(1)}, 0., 1.);
  diffuseColor = vec4(pow(pal(h), vec3(2.2))*(1. + .8*hv), smoothstep(.015, .1, h)); }
else diffuseColor = vec4(mix(vec3(.47,.08,0.), vec3(1.,.85,.6), hv)*hv, 1.);`;
function mkHeatMat(flip){
  const m = new THREE.MeshBasicMaterial({ transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });
  m.onBeforeCompile = sh =>{
    Object.assign(sh.uniforms, { uHM, uBase, uPhi:uHeat.phi, uOm:uHeat.om, uEN:uHeat.eN, uTemp:uHeat.temp, uTrk:uHeat.trk, uFlip:{ value:flip } });
    sh.vertexShader = 'varying vec2 vHp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHp = position.xy;');
    sh.fragmentShader = 'varying vec2 vHp;\nuniform float uHM,uBase,uPhi,uOm,uEN,uTemp,uTrk,uFlip;\n' + JET + HEAT_GLSL +
      sh.fragmentShader.replace('#include <map_fragment>', HEAT_FRAG);
  };
  heatMats.push(m); return m;
}
for (const [flip, z, rx] of [[1, T/2 + CONFIG.heat.lift, 0], [-1, -T/2 - CONFIG.heat.lift, Math.PI]]){
  const ov = new THREE.Mesh(new THREE.CircleGeometry(R-0.01, 96), mkHeatMat(flip));
  ov.position.z = z; ov.rotation.x = rx; ov.renderOrder = 1;
  discGroup.add(ov);
}

/* ============================================================ coil units */
const XP = CONFIG.poleX;                                // raio do eixo dos polos (mundo, +x)
const coneGeo = new THREE.ConeGeometry(0.06, 0.17, 10);
const ringGeo = (rad, tube, y, rs = 8, ts = 56)=>{
  const t = new THREE.TorusGeometry(rad, tube, rs, ts);
  t.rotateX(-Math.PI/2); t.translate(0, y, 0);   // anel paralelo ao disco; +u = anti-horário visto de frente
  return t;
};
function lamBox(sx, sy, sz, cx, cy){             // bloco laminado: 10 lâminas ao longo de z
  const gs = [];
  for (let i=0;i<10;i++){ const b = rbox(sx, sy, sz*0.086, 0.012, 2); b.translate(cx, cy, -sz/2 + sz*0.1*(i+0.5)); gs.push(b); }
  return gs;
}
function buildUnit(){
  const u = { sign:1, group:new THREE.Group(), swirls:[], mix:1 };
  const g = u.group;

  /* núcleo em C laminado: braços à frente/atrás do disco + coluna externa; pernas com sapatas polares */
  const cg = [...lamBox(2.65,0.4,1.0, 0.825, 1.75), ...lamBox(2.65,0.4,1.0, 0.825,-1.75), ...lamBox(0.4,3.9,1.0, 1.95, 0)];
  for (const s of [1,-1]){
    const p = new THREE.CylinderGeometry(0.42,0.42,0.84,32); p.translate(0, s*1.13, 0); cg.push(p);
    const h = new THREE.CylinderGeometry(0.62,0.62,0.16,40); h.translate(0, s*0.63, 0); cg.push(h);
  }
  const core = tag(new THREE.Mesh(mergeMixed(cg), matCore.clone()), 'coreA');
  core.castShadow = core.receiveShadow = true; g.add(core);

  /* bobinas A (à frente) e B (atrás): 3 camadas × 6 espiras, planos paralelos ao disco */
  u.coilMat = matCoil.clone();
  // cada anel representa N/M espiras; grade radial (L) × axial (K) dentro da janela de enrolamento; 240 esp. → 3×6 (projeto)
  const mk = (s, ex, n = 240)=>{ const M = Math.max(4, Math.round(18*n/240)), L = Math.max(1, Math.round(Math.sqrt(M*0.4))), K = Math.max(2, Math.round(M/L));
    const pr = L > 1 ? 0.17/(L-1) : 0, pz = 0.575/(K-1), rw = Math.min(0.038, 0.45*Math.min(pr || 1, pz)), gs = [];
    for (let r=0;r<L;r++) for (let k=0;k<K;k++) gs.push(ringGeo(0.52 + (L > 1 ? pr*r : 0.085), rw + ex, s*(0.83 + pz*k), 8, 48));
    return mergeGeometries(gs); };
  const coilA = tag(new THREE.Mesh(mk( 1,0), u.coilMat), 'coilA');
  const coilB = tag(new THREE.Mesh(mk(-1,0), u.coilMat), 'coilB');
  coilA.castShadow = coilB.castShadow = true; g.add(coilA, coilB);
  const fl = [];
  for (const s of [1,-1]) for (const y of [0.775,1.475]){ const f = new THREE.CylinderGeometry(0.8,0.8,0.05,40); f.translate(0, s*y, 0); fl.push(f); }
  g.add(new THREE.Mesh(mergeGeometries(fl), matPhen));

  /* campo E nas bobinas: ao longo do fio, no sentido da corrente */
  u.coilOvTex = stripeBase.clone(); u.coilOvTex.repeat.set(3,1);
  u.coilOvMat = new THREE.MeshBasicMaterial({ color:0xc79bff, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, alphaMap:u.coilOvTex });
  u.coilOvMesh = new THREE.Mesh(mergeGeometries([mk(1,0.009), mk(-1,0.009)]), u.coilOvMat);
  u.coilOvMesh.renderOrder = 2; g.add(u.coilOvMesh);
  u.setTurns = n =>{ for (const [mesh, s] of [[coilA, 1], [coilB, -1]]){ mesh.geometry.dispose(); mesh.geometry = mk(s, 0, n); }
    u.coilOvMesh.geometry.dispose(); u.coilOvMesh.geometry = mergeGeometries([mk(1, 0.009, n), mk(-1, 0.009, n)]); };

  /* campo E induzido no disco: anéis em torno do eixo de B (faces e plano médio), E = −∂A/∂t */
  const eg = [];
  for (const y of [0.27, 0, -0.27]) for (const rr of [0.28, 0.5, 0.72]) eg.push(ringGeo(rr, 0.022, y, 6, 72));
  u.eTex = stripeBase.clone(); u.eTex.repeat.set(3,1);
  u.eMat = new THREE.MeshBasicMaterial({ color:0xc79bff, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, alphaMap:u.eTex });
  u.eMesh = new THREE.Mesh(mergeGeometries(eg), u.eMat); u.eMesh.renderOrder = 4; u.eMesh.position.y = CONFIG.overlayOffset; g.add(u.eMesh);

  /* correntes parasitas por movimento (dois lóbulos contrarrotativos por face do disco) */
  u.swirlMat = new THREE.MeshBasicMaterial({ color:0xffb454, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false });
  const ARC = Math.PI*1.8;
  const tanV = new THREE.Vector3(-Math.sin(ARC), Math.cos(ARC), 0).normalize();
  const YUP = new THREE.Vector3(0,1,0);
  for (const face of [1,-1]) for (const dir of [1,-1]){
    const w = new THREE.Group(); w.rotation.x = -Math.PI/2; w.position.set(0, face*0.3, dir*0.36);
    const arc = new THREE.Group();
    const tor = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.030, 8, 64, ARC), u.swirlMat);
    const cone = new THREE.Mesh(coneGeo, u.swirlMat);
    cone.position.set(0.30*Math.cos(ARC), 0.30*Math.sin(ARC), 0);
    cone.quaternion.setFromUnitVectors(YUP, tanV);
    arc.add(tor, cone); arc.userData.dir = dir*face; arc.renderOrder = 3;
    w.add(arc); g.add(w); u.swirls.push(arc);
  }

  /* campo B: 9 circuitos fechados (atravessam bobinas, entreferros e disco; vazam além do núcleo) */
  const fg = [];
  for (const zk of [-0.3, 0, 0.3]) for (const xo of [-0.26, 0, 0.26]){
    const pts = [[xo,1.2],[xo,0.55],[xo*1.5,0],[xo,-0.55],[xo,-1.2],[0.5*xo+0.2,-1.62],[0.9,-1.75],[1.75,-1.75],
      [1.97,-1.4],[1.97,0],[1.97,1.4],[1.75,1.75],[0.9,1.75],[0.5*xo+0.2,1.62]].map(a=>new THREE.Vector3(a[0], a[1], zk));
    fg.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.65), 220, 0.024, 5, true));
  }
  u.fieldTex = stripeBase.clone(); u.fieldTex.repeat.set(3,1);
  u.fieldMat = new THREE.MeshBasicMaterial({ color:0xffb454, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false, alphaMap:u.fieldTex });
  u.fieldMesh = new THREE.Mesh(mergeGeometries(fg), u.fieldMat);
  u.fieldMesh.renderOrder = 4.5; u.fieldMesh.position.y = -CONFIG.overlayOffset; g.add(u.fieldMesh);

  /* selos N / S nas faces polares (F = traseira, B = frontal) */
  const mkSprite = ()=>{ const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:texN, transparent:true, opacity:0 }));
    s.scale.setScalar(0.52); s.userData = { pop:0, L:'N' }; s.renderOrder = 5; return s; };
  u.sprF = mkSprite(); u.sprF.position.set(-0.95, -0.63, 0); g.add(u.sprF);
  u.sprB = mkSprite(); u.sprB.position.set(-0.95,  0.63, 0); g.add(u.sprB);
  return u;
}
const unitA = buildUnit();
unitA.group.position.set(XP, 0, 0); unitA.group.rotation.x = Math.PI/2; scene.add(unitA.group);
const units = [unitA];
const uB = { value:0 };
const bMat = new THREE.ShaderMaterial({ uniforms:{ uB }, transparent:true, depthWrite:false, side:THREE.DoubleSide,
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: JET + 'uniform float uB; varying vec2 vUv; void main(){ float r=length((vUv-.5)*2.6); float v=uB/(1.+pow(r/.68,6.)); gl_FragColor=vec4(pal(v),smoothstep(.02,.1,v)*.8); }' });
const bMaps = [0.34,-0.34].map(z=>{ const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6,2.6), bMat);
  m.position.set(XP,0,z); m.renderOrder = 3; scene.add(m); return m; });

/* ---- AC feed cables + junction boxes ---- */
const V3 = (x,y,z)=>new THREE.Vector3(x,y,z);
function addCable(points){
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 90, 0.075, 8), matRubber);
  m.castShadow = true; scene.add(m);
}

CONFIG.cables.forEach(c => addCable(c.map(p => V3(...p))));
const feedLeds = [];
function addFeedBox(x, label){
  const m = matCast.clone();
  const box = tag(new THREE.Mesh(rbox(0.95, 0.55, 1.05, 0.05), m), 'feed');
  box.position.set(x, -4.77, 3.3); box.castShadow = box.receiveShadow = true;
  scene.add(box);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.30),
    new THREE.MeshBasicMaterial({ map:plateTexture(label) }));
  plate.position.set(x, -4.77, 3.835); scene.add(plate);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10),
    new THREE.MeshStandardMaterial({ color:0x30241a, emissive:0xffb454, emissiveIntensity:0.15 }));
  led.position.set(x, -4.43, 3.72); scene.add(led);
  feedLeds.push(led.material);
}

CONFIG.feedBoxX.forEach((x,i) => addFeedBox(x, 'ALIM. ' + 'AB'[i]));

/* ============================================================ annotations */
const ANNS = [
  [-2.3,  1.3,  0.28, -1, 'DISCO CONDUTOR',      'Cu · Ø640 × 50 mm'],
  [ 2.2,  0.75, 1.1,  -1, 'BOBINA A (FRONTAL)',  '240 esp. · Cu · CA · ∥ ao disco'],
  [ 2.2, -0.75,-1.1,   1, 'BOBINA B (TRASEIRA)', 'em série · aditiva'],
  [ 4.15, 0.5,  0.9,   1, 'NÚCLEO EM C',         'aço-Si laminado'],
  [ 2.2, -0.72, 0.27, -1, 'CAMPO E NO DISCO',    'circula em torno de B · Faraday'],
  [ 2.6,  0.0,  0.0,  -1, 'CAMPO B ⟂ AO DISCO',  'atravessa bobinas, entreferros e disco'],
  [ 0.15, 0.35, 4.25,  1, 'EIXO DE ACIONAMENTO', 'Ø68 · mancais de apoio'],
  [ 2.6, -4.40, 3.30,  1, 'ALIMENTAÇÃO CA',      '2 fios blindados'],
];
const annEls = [];
const annsLayer = document.getElementById('anns');
const leaders = document.getElementById('leaders');
const SVGNS = 'http://www.w3.org/2000/svg';
for (const [x,y,z,side,name,sub] of ANNS){
  const el = document.createElement('div'); el.className = 'ann';
  el.innerHTML = `<div class="n">${name}</div><div class="s">${sub}</div>`;
  annsLayer.appendChild(el);
  const line = document.createElementNS(SVGNS,'line');
  line.setAttribute('stroke','#8e939a'); line.setAttribute('stroke-opacity','0.5'); line.setAttribute('stroke-width','1');
  const dot = document.createElementNS(SVGNS,'circle');
  dot.setAttribute('r','2.4'); dot.setAttribute('fill','#e8a15c');
  leaders.appendChild(line); leaders.appendChild(dot);
  annEls.push({ p:new THREE.Vector3(x,y,z), side, el, line, dot });
}
function sizeSvg(){
  leaders.setAttribute('width', innerWidth); leaders.setAttribute('height', innerHeight);
  leaders.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
}
sizeSvg();

/* ============================================================ UI wiring */
const $ = id => document.getElementById(id);
const inRpm=$('inRpm'), inExc=$('inExc'), inFrq=$('inFrq');
const oRpm=$('oRpm'), oExc=$('oExc'), oFrq=$('oFrq');
function paintRange(el, txt){
  el.setAttribute('aria-valuemin', el.min); el.setAttribute('aria-valuemax', el.max);
  el.setAttribute('aria-valuenow', el.value); if (txt) el.setAttribute('aria-valuetext', txt);
  const p = (el.value-el.min)/(el.max-el.min)*100;
  el.style.background = `linear-gradient(90deg, var(--amber) ${p}%, #2a2f35 ${p}%)`;
}
function bindRange(el, out, fmt, setv){
  const upd = ()=>{ const tx = fmt(+el.value); out.textContent = tx; paintRange(el, tx); };
  el.addEventListener('input', ()=>{ setv(+el.value); upd(); });
  upd();
}
bindRange(inRpm, oRpm, v=>`${v} rpm`,        v=>params.rpm = v);
bindRange(inExc, oExc, v=>`${(v*12).toFixed(1)} A ef.`, v=>params.exc = v);
const inTrn = $('inTrn'), oTrn = $('oTrn');
bindRange(inTrn, oTrn, v=>`${v} esp.`, v=>params.turns = v);
bindRange(inFrq, oFrq, v=>`${v.toFixed(1)} Hz`,    v=>params.freq = v);

const btnBrake = $('btnBrake');
const brakeOn  = on =>{ params.hold = on; btnBrake.classList.toggle('on', on); btnBrake.setAttribute('aria-pressed', on); };
let holdKey = false, holdPtr = false;
const syncBrake = ()=> brakeOn(holdKey || holdPtr);
const releaseBrake = ()=>{ holdKey = holdPtr = false; syncBrake(); };
btnBrake.addEventListener('pointerdown', e=>{ e.preventDefault(); holdPtr = true; syncBrake(); });
addEventListener('pointerup',     ()=>{ holdPtr = false; syncBrake(); });
addEventListener('pointercancel', ()=>{ holdPtr = false; syncBrake(); });
btnBrake.addEventListener('pointerleave', ()=>{ holdPtr = false; syncBrake(); });
addEventListener('blur', releaseBrake);
document.addEventListener('visibilitychange', ()=>{ if (document.hidden) releaseBrake(); });
// Espaço não deve roubar o atalho de controles focados (checkbox, slider, botão), exceto o próprio botão do freio
const spaceIgnored = t => t !== btnBrake && t.closest && t.closest('input,select,textarea,button,[contenteditable]');
addEventListener('keydown', e=>{ if (e.code==='Space' && !spaceIgnored(e.target)){ e.preventDefault(); if(!e.repeat){ holdKey = true; syncBrake(); } } });
addEventListener('keyup',   e=>{ if (e.code==='Space' && holdKey){ holdKey = false; syncBrake(); } });

 $('tField').onchange  = e => view.field  = e.target.checked;
 $('tSwirl').onchange  = e => view.swirl  = e.target.checked;
 $('tEfld').onchange   = e => view.efield = e.target.checked;
 $('tLabels').onchange = e =>{ view.labels = e.target.checked;
  annsLayer.style.display = leaders.style.display = e.target.checked ? '' : 'none'; };

$('tMotor').onchange = e => params.motor = e.target.checked;
$('tHeat').onchange = e =>{ const on = e.target.checked; uHM.value = on ? 1 : 0;
  for (const m of heatMats){ m.blending = on ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true; }
  $('lgH').style.display = on ? '' : 'none'; };
$('tBmap').onchange = e =>{ bMaps.forEach(m => m.visible = e.target.checked); $('lgB').style.display = e.target.checked ? '' : 'none'; };
$('tHeat').onchange({ target:$('tHeat') }); $('tBmap').onchange({ target:$('tBmap') });
const SHQ = ['high','low','off'], SHL = { high:'ALTA', low:'BAIXA', off:'DESLIGADAS' };
let shQ = isSmall ? 'low' : 'high';
const applyShadow = q =>{ shQ = q; setShadowQuality(q); $('btnShadow').textContent = 'SOMBRAS: ' + SHL[q]; };
$('btnShadow').onclick = ()=>applyShadow(SHQ[(SHQ.indexOf(shQ)+1)%3]);
applyShadow(shQ);
$('tBloom').onchange = e => fx.bloom = e.target.checked;
$('tBloom').checked = fx.bloom = !isSmall;
const pBody = $('pBody'), btnCol = $('btnCol');
const mqSmall = matchMedia('(max-width:760px)');
const setCol = hid =>{ pBody.classList.toggle('hidden', hid); btnCol.textContent = hid ? '+' : '–';
  btnCol.setAttribute('aria-expanded', String(!hid)); };
btnCol.onclick = e =>{ e.stopPropagation(); setCol(!pBody.classList.contains('hidden')); };
$('pHead').onclick = ()=>{ if (mqSmall.matches) setCol(!pBody.classList.contains('hidden')); };  // bottom-sheet: toque no cabeçalho
setCol(mqSmall.matches);

const tbar = $('tbar'), segs = [];
for (let i=0;i<16;i++){ const d = document.createElement('div'); d.className='seg'; tbar.appendChild(d); segs.push(d); }

const rRpm=$('rRpm'), rTq=$('rTq'), rPw=$('rPw'), rI=$('rI'), rTmp=$('rTmp'), rTrk=$('rTrk'), rB=$('rB');
const stDot=$('stDot'), stTxt=$('stTxt');

/* scope */
const scope = $('scope'), sctx = scope.getContext('2d');
let SW=0, SH=0;
function sizeScope(){
  const r = scope.getBoundingClientRect();
  SW = Math.max(10, r.width); SH = Math.max(10, r.height);
  const d = Math.min(2, devicePixelRatio||1);
  scope.width = SW*d; scope.height = SH*d;
  sctx.setTransform(d,0,0,d,0,0);
}
sizeScope();
const scopeBuf = []; let tbScale = 20;

/* ============================================================ hover / tooltip */
const tip = $('tip'), tipN = tip.querySelector('.t-n'), tipS = tip.querySelector('.t-s');
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
let hoverPart = null, tipXY = [0,0];
function setHL(part){
  if (hoverPart === part) return;
  for (const m of pickables){
    if (m.userData.part === hoverPart && m.userData.e0 !== undefined && m.material.emissive)
      m.material.emissive.setHex(m.userData.e0);
  }
  hoverPart = part;
  if (part && part !== 'disc' && !part.startsWith('coil')){
    for (const m of pickables) if (m.userData.part === part && m.material.emissive){
      if (m.userData.e0 === undefined) m.userData.e0 = m.material.emissive.getHex();
      m.material.emissive.setHex(0x4a2a10);
    }
  }
}
renderer.domElement.addEventListener('pointermove', e=>{
  tipXY = [e.clientX, e.clientY];
  mouse.x = (e.clientX/innerWidth)*2-1; mouse.y = -(e.clientY/innerHeight)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  if (hit){
    const [n, s] = PARTS[hit.object.userData.part] || ['—',''];
    setHL(hit.object.userData.part);
    tipN.textContent = n; tipS.textContent = s;
    tip.style.display = 'block';
    tip.style.left = Math.min(innerWidth-250, e.clientX+16)+'px';
    tip.style.top  = Math.min(innerHeight-70,  e.clientY+12)+'px';
  } else { setHL(null); tip.style.display = 'none'; }
});
renderer.domElement.addEventListener('pointerleave', ()=>{ setHL(null); tip.style.display='none'; });

/* ============================================================ per-frame visuals */
function poleUpdate(spr, isN, aI, dt){
  const L = isN ? 'N' : 'S';
  if (spr.userData.L !== L){
    spr.userData.L = L; spr.material.map = isN ? texN : texS;
    spr.material.needsUpdate = true; spr.userData.pop = 1;
  }
  spr.userData.pop = Math.max(0, spr.userData.pop - dt*5);
  spr.scale.setScalar(0.52*(1 + 0.45*spr.userData.pop));
  spr.material.opacity = Math.min(1, aI*2.4)*0.95;
  spr.visible = spr.material.opacity > 0.03;
}
let turnsBuilt = 240;
function updateDynamics(dt){
  const nR = turnsRatio()*sim.sat;   // N·I efetivo após saturação
  if (turnsBuilt !== params.turns){                       // reconstrói o enrolamento quando o nº de espiras muda
    turnsBuilt = params.turns; for (const u of units) u.setTurns(turnsBuilt);
    PARTS.coilA[1] = `${turnsBuilt} espiras Cu · 12 A ef. CA · ∥ ao disco`; PARTS.coilB[1] = `${turnsBuilt} espiras Cu · em série (aditiva) · ∥ ao disco`;
  }
  const aI  = Math.min(1, Math.abs(sim.I)/17), aB = Math.min(1, Math.abs(sim.I)*nR/17);   // aI: corrente; aB: campo (∝ N·I)
  const sgn = sim.I >= 0 ? 1 : -1;
  const eN  = Math.min(1, Math.abs(sim.omega)*sim.uEff*sim.uEff*nR*nR/70);
  sim.eN = eN;
  const dI = (sim.uEff > 0 && params.mode === 'ac') ? Math.cos(sim.theta) : 0;
  for (const u of units){
    const fT = (sim.I*u.sign > 0) ? 1 : 0;
    u.mix += (fT - u.mix)*Math.min(1, dt*14);
    u.fieldMat.color.copy(C_CYAN).lerp(C_AMBER, u.mix).multiplyScalar(fx.bloom ? CONFIG.bloom.fieldGain : 1);
    u.fieldMat.opacity = (view.field ? 1 : 0)*aB*0.9;
    u.fieldMesh.visible = view.field && u.fieldMat.opacity > 0.02;
    u.fieldTex.offset.x += u.sign*sgn*(0.25 + 0.85*aB)*dt;
    u.coilOvMat.opacity = (view.efield ? 1 : 0)*0.9*aI;
    u.eMat.opacity = (view.efield ? 1 : 0)*Math.min(1, Math.abs(dI)*sim.uEff*nR)*0.9;
    u.eMesh.visible = u.eMat.opacity > 0.02;
    u.eTex.offset.x += Math.sign(dI)*(0.3 + 0.5*Math.abs(dI))*dt;
    u.coilOvMesh.visible = u.coilOvMat.opacity > 0.02;
    u.coilOvTex.offset.x -= sgn*(0.4 + 1.4*aI)*dt;
    const hb = (hoverPart === 'coilA' || hoverPart === 'coilB') ? 0.16 : 0;
    u.coilMat.emissive.setRGB(1.0, 0.55, 0.28).multiplyScalar(0.05 + 0.28*aI + hb);
    u.swirlMat.opacity = (view.swirl ? 1 : 0)*eN*0.9;
    const spin = sgn*u.sign*(sim.omega < 0 ? -1 : 1)*(2.2 + 10*eN);   // Lenz: J ∝ v×B
    for (const a of u.swirls) a.rotation.z += spin*a.userData.dir*dt;
    for (const a of u.swirls) a.visible = view.swirl && eN > 0.02;
    poleUpdate(u.sprF, sim.I*u.sign >= 0, aB, dt);
    poleUpdate(u.sprB, sim.I*u.sign <  0, aB, dt);
  }
  for (const m of feedLeds) m.emissiveIntensity = 0.15 + 2.6*Math.min(1, sim.uEff);
  uB.value = Math.min(1, 0.01078*Math.abs(sim.I)*turnsRatio()*sim.sat/0.8);
  uBase.value = 0.4*Math.max(0, Math.min(1, (sim.temp-28)/272));
  uHeat.phi.value = sim.phi % (2*Math.PI); uHeat.om.value = sim.omega; uHeat.eN.value = sim.eN; uHeat.temp.value = sim.temp; uHeat.trk.value = Math.max(0, sim.tTrack - sim.temp);
  const heat = Math.max(0, Math.min(1, (sim.temp-60)/280))*(fx.bloom ? CONFIG.bloom.discGain : 1);
  const hbD = hoverPart === 'disc' ? 0.22 : 0;
  discMat.emissive.setRGB(0.55*heat + hbD, 0.16*heat + 0.09*hbD, 0.05*heat);
}

/* ---- scope ---- */
function drawScope(){
  sctx.clearRect(0,0,SW,SH);
  sctx.strokeStyle = 'rgba(255,255,255,0.05)'; sctx.lineWidth = 1;
  for (let k=0;k<=5;k++){ const x = Math.round((k/5)*SW)+0.5;
    sctx.beginPath(); sctx.moveTo(x,0); sctx.lineTo(x,SH); sctx.stroke(); }
  sctx.strokeStyle = 'rgba(255,255,255,0.10)';
  sctx.beginPath(); sctx.moveTo(0,SH/2); sctx.lineTo(SW,SH/2); sctx.stroke();
  if (scopeBuf.length < 2) return;
  const t0 = sim.t - 5;
  const trace = (fy, color, lw)=>{
    sctx.strokeStyle = color; sctx.lineWidth = lw; sctx.beginPath();
    let first = true;
    for (const p of scopeBuf){
      const x = (p.t-t0)/5*SW, y = fy(p);
      if (first){ sctx.moveTo(x,y); first=false; } else sctx.lineTo(x,y);
    }
    sctx.stroke();
  };
  const iS = Math.max(18, sim.Irms*1.6);
  trace(p => SH/2 - (Math.max(-iS,Math.min(iS,p.i))/iS)*(SH/2-4), 'rgba(255,180,84,0.92)', 1.4);
  let tbMax = 0; for (const p of scopeBuf) if (p.tb > tbMax) tbMax = p.tb;
  tbScale += (Math.max(5, tbMax*1.1) - tbScale)*0.08;       // autoescala suavizada
  trace(p => SH-3 - Math.min(1, p.tb/tbScale)*(SH-10), 'rgba(154,162,171,0.85)', 1.2);
}

/* ---- HUD ---- */
const setT = (el, v)=>{ if (el._t !== v){ el._t = v; el.textContent = v; } };   // só toca o DOM se mudou
const setC = (el, v)=>{ if (el._c !== v){ el._c = v; el.className = v; } };
function updateHUD(){
  setT(rRpm, (sim.omega < -0.2 ? '−' : '') + String(Math.round(Math.abs(sim.omega)*9.5493)).padStart(4,'0'));
  setT(rTq, Math.abs(sim.Tb).toFixed(1));
  setT(rPw, (sim.P/1000).toFixed(1));
  setT(rI, sim.Irms.toFixed(1)); setC(rI, sim.Irms > 12.5 ? 'hot' : '');
  { const Bp = CONFIG.phys.bPerA*sim.Irms*turnsRatio()*sim.sat; setT(rB, Bp.toFixed(2)); setC(rB, sim.sat < 0.76 ? 'hot' : ''); }   // B_lin > Bsat: núcleo saturando
  setT(rTmp, String(Math.round(sim.temp)));
  setC(rTmp, sim.temp > 180 ? 'hot' : '');
  setT(rTrk, String(Math.round(sim.tTrack))); setC(rTrk, sim.tTrack > 250 ? 'hot' : '');
  const n = Math.round(Math.max(0, Math.min(1, (sim.tTrack-28)/312))*16);
  segs.forEach((el,i)=> setC(el, 'seg' + (i<n ? ' lit' : '') + (i<n && i>=12 ? ' r' : '')));
  let st = 'PRONTO', cls = '';
  if (sim.trip){ st = 'SUPERAQUECIDO · RESFRIANDO'; cls = 'err'; }
  else if (sim.Irms > 0.3 && Math.abs(sim.omega) < 2){ st = 'EIXO PARADO'; cls = 'on'; }
  else if (sim.Irms > 0.3 && Math.abs(sim.Tb) > 3){ st = 'FRENANDO'; cls = 'on'; }
  else if (Math.abs(sim.omega) > 2){ st = 'EM ROTAÇÃO'; cls = 'run'; }
  setT(stTxt, st); setC(stDot, 'dot ' + cls);
}

/* ---- annotations projection ---- */
const pv = new THREE.Vector3();
function updateAnnotations(){
  if (!view.labels) return;
  for (const a of annEls){
    pv.copy(a.p).project(camera);
    const vis = pv.z < 1;
    a.el.style.display = a.line.style.display = vis ? '' : 'none';
    if (!vis){ a.dot.style.display = 'none'; continue; }
    a.dot.style.display = '';
    const x = (pv.x+1)/2*innerWidth, y = (1-pv.y)/2*innerHeight;
    const lx = x + a.side*56, ly = y - 40;
    a.el.style.transform = `translate(${lx}px,${ly}px)` + (a.side<0 ? ' translateX(-100%)' : '');
    a.line.setAttribute('x1', x);  a.line.setAttribute('y1', y);
    a.line.setAttribute('x2', lx); a.line.setAttribute('y2', ly+4);
    a.dot.setAttribute('cx', x);  a.dot.setAttribute('cy', y);
  }
}

/* ============================================================ main loop */
let acc = 0, last = performance.now()/1000, hudAcc = 1, heatAcc = 1, introT = 0, introDone = false;
function cancelIntro(){
  if (introDone) return;
  introDone = true; controls.enabled = true; controls.autoRotate = true;
}
renderer.domElement.addEventListener('pointerdown', cancelIntro);

function frame(){
  requestAnimationFrame(frame);
  const now = performance.now()/1000;
  const raw = Math.max(0, now-last); last = now;
  const dt = Math.min(0.05, raw);

  if (!introDone){
    introT += dt/2.4;
    const e = 1 - Math.pow(1-Math.min(1,introT), 3);
    camera.position.lerpVectors(camFrom, camTo, e);
    camera.lookAt(controls.target);
    if (introT >= 1){ introDone = true; controls.enabled = true; controls.autoRotate = true; }
  }

  // passo fixo com acumulador: física determinística, independente do FPS
  acc += Math.min(raw, CONFIG.sim.maxFrame);
  let n = 0;
  while (acc >= CONFIG.sim.dt && n < CONFIG.sim.maxSteps){
    step(CONFIG.sim.dt); acc -= CONFIG.sim.dt; n++;
    if (scopeBuf.length && scopeBuf[scopeBuf.length-1].t > sim.t) scopeBuf.length = 0;   // reset → limpa o traço
    record();
    const r = sim.Irms > 0.01 ? sim.I/sim.Irms : 0;          // torque instantâneo ∝ I²: média = Tb, pico = 2·Tb
    scopeBuf.push({ t:sim.t, i:sim.I, tb:Math.abs(sim.Tb)*r*r });
  }
  if (n === CONFIG.sim.maxSteps) acc = 0;
  discGroup.rotation.z = sim.phi;
  shaftGroup.rotation.z = sim.phi;

  updateDynamics(dt);
  updateAudio(); updateCamera(dt);

  while (scopeBuf.length && scopeBuf[0].t < sim.t-5.3) scopeBuf.shift();
  drawScope();

  hudAcc += dt; if (hudAcc > CONFIG.hudEvery){ hudAcc = 0; updateHUD(); }

  updateAnnotations();
  controls.update();
  render();
}

addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  resizeGL();
  sizeSvg(); sizeScope();
});

initFeatures();
frame();
