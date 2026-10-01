import { CONFIG } from './config.js';
import { params, sim, resetSim, matProps } from './physics.js';
import { matCopper } from './materials.js';
import * as THREE from 'three';
import { renderer, render, camera, controls } from './scene.js';

const $ = id => document.getElementById(id);
const H = CONFIG.heat, AMB = CONFIG.phys.ambient, MATS = CONFIG.materials;

/* ---------- paleta inferno (uniforme perceptualmente); mesma da GLSL em main.js ---------- */
export const INFERNO_GLSL = `vec3 pal(float t){
  const vec3 c0=vec3(0.0002189,0.0016510,-0.0194809),c1=vec3(0.1065134,0.5639564,3.9327124),c2=vec3(11.6024931,-3.9728540,-15.9423941),
  c3=vec3(-41.7039961,17.4363989,44.3541452),c4=vec3(77.1629357,-33.4023589,-81.8073093),c5=vec3(-71.3194282,32.6260643,73.2095199),c6=vec3(25.1311262,-12.2426690,-23.0703250);
  return clamp(c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6))))),0.,1.); }`;
const cs = [[0.0002189,0.0016510,-0.0194809],[0.1065134,0.5639564,3.9327124],[11.6024931,-3.9728540,-15.9423941],[-41.7039961,17.4363989,44.3541452],[77.1629357,-33.4023589,-81.8073093],[-71.3194282,32.6260643,73.2095199],[25.1311262,-12.2426690,-23.0703250]];
const inferno = t => [0,1,2].map(k => Math.round(255*Math.min(1, Math.max(0, cs.reduceRight((a,c)=>a*t + c[k], 0)))));
const ramp = () => 'linear-gradient(90deg,' + [...Array(9)].map((_,k)=>`rgb(${inferno(k/8)}) ${k*12.5}%`) + ')';
function paintLegends(){
  $('lgH').firstElementChild.style.background = ramp(); $('lgB').firstElementChild.style.background = ramp();
  const pos = T => (T-AMB)/(H.tMax-AMB)*100, box = $('lgH').lastElementChild;
  box.style.cssText = 'position:relative;height:11px;display:block';
  box.innerHTML = [AMB,100,200,300,H.tMax].map((T,k)=>`<span style="position:absolute;left:${pos(T)}%;transform:translateX(${k===0?0:k===4?-100:-50}%)">${T}${k===4?' °C':''}</span>`).join('');
  box.title = 'Temperatura estimada do disco (média + trilha sob o polo); escala didática';
}

/* ---------- controles: modo, sentido, material ---------- */
const selMode = $('selMode'), selMat = $('selMat'), btnDir = $('btnDir');
const setRange = (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new Event('input')); };
function setMode(m){ params.mode = m === 'dc' ? 'dc' : 'ac'; selMode.value = params.mode;
  $('inFrq').disabled = params.mode === 'dc'; $('lgT').textContent = params.mode === 'dc' ? 'torque · constante' : 'torque · 2f'; }
function setDir(d){ params.dir = +d < 0 ? -1 : 1; btnDir.textContent = params.dir < 0 ? 'SENTIDO DO EIXO: ↺ REVERSO' : 'SENTIDO DO EIXO: ↻ NORMAL'; btnDir.setAttribute('aria-pressed', params.dir < 0); }
function setMat(k){ if (!MATS[k]) k = 'Cu'; params.mat = k; selMat.value = k; const m = MATS[k], mp = matProps(k);
  matCopper.color.setHex(m.color); matCopper.metalness = m.metal; matCopper.roughness = Math.min(1, m.rough*1.5);   // compensa o mapa de rugosidade (média ≈ 0,7)
  $('matInfo').textContent = `σ ${(m.sigma/1e6).toFixed(1)} MS/m · ρ ${m.rho} kg/m³ · c ${m.c} J/kg·K · ω crítica ${Math.round(mp.slip0*30/Math.PI)} rpm${k === 'Fe' ? ' · aprox.: μr≈1, ignora ferromagnetismo' : ''}`; }
selMode.onchange = () => setMode(selMode.value);
selMat.onchange  = () => setMat(selMat.value);
btnDir.onclick   = () => setDir(-params.dir);
selMat.innerHTML = Object.entries(MATS).map(([k,m]) => `<option value="${k}">${m.name}</option>`).join('');

