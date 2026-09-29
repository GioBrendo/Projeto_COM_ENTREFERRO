import { CONFIG } from './config.js';
const P = CONFIG.phys, M = CONFIG.materials, REF = M.Cu;
export const view   = { field:true, efield:true, swirl:true, labels:true };
export const params = { rpm:900, exc:0.55, freq:1.2, hold:false, motor:true, mode:'ac', dir:1, mat:'Cu', turns:P.turns0 };
const init = () => ({ t:0, theta:0, omega:0, phi:0, temp:P.ambient, tTrack:P.ambient, trip:false, I:0, Irms:0, Ir:0, sat:1, Tb:0, P:0, eN:0, uEff:0 });
export const sim    = init();
export function resetSim(omega0 = 0){ Object.assign(sim, init(), { omega:omega0 }); }
export const turnsRatio = () => params.turns/P.turns0;   // B ∝ N·I
// Saturação do núcleo: B = Bsat·tanh(B_lin/Bsat). x = N·I em unidades de projeto (12 A × 240 esp.) → corrente efetiva saturada
const XS = P.bSat/(P.bPerA*P.ratedA);
export const satB = x => x > 0 ? XS*Math.tanh(x/XS) : 0;
// σ menor → velocidade crítica maior (slip0 ∝ 1/σ); ρ·c define a massa térmica (mesmo volume de disco)
export function matProps(key = params.mat){
  const m = M[key] || REF;
  return { ...m, slip0:P.slip0*REF.sigma/m.sigma, thermalMass:P.thermalMass*(m.rho*m.c)/(REF.rho*REF.c) };
}

export function step(dt){
  const mp = matProps(), d = params.dir;
  sim.uEff = sim.trip ? 0 : (params.hold ? Math.max(1, params.exc) : params.exc);
  sim.t += dt;
  sim.theta = (sim.theta + 2*Math.PI*params.freq*dt) % (2*Math.PI);   // fase acumulada: sem salto ao mudar f
  const Ipk = P.ratedA*sim.uEff;
  sim.I    = sim.uEff > 0 ? (params.mode === 'dc' ? Ipk : Ipk*Math.SQRT2*Math.sin(sim.theta)) : 0;   // CC: I = valor ef. → torque constante = Tb
  sim.Irms = Ipk;
  const x = sim.uEff*turnsRatio(), Ir = satB(x);     // Ir: excitação efetiva após saturação (torque ∝ Ir²)
  sim.Ir = Ir; sim.sat = x > 1e-6 ? Ir/x : 1;
  const w = sim.omega, wT = params.rpm*Math.PI/30, raw = P.motorGain*(wT - d*w);
  const free = raw > P.motorMin && raw < P.motorMax;   // dentro dos limites o motor age como amortecedor linear
  const Fm = params.motor ? (free ? d*P.motorGain*wT : d*(raw <= P.motorMin ? P.motorMin : P.motorMax)) : 0, cm = params.motor && free ? P.motorGain : 0;
  const s = w/mp.slip0, cb = P.brakeK*Ir*Ir*2/(mp.slip0*(1 + s*s));   // Tb = cb·ω, com amortecimento efetivo cb ≥ 0 (ímpar em ω: Lenz)
  const w1 = (w + dt*Fm/P.inertia)/(1 + dt*(cb + cm)/P.inertia);      // Euler semi-implícito no amortecimento: estável para qualquer brakeK
  sim.Tb = cb*w1;
  const aw = Math.abs(w), fr = (P.lossA + P.lossB*aw + P.lossC*aw*aw)/P.inertia*dt;   // atrito nunca inverte o sentido
  sim.omega = Math.sign(w1)*Math.max(0, Math.abs(w1) - fr);
  sim.phi += sim.omega*dt;
  sim.P = sim.Tb*sim.omega;
  // dois nós térmicos: trilha sob os polos (pouca massa, recebe o calor) → disco (massa maior, perde para o ambiente)
  const Ct = mp.thermalMass*P.trackFrac, Cd = mp.thermalMass - Ct, flow = P.gTrack*(sim.tTrack - sim.temp);
  sim.tTrack += (sim.P*P.heatFrac - flow)/Ct*dt;
  sim.temp   += (flow - P.cool*(sim.temp - P.ambient))/Cd*dt;
  if (!sim.trip && sim.tTrack > P.tripOn)  sim.trip = true;     // a proteção atua na trilha (ponto mais quente)
  if (sim.trip  && sim.tTrack < P.tripOff) sim.trip = false;
}
