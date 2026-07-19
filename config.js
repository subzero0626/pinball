/* =========================================================================
 * config.js — 모든 조정 가능한 값은 이 파일 상단의 CONFIG 객체에 있습니다.
 * ========================================================================= */

const CONFIG = {
  /* --- 보드 크기 --- */
  boardWidth: 560,      // 좁힐수록 벽과 바깥쪽 페그 사이 간격이 줄어듭니다
  boardHeight: 820,
  wallThickness: 20,

  /* --- 페그 배열 --- */
  cols: 7,              // 짝수 행의 페그 개수
  rows: 8,              // 전체 행 개수 (짝수 행 7개 / 홀수 행 6개 → 총 52개)
  colSpacing: 74,       // 같은 행 안에서 페그 사이 가로 간격 (좁게)
  rowSpacing: 72,       // 행 사이 세로 간격 (넓게)
  firstRowY: 160,       // 첫 번째 페그 행의 y 좌표

  /* --- 물리 ---
   * 공의 움직임을 눈으로 따라갈 수 있도록 느리게 잡은 값들.
   * 더 빠르게 하려면 timeScale 과 gravity 를 올리세요.       */
  ballRadius: 10,
  pegRadius: 7,
  timeScale: 0.9,       // 전체 진행 속도 (1 = 기본 속도, 낮을수록 슬로모션)
  /* 물리·연출은 모니터 주사율과 무관하게 고정 60Hz 스텝으로 진행 */
  fixedDtMs: 1000 / 60,
  maxPhysSteps: 5,      // 한 프레임당 최대 물리 스텝 (탭 복귀 폭주 방지)
  gravity: 0.3,         // 작게 → 완만하게 가속
  restitution: 0.9,     // 페그에 부딪히면 확실히 튕기도록
  friction: 0.02,
  frictionStatic: 0,    // 기본값(0.5)은 저속에서 달라붙게 만듦
  /* frictionAir 가 크면 튕긴 속도가 바로 죽어 공이 안 튕긴다.
   * 낮게 유지해 반동을 살리되, 약간의 감쇠로 폭주는 막는다. */
  frictionAir: 0.010,
  ballDensity: 0.001,
  maxBallSpeed: 8,      // 튕김 여유를 두되 화면 밖으로 날아가지 않을 정도
  warpExitSpeed: 2,     // 워프 직후 아래 방향 속도

  /* 페그/일반 막대에 "거의 직각"으로 부딪힐 때만 좌우 ±20° 편향.
   * 일반 막대는 입사·이전 가로 힘 방향으로 치우치고, 페그만 좌우 랜덤. */
  deflectAngleDeg: 20,       // 편향 각도
  deflectMaxOffDeg: 20,      // 법선에서 이 각도 이내면 "직각"으로 본다
  deflectMinSpeed: 0.1,      // 이보다 느리면 편향하지 않음
  flatRollMinSpeed: 0.55,    // 0° 일반 막대 안착 시 굴림 최소 속력
  lastDirMinSpeed: 0.12,     // 이 이상 가로 속력이면 진행 방향 기억
  /* 페그에 맞을 때마다 속도 방향을 살짝 틀어 동일 경로 반복을 줄임 */
  pegPathJitterMinDeg: 2,
  pegPathJitterMaxDeg: 3,

  /* 특수 막대 통과 시 진행 방향을 좌/우로 살짝 꺾음 */
  passNudgeMinDeg: 7,
  passNudgeMaxDeg: 11,

  /* --- 막대 --- */
  /* 통과폭 = colSpacing - barLength - thickness ≈ 74-54-8 = 12 (< 공 지름 20)
   * → 인접 0° 사이로 잘 안 빠짐. 가둠은 5초 정지 룰로 처리. */
  barLength: 54,
  barThickness: 8,
  angleStep: 15,
  barClearance: 2,

  /* 공 정지 → 드롭 0점 */
  stuckSpeedMax: 0.08,
  stuckWarnMs: 2500,
  stuckFailMs: 5000,

  /* 워프 도착 — 위·아래 최대 칸 */
  warpMaxRowRange: 3,

  /* --- 발사 / 종료 --- */
  launchY: 60,
  launchSpeed: 1.2,
  launchZoneHeight: 130,
  sinkY: 766,
  ballsPerRound: 1,

  /* --- 드래프트 --- */
  draftOfferCount: 3,
  draftBarPool: [
    { type: 'normal', count: 2 },
    { type: 'score', count: 1 },
    { type: 'multiply', count: 1 },
    { type: 'duplicate', count: 1 },
    { type: 'warp', count: 1 },
  ],
  startingNormalBars: 3,

  /* --- 라운드 / 드롭 --- */
  dropsPerRound: 3,
  roundTargets: [12, 60, 242, 660, 1760, 4500, 13000, 35000, 95000, 250000],

  /* --- 유물 / 특수 밸런스 --- */
  effectBalance: {
    multiplyFactor: 2.3,
    passNudgeMinDeg: 3,
    passNudgeMaxDeg: 5,
    duplicateTripleChance: 0.15,
    pegScoreMult: 1.1,
    warpScoreMult: 1.5,
    scoreBarBase: 3,
    scoreBarEscalate: 1.5,
    sinkBonusWidthFrac: 0.5,
    sinkBonusMult: 1.5,
    targetCutFrac: 0.15,
    normalProcChance: 0.25,
    normalProcMult: 1.3,
    recycleUsesPerRound: 3,
    pegBounceMult: 1.3,
    contactScoreCooldownMs: 100,
    springBounceMult: 3,
    springMaxSpeed: 18,
    springRadius: 14,
    springAngleStep: 15,
    springCooldownMs: 100,
  },

  /* --- 연출 (지속 시간 ms — 주사율 무관) --- */
  effectLifeMs: 750,
  ringLifeMs: 470,
  spawnFlashMs: 200,
  invalidFlashMs: 400,
};