/* ---------- cenários e roteiros ---------- */
const S = {
  emerg:[{ set:{ n:240, rpm:900, exc:1, f:1.2, mode:'ac', dir:1, mat:'Cu', motor:false, w0:900 },
    text:'Frenagem de emergência: motor desligado, disco a 900 rpm, 12 A nominais. Sem contato, o disco para em ~1–2 s; a energia cinética (~80 J) vira calor e aquece o disco só ~0,1 °C. Segure Espaço para excitação total.' }],
  heat:[{ set:{ n:240, rpm:1300, exc:1.5, f:1.2, mode:'ac', dir:1, mat:'Cu', motor:true, w0:1300 },
    text:'Regime contínuo: motor mantendo 1300 rpm com 18 A. Em alta velocidade o torque cai como 1/ω e a potência dissipada satura (~140 W): o disco aquece devagar (constante de tempo de minutos) e a perda Joule das bobinas (I²R) é comparável ao calor do disco.' }],
  dcac:[
    { set:{ n:240, rpm:900, exc:1, f:2, mode:'ac', dir:1, mat:'Cu', motor:true, w0:900 }, text:'1/4 · CA a 2 Hz: o torque pulsa a 2f (traço cinza) e a média vale Tb.' },
    { set:{ mode:'dc' }, text:'2/4 · CC: mesmo valor eficaz, torque constante, sem ondulação.' },
    { set:{ dir:-1 }, text:'3/4 · Sentido reverso (Lenz): o torque continua se opondo ao movimento e as correntes parasitas giram ao contrário.' },
    { set:{ dir:1, mat:'Al' }, text:'4/4 · Alumínio: σ menor → velocidade crítica maior → freia menos em rotação baixa.' }]
};
let tour = null, idx = 0, tourName = '';
const CAMS = { emerg:['disc'], heat:['disc'], dcac:['overview','coils','disc','disc'] };
function apply(s){
  if (s.w0 !== undefined) resetSim(s.w0*Math.PI/30);
  if (s.n !== undefined) setRange('inTrn', s.n);
  if (s.rpm !== undefined) setRange('inRpm', s.rpm);
  if (s.exc !== undefined) setRange('inExc', s.exc);
  if (s.f !== undefined) setRange('inFrq', s.f);
  if (s.mode) setMode(s.mode); if (s.dir) setDir(s.dir); if (s.mat) setMat(s.mat);
  if (s.motor !== undefined){ $('tMotor').checked = s.motor; $('tMotor').dispatchEvent(new Event('change')); }
}
function show(){ const st = tour[idx]; apply(st.set); flyTo(CAMS[tourName][idx]); $('gTxt').textContent = st.text; $('guide').hidden = false; $('gNext').hidden = idx >= tour.length-1; }
document.querySelectorAll('[data-scn]').forEach(b => b.onclick = () => { tourName = b.dataset.scn; tour = S[tourName]; idx = 0; show(); });
$('gNext').onclick = () => { idx++; show(); };
$('gEnd').onclick  = () => { $('guide').hidden = true; tour = null; };

/* ---------- estado na URL ---------- */
const hashOf = () => '#' + new URLSearchParams({ rpm:params.rpm, exc:params.exc, f:params.freq, n:params.turns, mode:params.mode, dir:params.dir, mat:params.mat, motor:+params.motor });
function readHash(){
  const q = new URLSearchParams(location.hash.slice(1)); if (![...q.keys()].length) return;
  const n = k => q.has(k) && isFinite(+q.get(k)) ? +q.get(k) : undefined;
  apply({ n:n('n'), rpm:n('rpm'), exc:n('exc'), f:n('f'), mode:q.get('mode') || undefined, dir:n('dir'), mat:q.get('mat') || undefined, motor:q.has('motor') ? q.get('motor') === '1' : undefined });
}
addEventListener('hashchange', () => { if (location.hash !== hashOf()) readHash(); });
setInterval(() => { const h = hashOf(); if (location.hash !== h) history.replaceState(null, '', h); }, 400);

