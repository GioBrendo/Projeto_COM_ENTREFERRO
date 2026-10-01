import { CONFIG } from './config.js';
const P = CONFIG.phys, M = CONFIG.materials, REF = M.Cu;
export const view   = { field:true, efield:true, swirl:true, labels:true };
export const params = { rpm:900, exc:0.55, freq:1.2, hold:false, motor:true, mode:'ac', dir:1, mat:'Cu', turns:P.turns0 };
const init = () => ({ t:0, theta:0, omega:0, phi:0, temp:P.ambient, tTrack:P.ambient, tCoil:P.ambient, V:0, Pel:0, PJ:0, Ptr:0, I:0, Irms:0, Ir:0, sat:1, Tb:0, P:0, eN:0, uEff:0 });
export const sim    = init();
export function resetSim(omega0 = 0){ Object.assign(sim, init(), { omega:omega0 }); }
export const turnsRatio = () => params.turns/P.turns0;   // B ∝ N·I
// bPerA = B de pico (T) por A ef. nominal; B(t) segue a corrente instantânea: B_lin = bInst·i(t)·N/N0. Em CA, i de pico = √2·I ef.; em CC, i = I ef.
export const bInst = P.bPerA/Math.SQRT2;
// Saturação do núcleo, PONTUAL (a corrente instantânea satura, não o valor eficaz): B = Bsat·tanh(B_lin/Bsat), Bsat = limite no entreferro (seção do braço)
export const bOf = i => P.bSat*Math.tanh(bInst*i*turnsRatio()/P.bSat);
export const peakB = () => Math.abs(bOf(sim.Irms*(params.mode === 'ac' ? Math.SQRT2 : 1)));
// valor eficaz de B(t) num ciclo (CA: média de B² por quadratura; CC: constante). Torque médio ∝ <B²>.
const NQ = 48;
function bRms(irms){
  if (params.mode !== 'ac') return Math.abs(bOf(irms));
  let a = 0; for (let n = 0; n < NQ; n++){ const b = bOf(Math.SQRT2*irms*Math.sin(2*Math.PI*(n + 0.5)/NQ)); a += b*b; }
  return Math.sqrt(a/NQ);
}
export const bRmsNow = () => bRms(sim.Irms);
// σ menor → velocidade crítica maior (slip0 ∝ 1/σ); ρ·c define a massa térmica (mesmo volume de disco)
export function matProps(key = params.mat){
  const m = M[key] || REF;
  return { ...m, slip0:P.slip0*REF.sigma/m.sigma, thermalMass:P.thermalMass*(m.rho*m.c)/(REF.rho*REF.c) };
}

const SB = 5.670374e-8;
export function step(dt){
  const mp = matProps(), d = params.dir, k = turnsRatio(), C = P.coil;
  sim.uEff = params.hold ? Math.max(1, params.exc) : params.exc;
  sim.t += dt;
  sim.theta = (sim.theta + 2*Math.PI*params.freq*dt) % (2*Math.PI);   // fase acumulada: sem salto ao mudar f
  const Ipk = P.ratedA*sim.uEff;
  sim.I    = sim.uEff > 0 ? (params.mode === 'dc' ? Ipk : Ipk*Math.SQRT2*Math.sin(sim.theta)) : 0;   // CC: I = valor ef. → torque constante = Tb
  sim.Irms = Ipk;
  const x = sim.uEff*k, Bq = bRms(Ipk), Ir = Bq/(bInst*P.ratedA);   // Ir: excitação efetiva após saturação, em unidades de N·I nominal (torque ∝ Ir²)
  sim.Ir = Ir; sim.sat = x > 1e-6 ? Ir/x : 1;
  const w = sim.omega, wT = params.rpm*Math.PI/30, raw = P.motorGain*(wT - d*w);
  const free = raw > P.motorMin && raw < P.motorMax;   // dentro dos limites o motor age como amortecedor linear
  const Fm = params.motor ? (free ? d*P.motorGain*wT : d*(raw <= P.motorMin ? P.motorMin : P.motorMax)) : 0, cm = params.motor && free ? P.motorGain : 0;
  const aT = 1 + mp.alpha*(sim.tTrack - 20), sg = mp.sigma/aT, slip = mp.slip0*aT;   // σ(T) = σ20/(1+α·ΔT): trilha quente → ωc maior
  const s = w/slip, cb = P.brakeK*Ir*Ir*2/(slip*(1 + s*s));   // Tb = cb·ω, com amortecimento efetivo cb ≥ 0 (ímpar em ω: Lenz)
  const w1 = (w + dt*Fm/P.inertia)/(1 + dt*(cb + cm)/P.inertia);      // Euler semi-implícito no amortecimento: estável para qualquer brakeK
  sim.Tb = cb*w1;
  const aw = Math.abs(w), fr = (P.lossA + P.lossB*aw + P.lossC*aw*aw)/P.inertia*dt;   // atrito nunca inverte o sentido
  sim.omega = Math.sign(w1)*Math.max(0, Math.abs(w1) - fr);
  sim.phi += sim.omega*dt;
  sim.P = sim.Tb*sim.omega;
  // elétrico: R(T)·N², L ∝ N²·sat, I²R, tensão |Z|·I e indução (transformador) no disco, blindada por 1/(1+st²)
  const om = 2*Math.PI*params.freq, Rc = C.R20*(1 + C.alpha*(sim.tCoil - 20))*k*k, Lc = C.L0*k*k*sim.sat;
  sim.PJ  = Ipk*Ipk*Rc;
  sim.V   = Ipk*Math.hypot(Rc, params.mode === 'ac' ? om*Lc : 0);
  sim.Ptr = params.mode === 'ac' ? P.trP*sg*om*om*Bq*Bq/(1 + (om*sg*P.trS)**2) : 0;   // π·σ·ω²·B²ef·d·a⁴/8
  sim.Pel = sim.PJ + sim.Ptr;   // potência ativa da fonte; Tb·ω vem do eixo, não da fonte
  // térmico: trilha (anel varrido) → disco → ambiente (convecção h(ω) + radiação); bobina com nó próprio
  const Ct = mp.thermalMass*P.trackFrac, Cd = mp.thermalMass - Ct, flow = P.gTrack*(sim.tTrack - sim.temp);
  const Tm = sim.temp + 273.15, Ta = P.ambient + 273.15;
  const hTot = P.h0 + P.h1*aw + P.eps*SB*(Tm*Tm + Ta*Ta)*(Tm + Ta);
  sim.tTrack += (sim.P*P.heatFrac + sim.Ptr - flow)/Ct*dt;
  sim.temp   += (flow - hTot*P.area*(sim.temp - P.ambient))/Cd*dt;
  sim.tCoil  += (sim.PJ - C.G*(sim.tCoil - P.ambient))/C.C*dt;
}