/** 점수·목표 등 게임 수치는 항상 반올림 정수로 취급 */
function gameInt(n) {
  return Math.round(Number(n));
}

/** 막대 길이 */
function barLengthFor(type, game) {
  return CONFIG.barLength;
}

/* CONFIG 에서 파생되는 값 (직접 수정하지 마세요) */
CONFIG.evenRowStartX = (CONFIG.boardWidth - (CONFIG.cols - 1) * CONFIG.colSpacing) / 2;
CONFIG.oddRowStartX = CONFIG.evenRowStartX + CONFIG.colSpacing / 2;

/* 막대 종류 정의 — 새로운 종류를 임의로 추가하지 않습니다. */
const BAR_TYPES = {
  normal:    { key: 'normal',    label: '일반 막대',    icon: '',   sensor: false, color: '#6b6560', glow: '#8a847a' },
  score:     { key: 'score',     label: '점수 막대',    icon: '+3', sensor: true,  color: '#2f7a4a', glow: '#4a9a64' },
  multiply:  { key: 'multiply',  label: '배수 막대',    icon: '×2', sensor: true,  color: '#b8860b', glow: '#d4a017' },
  duplicate: { key: 'duplicate', label: '복제 막대',    icon: '◎◎', sensor: true,  color: '#2f5d8c', glow: '#4a7eb0' },
  warp:      { key: 'warp',      label: '워프 막대',    icon: '↯',  sensor: true,  color: '#6b4f9a', glow: '#8a6bb8' },
};

/** Heroicons(outline) path — Tailwind와 함께 쓰는 SVG 아이콘 */
const RELIC_ICON_PATHS = {
  bolt: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  sparkles: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z',
  users: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
  arrowPath: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99',
  circleStack: 'M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75l-5.571-3m11.142 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3',
  handRaised: 'M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13',
  paperAirplane: 'M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5',
  chartBar: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  gift: 'M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
  document: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  shield: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  arrowPathRounded: 'M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3',
};

