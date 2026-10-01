// Todos os "números mágicos" do modelo num só lugar.
// ÚNICA fonte das dimensões do disco (1 = 100 mm): Ø250 × 5 mm. Toda a geometria 3D é derivada daqui.
const DISC = { R:1.25, T:0.05 }, VIEW_R = 3.2;   // VIEW_R: raio do disco na cena (polos, núcleo, bobinas e mapa de calor foram desenhados p/ esse raio)
const S = VIEW_R/DISC.R;                          // unidades de cena por unidade do disco
// REF (Ø640×50) × SC só sobrevive no motor de bancada idealizado (motorGain/Min/Max) e nos limiares de HUD. Inércia, atrito, convecção, condução e bobina vêm da GEOMETRIA (bloco após BRAKE_K).
const REF = { R:3.2, T:0.5 };
const SC  = (DISC.R*DISC.R*DISC.T)/(REF.R*REF.R*REF.T);   // = 1/65,536
const CU  = { sigma:5.96e7, rho:8960, c:385 };            // σ (S/m), ρ (kg/m³), c (J/kg·K)
const DISC_HEATCAP = CU.rho*CU.c*Math.PI*(DISC.R*0.1)**2*(DISC.T*0.1);   // m·c do disco (raio e espessura em m): ≈ 847 J/K

// ---- Circuito magnético (núcleo em C de aço-Si, 2 bobinas em série aditiva) e freio de Foucault, derivados da GEOMETRIA do desenho ----
// (espelha main.js: sapata polar r = 0,62 un.; seção do braço/coluna 0,4 × 1,0 un.; entreferro 0,6·T por lado; polo em x = 2,2 un.)
const MU0 = 4e-7*Math.PI, U = DISC.R*0.1/VIEW_R, D = DISC.T*0.1;   // U: m por unidade de cena; D: espessura do disco (m)
const TURNS0 = 240, RATED_A = 12, POLE_X = 2.2;
const G_TOT  = 2*0.6*D + D;                       // caminho sem ferro: 2 entreferros + disco (μr≈1) = 11 mm; o ferro (μr≫1) quase não entra
const POLE_A = 0.62*U, POLE_R = POLE_X*U;         // raio da sapata (m) e raio do eixo do polo (m)
const A_GAP  = Math.PI*POLE_A**2;                 // área da face polar ≈ 1843 mm²
const A_LIMB = 0.95*(0.4*U)*(1.0*U);              // seção líquida do braço/coluna (empilhamento 0,95) ≈ 580 mm²: o gargalo do núcleo
const K_F = 0.9, BSAT_FE = 1.6;                   // K_F: fuga + franjamento (estimativa de projeto, ±10 %); BSAT_FE: joelho do aço-Si (T)
const B_PER_A   = K_F*MU0*2*TURNS0*Math.SQRT2/G_TOT;   // B pico no entreferro por A ef. (lei de Ampère: MMF = 2·N·I)
const B_SAT_GAP = K_F*BSAT_FE*A_LIMB/A_GAP;            // B no entreferro em que o braço atinge BSAT_FE (conservação do fluxo: B_gap·A_gap = B_braço·A_braço)
// Freio de disco fino (Schieber): T(ω) = 2·Tmax·s/(1+s²), s = ω/ωc.
//  inclinação em baixa velocidade (robusta): c0 = ½·σ·d·B²·(π·a²)·r²   (B = valor CC-equivalente; ½ = campo circular sobre folha infinita)
//  velocidade crítica: reação das correntes = campo aplicado → vc = 2·tanh(k·g/2)/(μ0·σ·d), k = π/(2a); com ferro dos dois lados reação ≥ espaço livre (tanh<1)
//  Tmax = c0·ωc/2. Incerteza de ωc ≈ ×2 (modelo concentrado); Tmax independe de σ, ωc ∝ 1/σ.
const B_EQ  = B_PER_A*RATED_A/Math.SQRT2;                    // B eficaz equivalente em CC, nominal, sem saturar
const TH    = Math.tanh(Math.PI*G_TOT/(4*POLE_A));
const SLIP0 = 2*TH/(MU0*CU.sigma*D)/POLE_R;                  // ωc (rad/s) do Cu ≈ 21 rad/s ≈ 203 rpm
const BRAKE_K = 0.5*B_EQ**2*Math.PI*POLE_A**2*POLE_R*TH/MU0; // Tmax (N·m) com Ir = 1 (excitação nominal linear) ≈ 7,6 N·m
// ---- Grandezas derivadas da GEOMETRIA (disco Ø250×5): inércia, trilha, bobina, transformador ----
const R_M = DISC.R*0.1, M_DISC = CU.rho*Math.PI*R_M*R_M*D, A_DISC = 2*Math.PI*R_M*(R_M + D);   // raio (m), massa (kg), área de troca: 2 faces + borda (m²)
const J_DISC = 0.5*M_DISC*R_M*R_M + 7e-4;                 // kg·m²: disco (½mR²) + cubo e eixo de aço do desenho
const TRACK_FRAC = 4*POLE_R*POLE_A/(R_M*R_M);             // fração da massa no anel varrido sob os polos (r ± a) ≈ 0,53
const G_TRACK = 390*D*2*Math.PI*POLE_R/POLE_A;            // condução radial anel → resto do disco (k_Cu = 390 W/m·K) ≈ 44 W/K
const WIRE_A0 = RATED_A/5e6;                               // seção do fio p/ 5 A/mm² no nominal (m²); janela fixa → R ∝ N², J ∝ N·I
const LT = 2*Math.PI*0.605*U;                              // comprimento médio da espira (m)
const COIL = { R20:1.72e-8*2*TURNS0*LT/WIRE_A0, alpha:0.0039, C:1.1*385*CU.rho*2*TURNS0*LT*WIRE_A0, G:1.5,
  L0:4*MU0*TURNS0**2*A_GAP*K_F/G_TOT };   // par em série: R20 ≈ 0,51 Ω, L ≈ 44 mH (não saturado), isolação classe F