/* ---------- registro (CSV) e captura ---------- */
const log = []; let lastT = 0, k = 0;
export function record(){                      // chamado a cada passo fixo (120 Hz) → grava a 60 Hz
  if (sim.t < lastT) log.length = 0;           // reset da simulação = nova corrida
  lastT = sim.t;
  if (++k % 2) return;
  log.push([sim.t, sim.I, sim.omega, sim.Tb, sim.P, sim.temp, sim.tTrack, sim.tCoil, sim.V, sim.Pel]);
  if (log.length > 40000) log.splice(0, 5000);
}
const stamp = () => new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
const tag = () => `${params.mode}_${params.mat}_${params.rpm}rpm_${stamp()}`;
$('btnCsv').onclick = () => {
  const rows = ['t_s,I_A,omega_rad_s,Tb_N_m,P_W,T_disco_C,T_trilha_C,T_bobina_C,V_ef_V,P_ativa_W', ...log.map(r => r.map((v,i) => v.toFixed(i === 0 ? 3 : 4)).join(','))];
  save(new Blob([rows.join('\n')], { type:'text/csv' }), `foucault_${tag()}.csv`);
};
$('btnPng').onclick = () => {
  render();                                     // desenha e lê o buffer na mesma tarefa (sem preserveDrawingBuffer)
  const src = renderer.domElement, band = 34, c = document.createElement('canvas'); c.width = src.width; c.height = src.height + band;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0); x.fillStyle = '#0f1113'; x.fillRect(0, src.height, c.width, band);
  x.fillStyle = '#e8a15c'; x.font = '13px monospace';
  x.fillText(`${params.mode.toUpperCase()}${params.mode === 'ac' ? ' ' + params.freq.toFixed(1) + ' Hz' : ''} · ${(params.exc*CONFIG.phys.ratedA).toFixed(1)} A ef. · ${params.turns} esp./bobina · ${MATS[params.mat].name} · alvo ${params.rpm} rpm${params.dir < 0 ? ' (reverso)' : ''} · t=${sim.t.toFixed(1)} s · ${Math.round(sim.omega*30/Math.PI)} rpm · ${Math.round(sim.temp)} °C`, 10, src.height + 22);
  c.toBlob(b => save(b, `foucault_${tag()}.png`), 'image/png');
};
$('btnLink').onclick = async () => { const u = location.origin + location.pathname + hashOf(); try { await navigator.clipboard.writeText(u); $('btnLink').textContent = 'LINK COPIADO'; } catch { prompt('Copie o link:', u); } setTimeout(() => $('btnLink').textContent = 'COPIAR LINK', 1500); };

/* ---------- câmera com easing nos cenários ---------- */
const VIEWS = { overview:{ p:[8.2,3.6,10.4], t:[1.2,-0.4,0] }, coils:{ p:[6.2,2.4,6.4], t:[2.2,0,0.8] }, disc:{ p:[1.5,1.5,11.5], t:[0.5,-0.2,0] } };
let tw = null;
function flyTo(name, dur = 1.4){ const v = VIEWS[name]; if (!v || !controls.enabled) return; controls.autoRotate = false;
  tw = { t:0, dur, p0:camera.position.clone(), t0:controls.target.clone(), p1:new THREE.Vector3(...v.p), t1:new THREE.Vector3(...v.t) }; }
export function updateCamera(dt){ if (!tw) return; tw.t += dt; const k = Math.min(1, tw.t/tw.dur), e = k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;
  camera.position.lerpVectors(tw.p0, tw.p1, e); controls.target.lerpVectors(tw.t0, tw.t1, e); if (k >= 1) tw = null; }
controls.addEventListener('start', () => { tw = null; });   // arrastar cancela a animação

/* ---------- áudio: zumbido 100/200/300 Hz (∝ excitação em CA) + ruído de rotação (∝ ω) ---------- */
let ac = null, humG, windG, windF; const humOsc = [];
function startAudio(){
  ac = new (window.AudioContext || window.webkitAudioContext)();
  const master = ac.createGain(); master.gain.value = 0.35; master.connect(ac.destination);
  humG = ac.createGain(); humG.gain.value = 0; humG.connect(master);
  for (const [fq, g] of [[100,1],[200,.5],[300,.25]]){ const o = ac.createOscillator(), gg = ac.createGain(); o.frequency.value = fq; humOsc.push([o, fq/100]); gg.gain.value = g; o.connect(gg).connect(humG); o.start(); }
  const buf = ac.createBuffer(1, ac.sampleRate*2, ac.sampleRate), ch = buf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random()*2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
  windF = ac.createBiquadFilter(); windF.type = 'bandpass'; windF.Q.value = .8; windG = ac.createGain(); windG.gain.value = 0;
  src.connect(windF).connect(windG).connect(master); src.start();
}
export function updateAudio(){
  if (!ac || ac.state !== 'running') return; const t = ac.currentTime, w = Math.min(1, Math.abs(sim.omega)/250);
  for (const [o, h] of humOsc) o.frequency.setTargetAtTime(Math.max(25, 2*params.freq*h), t, .1);   // zumbido = 2f (piso de 25 Hz para ficar audível)
  humG.gain.setTargetAtTime((params.mode === 'ac' ? 0.4 : 0.03)*Math.min(1, sim.Ir/0.6), t, .08);
  windG.gain.setTargetAtTime(w*w*.5, t, .1); windF.frequency.setTargetAtTime(150 + 1800*w, t, .1);
}
$('tSound').onchange = e => { if (e.target.checked){ if (!ac) startAudio(); ac.resume(); } else if (ac) ac.suspend(); };

export function initFeatures(){ paintLegends(); setMode(params.mode); setDir(params.dir); setMat(params.mat); readHash(); }