function relicIconSvg(iconKey, className = 'relic-icon-svg') {
  const d = RELIC_ICON_PATHS[iconKey] || RELIC_ICON_PATHS.sparkles;
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="${d}"/></svg>`;
}

/** 라운드 클리어 유물 (고른 뒤 영구) */
const EFFECT_TYPES = [
  {
    id: 'multiply_boost',
    label: '폭주의 인장',
    desc: '배수 막대가 ×2.3으로 강화됩니다.',
    icon: 'bolt',
  },
  {
    id: 'pass_stable',
    label: '고요한 궤도석',
    desc: '특수 막대 통과 시 꺾임이 3~5°로 완화됩니다.',
    icon: 'sparkles',
  },
  {
    id: 'duplicate_triple',
    label: '삼라분신패',
    desc: '복제 막대가 15% 확률로 공을 3개로 만듭니다.',
    icon: 'users',
  },
  {
    id: 'map_spring',
    label: '도약 태엽',
    desc: '맵에 스프링이 생깁니다. 한 번 발사되면 일반 막대가 됩니다(워프해도 초기화 안 됨). 튕기는 힘 3배. 워프한 공도 미사용 스프링은 탑니다.',
    icon: 'arrowPath',
  },
  {
    id: 'peg_score',
    label: '못의 축복',
    desc: '페그에 튕길 때 공 점수가 ×1.1이 됩니다.',
    icon: 'circleStack',
  },
  {
    id: 'peg_bounce',
    label: '강철 튕김쇠',
    desc: '페그가 공을 더 강하게 튕깁니다.',
    icon: 'handRaised',
  },
  {
    id: 'warp_mult',
    label: '균열 증폭석',
    desc: '워프 통과 시 공 점수가 ×1.5가 됩니다.',
    icon: 'paperAirplane',
  },
  {
    id: 'score_boost',
    label: '점수의 나선',
    desc: '점수 막대 가산이 3점부터 통과할 때마다 ×1.5씩 커집니다.',
    icon: 'chartBar',
  },
  {
    id: 'sink_bonus',
    label: '황금 심연',
    desc: '종료 구역 일부(약 50%)에 들어가면 점수가 ×1.5됩니다.',
    icon: 'gift',
  },
  {
    id: 'target_cut',
    label: '느슨한 계약',
    desc: '모든 라운드 목표 점수가 15% 줄어듭니다.',
    icon: 'document',
  },
  {
    id: 'normal_proc',
    label: '범인의 가호',
    desc: '일반 막대에 튕길 때 25% 확률로 점수가 ×1.3이 됩니다.',
    icon: 'shield',
  },
  {
    id: 'bar_recycle',
    label: '순환 도가니',
    desc: '특수 막대를 재사용 칸에 넣으면 다른 특수 막대로 바꿉니다. 라운드당 3회.',
    icon: 'arrowPathRounded',
  },
];

/* 기하 계산 헬퍼 (막대 겹침 판정에 사용) */
const Geom = {
  /** 점 P 와 선분 AB 사이의 최단 거리 */
  pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  },

  /** 두 선분이 교차하는가 */
  segIntersect(a1, a2, b1, b2) {
    const d = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = d(b1, b2, a1);
    const d2 = d(b1, b2, a2);
    const d3 = d(a1, a2, b1);
    const d4 = d(a1, a2, b2);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  },

  /** 두 선분 사이의 최단 거리 */
  segSegDist(a1, a2, b1, b2) {
    if (Geom.segIntersect(a1, a2, b1, b2)) return 0;
    return Math.min(
      Geom.pointSegDist(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y),
      Geom.pointSegDist(a2.x, a2.y, b1.x, b1.y, b2.x, b2.y),
      Geom.pointSegDist(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y),
      Geom.pointSegDist(b2.x, b2.y, a1.x, a1.y, a2.x, a2.y)
    );
  },

  /** 각도를 15도 단위로 스냅하고 0 이상 180 미만으로 정규화 */
  snapAngle(rawDeg) {
    let snapped = Math.round(rawDeg / CONFIG.angleStep) * CONFIG.angleStep;
    snapped = ((snapped % 180) + 180) % 180;
    return snapped;
  },
};