export const CONFIG = {
  disc:{ ...DISC, Rv:VIEW_R, Tv:DISC.T*S, gap:0.6*DISC.T*S, mm:DISC.R*100/VIEW_R },   // Rv/Tv: raio/espessura na cena; gap: entreferro por lado (0,6·T = 3 mm p/ 5 mm); mm: mm por unidade de cena
  poleX:POLE_X,                       // raio do eixo dos polos (mundo, +x)
  overlayOffset:0.004,             // afastamento entre planos E / B (anti z-fighting)
  cables:[
    [[2.7,-0.68,1.1],[3.0,-1.6,1.9],[2.9,-3.6,2.9],[2.6,-4.5,3.3]],
    [[2.7,-0.68,-1.1],[3.2,-1.6,-1.9],[3.4,-3.4,-1.5],[3.5,-4.4,1.2],[4.2,-4.5,3.3]]
  ],
  feedBoxX:[2.6,4.2],
  phys:{ bPerA:B_PER_A, bSat:B_SAT_GAP, trackFrac:TRACK_FRAC, turns0:TURNS0, ratedA:RATED_A, slip0:SLIP0, heatFrac:1.0, ambient:28,
         // bPerA: B de pico (T) por A ef. com turns0 espiras (ver bloco acima); por ampere instantâneo vale bPerA/√2. bSat: B máx. no ENTREFERRO (limitado pela seção do núcleo), não o Bsat do aço
         // brakeK/slip0: físicos (acima, bloco do freio). Abaixo: inércia, atrito (rolamentos + windage Cm·ρ·R⁵·ω²), convecção h = h0 + h1·ω (+ radiação), condução na trilha, transformador (trP, trS) e bobina (R, L, C, G) vêm da geometria; só o motor idealizado segue REF × SC
         gTrack:G_TRACK, motorGain:30*SC, motorMin:-90*SC, motorMax:400*SC, brakeK:BRAKE_K,
         lossA:0.003, lossB:5e-5, lossC:0.006*1.2*R_M**5, inertia:J_DISC, area:A_DISC, h0:6, h1:0.11, eps:0.4,
         trP:Math.PI*D*POLE_A**4/8, trS:MU0*D*POLE_A/(2*TH), coil:COIL, thermalMass:DISC_HEATCAP,
         scale:SC },   // scale: fator SC exposto p/ limiares de torque/potência no HUD e no osciloscópio
  sim:{ dt:1/120, maxSteps:12, maxFrame:0.1 },   // passo fixo + acumulador
  hudEvery:0.12,
  heat:{ tau:3.0, lift:0.007, trackDT:100, tMax:400 },   // trackDT: sobreelevação didática da trilha; tMax: fim da escala do mapa (°C)
  materials:{   // σ (S/m), ρ (kg/m³), c (J/kg·K); Cu é a referência do modelo
    Cu:{ name:'Cobre',    ...CU, alpha:0.0039, color:0xc97a3f, metal:1.0,  rough:0.30 },
    Al:{ name:'Alumínio', sigma:3.5e7, alpha:0.0040,  rho:2700, c:897, color:0xbcc3ca, metal:1.0,  rough:0.35 },
    Fe:{ name:'Aço',      sigma:6.0e6, alpha:0.0065,  rho:7850, c:490, color:0x6f757c, metal:0.85, rough:0.50 }
  },
  shadow:{ high:2048, low:512 },
  bloom:{ strength:0.55, radius:0.6, threshold:1.0, fieldGain:1.7, discGain:2.4 }
};
