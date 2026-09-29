// Todos os "números mágicos" do modelo num só lugar.
export const CONFIG = {
  disc:{ R:3.2, T:0.5 },
  poleX:2.2,                       // raio do eixo dos polos (mundo, +x)
  overlayOffset:0.004,             // afastamento entre planos E / B (anti z-fighting)
  cables:[
    [[2.7,-0.68,1.1],[3.0,-1.6,1.9],[2.9,-3.6,2.9],[2.6,-4.5,3.3]],
    [[2.7,-0.68,-1.1],[3.2,-1.6,-1.9],[3.4,-3.4,-1.5],[3.5,-4.4,1.2],[4.2,-4.5,3.3]]
  ],
  feedBoxX:[2.6,4.2],
  phys:{ bPerA:0.01525, bSat:1.6, trackFrac:0.08, gTrack:854, turns0:240, ratedA:12, motorGain:30, motorMin:-90, motorMax:400, slip0:140, brakeK:165,
         lossA:0.8, lossB:0.05, lossC:0.00055, inertia:2.4,
         heatFrac:0.9, cool:1601, thermalMass:55490, ambient:28, tripOn:300, tripOff:210 },   // thermalMass = m·c do disco real (Cu, Ø640×50mm ≈144 kg × 385 J/kg·K ≈55,5 kJ/K); gTrack/cool escalados na mesma proporção (~21,3×) pra manter o ritmo de resfriamento do demo original
  sim:{ dt:1/120, maxSteps:12, maxFrame:0.1 },   // passo fixo + acumulador
  hudEvery:0.12,
  heat:{ tau:3.0, lift:0.007, trackDT:100, tMax:400 },   // trackDT: sobreelevação didática da trilha; tMax: fim da escala do mapa (°C)
  materials:{   // σ (S/m), ρ (kg/m³), c (J/kg·K); Cu é a referência do modelo
    Cu:{ name:'Cobre',    sigma:5.96e7, rho:8960, c:385, color:0xc97a3f, metal:1.0,  rough:0.30 },
    Al:{ name:'Alumínio', sigma:3.5e7,  rho:2700, c:897, color:0xbcc3ca, metal:1.0,  rough:0.35 },
    Fe:{ name:'Aço',      sigma:6.0e6,  rho:7850, c:490, color:0x6f757c, metal:0.85, rough:0.50 }
  },
  shadow:{ high:2048, low:512 },
  bloom:{ strength:0.55, radius:0.6, threshold:1.0, fieldGain:1.7, discGain:2.4 }
};
