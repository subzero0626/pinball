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

  /* 페그/일반 막대에 "거의 직각"으로 부딪힐 때만 좌우 ±20° 랜덤 편향.
   * 같은 페그/막대에서는 라운드당 1회만 적용. */
  deflectAngleDeg: 20,       // 편향 각도
  deflectMaxOffDeg: 20,      // 법선에서 이 각도 이내면 "직각"으로 본다
  deflectMinSpeed: 0.1,      // 이보다 느리면 편향하지 않음
  /* 페그에 맞을 때마다 속도 방향을 살짝 틀어 동일 경로 반복을 줄임 */
  pegPathJitterMinDeg: 2,
  pegPathJitterMaxDeg: 3,

  /* 특수 막대 통과 시 진행 방향을 좌/우로 살짝 꺾음 */
  passNudgeMinDeg: 7,
  passNudgeMaxDeg: 11,

  /* --- 막대 --- */
  /* barLength 는 "어떤 각도 조합으로 놓아도 공이 갇히지 않는" 길이여야 한다.
   * 최악은 같은 행 인접 페그에 0°/0° 로 놓은 경우. 통과폭 = 74 - barLength - 8.
   *
   *   ~44 : 통과폭 >= 22 → 공(지름 20)이 두 막대 사이를 그대로 통과
   *   ~54 : 통과폭 < 20 이라 통과는 못 함
   *   56~ : 가로 막대로 한 행을 채우면 공이 갇힌다 (전수 검사로 확인)
   *
   * 50 은 56 대비 여유를 둔 값이다. */
  barLength: 50,
  barThickness: 8,
  angleStep: 15,        // 회전 단위(도)
  barClearance: 2,      // 겹침 판정 여유
  /* 0° 일반 막대만 — 사용자가 거의 못 보는 ±범위로 살짝 기울여 완전 수평 튕김을 피함 */
  normalFlatJitterDeg: 0.5,

  /* 워프 도착 — 막대 페그 행 기준 위·아래 최대 칸 수 */
  warpMaxRowRange: 3,

  /* --- 발사 / 종료 구역 --- */
  launchY: 60,          // 공이 생성되는 y
  launchSpeed: 1.2,     // 발사 순간의 아래 방향 속도 (천천히 출발해 서서히 가속)
  launchZoneHeight: 130,// 이 y 위쪽을 드래그하면 발사 위치 지정
  sinkY: 766,           // 이 y를 넘으면 공이 보드를 빠져나간 것으로 처리
  ballsPerRound: 1,

  /* --- 로그라이크 드래프트 ---
   * 서로 다른 3선택지. 일반만 ×2, 나머지는 1개. */
  draftOfferCount: 3,
  draftBarPool: [
    { type: 'normal', count: 2 },
    { type: 'score', count: 1 },
    { type: 'multiply', count: 1 },
    { type: 'duplicate', count: 1 },
    { type: 'warp', count: 1 },
  ],
  startingNormalBars: 3,  // 게임 시작 시 기본으로 주는 일반 막대 수

  /* --- 라운드 / 드롭 ---
   * 한 라운드 = 드롭 4회. 4회 점수 합 ≥ 목표면 다음 라운드. */
  dropsPerRound: 3,
  roundTargets: [15, 80, 242, 660, 1760, 4500, 13000, 35000, 95000, 250000],

  /* --- 추가 효과 밸런스 (소수 1자리까지) --- */
  effectBalance: {
    multiplyFactor: 2.3,          // 1: 배수 막대 (기본 2)
    passNudgeMinDeg: 3,           // 2: 통과 꺾기 완화
    passNudgeMaxDeg: 5,
    duplicateTripleChance: 0.2,   // 3: 복제 → 3개 확률
    specialLengthMult: 1.07,      // 4: 특수 막대 길이
    pegScoreMult: 1.1,            // 5: 페그 튕김 배수
    warpScoreMult: 1.5,           // 6: 워프 통과 배수
    scoreBarBase: 3,              // 7: 점수 막대 기본 / 증강 시작값
    scoreBarEscalate: 1.5,        // 7: 점수 증강 시 통과마다 가산 ×
    sinkBonusWidthFrac: 0.4,      // 8: 종료 보너스 구간 너비 비율
    sinkBonusMult: 1.5,           // 8: 보너스 구간 배수
    targetCutFrac: 0.15,          // 9: 목표 점수 감소
    normalProcChance: 0.25,       // 10: 일반 막대 확률
    normalProcMult: 1.3,          // 10: 일반 막대 발동 시 배수
    recycleUsesPerRound: 3,       // 11: 재사용 횟수/라운드
    pegBounceMult: 1.3,           // 12: 페그 강반 — 충돌 후 속력 ×
    contactScoreCooldownMs: 100,   // 페그/일반 점수 배율 최소 간격
  },

  /* --- 연출 --- */
  effectLife: 45,       // 팝업 효과 지속 프레임
};

/** 점수·목표 등 게임 수치는 항상 반올림 정수로 취급 */
function gameInt(n) {
  return Math.round(Number(n));
}

/** 막대 길이 — 막대 연장 효과 반영 */
function barLengthFor(type, game) {
  let len = CONFIG.barLength;
  if (game && game.hasEffect('long_special')) {
    len = CONFIG.barLength * CONFIG.effectBalance.specialLengthMult;
  }
  return len;
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

/** 라운드 클리어 추가 효과 (고른 뒤 영구) */
const EFFECT_TYPES = [
  {
    id: 'multiply_boost',
    label: '과충전 배수',
    desc: '배수 막대가 ×2.3으로 강화됩니다.',
  },
  {
    id: 'pass_stable',
    label: '안정 궤도',
    desc: '특수 막대 통과 시 꺾임이 3~5°로 완화됩니다.',
  },
  {
    id: 'duplicate_triple',
    label: '삼중 복제',
    desc: '복제 막대가 20% 확률로 공을 3개로 만듭니다.',
  },
  {
    id: 'long_special',
    label: '막대 연장',
    desc: '모든 막대 길이가 조금 길어집니다.',
  },
  {
    id: 'peg_score',
    label: '페그 가산',
    desc: '페그에 튕길 때 공 점수가 ×1.1이 됩니다.',
  },
  {
    id: 'peg_bounce',
    label: '강한 페그',
    desc: '페그가 공을 더 강하게 튕깁니다.',
  },
  {
    id: 'warp_mult',
    label: '워프 증폭',
    desc: '워프 통과 시 공 점수가 ×1.5가 됩니다.',
  },
  {
    id: 'score_boost',
    label: '점수 증강',
    desc: '점수 막대 가산이 3점부터 통과할 때마다 ×1.5씩 커집니다.',
  },
  {
    id: 'sink_bonus',
    label: '황금 종료',
    desc: '종료 구역 일부(약 40%)에 들어가면 점수가 ×1.5됩니다.',
  },
  {
    id: 'target_cut',
    label: '목표 완화',
    desc: '모든 라운드 목표 점수가 15% 줄어듭니다.',
  },
  {
    id: 'normal_proc',
    label: '일반의 가호',
    desc: '일반 막대에 튕길 때 25% 확률로 점수가 ×1.3이 됩니다.',
  },
  {
    id: 'bar_recycle',
    label: '재사용',
    desc: '특수 막대를 재사용 칸에 넣으면 다른 특수 막대로 바꿉니다. 라운드당 3회.',
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
