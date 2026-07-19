/* =========================================================================
 * board.js — 페그 배열, 벽, 워프 도착 후보 지점
 * ========================================================================= */

class Board {
  constructor(world) {
    this.world = world;
    this.pegs = [];          // { id, x, y, row, col, body, occupiedBy }
    this.warpSpots = [];     // { id, x, y }  페그와 페그 사이의 유효한 빈 공간
    this.walls = [];
    this.createWalls();
    this.createPegs();
    this.createWarpSpots();
  }

  createWalls() {
    const W = CONFIG.boardWidth;
    const H = CONFIG.boardHeight;
    const t = CONFIG.wallThickness;
    const opts = {
      isStatic: true,
      restitution: 0.2,
      friction: CONFIG.friction,
      frictionStatic: CONFIG.frictionStatic,
      label: 'wall',
    };

    this.walls = [
      Matter.Bodies.rectangle(t / 2, H / 2, t, H * 2, opts),        // 왼쪽 벽
      Matter.Bodies.rectangle(W - t / 2, H / 2, t, H * 2, opts),    // 오른쪽 벽
    ];
    Matter.Composite.add(this.world, this.walls);
  }

  /** 좌우로 엇갈린 형태의 페그 배열 생성 */
  createPegs() {
    let id = 0;
    for (let row = 0; row < CONFIG.rows; row++) {
      const isOdd = row % 2 === 1;
      const count = isOdd ? CONFIG.cols - 1 : CONFIG.cols;
      const startX = isOdd ? CONFIG.oddRowStartX : CONFIG.evenRowStartX;
      const y = CONFIG.firstRowY + row * CONFIG.rowSpacing;

      for (let col = 0; col < count; col++) {
        const x = startX + col * CONFIG.colSpacing;
        const peg = { id: id++, x, y, row, col, body: null, occupiedBy: null };
        peg.body = this.makePegBody(peg);
        this.pegs.push(peg);
        Matter.Composite.add(this.world, peg.body);
      }
    }
  }

  makePegBody(peg) {
    const body = Matter.Bodies.circle(peg.x, peg.y, CONFIG.pegRadius, {
      isStatic: true,
      restitution: CONFIG.restitution,
      friction: CONFIG.friction,
      frictionStatic: CONFIG.frictionStatic,
      label: 'peg',
    });
    body.gamePeg = peg;
    return body;
  }

  /** 맨 위 행(7개) 페그의 x — 공 낙하 후보 위치 */
  launchSlotXs() {
    return this.pegs
      .filter((p) => p.row === 0)
      .sort((a, b) => a.col - b.col)
      .map((p) => p.x);
  }

  /** 클릭 x에 가장 가까운 낙하 슬롯 x */
  nearestLaunchSlot(x) {
    const xs = this.launchSlotXs();
    let best = xs[0];
    let bestD = Infinity;
    for (const sx of xs) {
      const d = Math.abs(sx - x);
      if (d < bestD) {
        bestD = d;
        best = sx;
      }
    }
    return best;
  }

  launchSlotIndex(x) {
    return this.launchSlotXs().indexOf(x);
  }

  /** 페그와 페그 사이의 빈 공간(워프 도착 후보) 계산 */
  createWarpSpots() {
    let id = 0;
    for (let row = 0; row < CONFIG.rows - 1; row++) {
      const isOdd = row % 2 === 1;
      const count = isOdd ? CONFIG.cols - 1 : CONFIG.cols;
      const startX = isOdd ? CONFIG.oddRowStartX : CONFIG.evenRowStartX;
      const y = CONFIG.firstRowY + row * CONFIG.rowSpacing + CONFIG.rowSpacing / 2;

      // 같은 행의 인접한 두 페그 사이 중앙 → 위/아래 페그와 충분히 떨어진 지점
      for (let col = 0; col < count - 1; col++) {
        const x = startX + col * CONFIG.colSpacing + CONFIG.colSpacing / 2;
        this.warpSpots.push({ id: id++, x, y, gapRow: row });
      }
    }
  }

  /** 페그를 물리 세계에서 제거 (막대로 교체할 때) */
  removePegBody(peg) {
    if (peg.body) {
      Matter.Composite.remove(this.world, peg.body);
      peg.body = null;
    }
  }

  /** 원형 페그 복구 */
  restorePeg(peg) {
    if (!peg.body) {
      peg.body = this.makePegBody(peg);
      Matter.Composite.add(this.world, peg.body);
    }
    peg.occupiedBy = null;
  }

  /** 현재 실제로 존재하는(막대로 교체되지 않은) 페그 목록 */
  activePegs() {
    return this.pegs.filter((p) => p.body !== null);
  }

  /** 좌표에서 가장 가까운 페그를 찾는다 (클릭 판정용) */
  pegAt(x, y, tolerance = 12) {
    let best = null;
    let bestDist = Infinity;
    for (const peg of this.pegs) {
      if (!peg.body) continue;
      const d = Math.hypot(peg.x - x, peg.y - y);
      if (d < CONFIG.pegRadius + tolerance && d < bestDist) {
        best = peg;
        bestDist = d;
      }
    }
    return best;
  }

  /** 막대가 올라간 자리 포함 — 드래그 설치/교체용 */
  pegSlotAt(x, y, tolerance = 16) {
    let best = null;
    let bestDist = Infinity;
    for (const peg of this.pegs) {
      const d = Math.hypot(peg.x - x, peg.y - y);
      if (d < CONFIG.pegRadius + tolerance && d < bestDist) {
        best = peg;
        bestDist = d;
      }
    }
    return best;
  }

  /** 워프 막대에서 위·아래 warpMaxRowRange 칸 이내인지 (unlimited 시 거리 무시) */
  isWarpSpotReachable(bar, spot, unlimited = false) {
    if (!bar || !spot) return false;
    if (unlimited) return true;
    const peg = this.pegs.find((p) => p.id === bar.pegId);
    const range = CONFIG.warpMaxRowRange;
    if (peg) {
      const spotCenterRow = (spot.gapRow != null ? spot.gapRow : 0) + 0.5;
      return Math.abs(peg.row - spotCenterRow) <= range;
    }
    return Math.abs(bar.y - spot.y) <= CONFIG.rowSpacing * range;
  }

  /** 워프 도착 지점 중 클릭된 것 (bar가 있으면 도달 가능 범위만) */
  warpSpotAt(x, y, tolerance = 14, bar = null, unlimited = false) {
    let best = null;
    let bestDist = Infinity;
    for (const spot of this.warpSpots) {
      if (bar && !this.isWarpSpotReachable(bar, spot, unlimited)) continue;
      const d = Math.hypot(spot.x - x, spot.y - y);
      if (d < tolerance && d < bestDist) {
        best = spot;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * 워프 도착 지점이 실제로 비어 있는지 확인한다.
   * 페그·일반(물리) 막대와 겹치면 사용할 수 없다.
   * 관통형 특수 막대는 공이 지나가므로 방해로 보지 않는다.
   * @param {number|null} ignoreBarId 자기 워프 막대 id (자기 몸통과의 겹침 무시)
   */
  isWarpSpotFree(spot, bars, ignoreBarId = null) {
    const need = CONFIG.ballRadius + CONFIG.pegRadius + 4;
    for (const peg of this.pegs) {
      if (!peg.body) continue;
      if (Math.hypot(peg.x - spot.x, peg.y - spot.y) < need) return false;
    }
    const barNeed = CONFIG.ballRadius + CONFIG.barThickness / 2 + 4;
    for (const bar of bars) {
      if (ignoreBarId != null && bar.id === ignoreBarId) continue;
      if (BAR_TYPES[bar.type] && BAR_TYPES[bar.type].sensor) continue;
      const [a, b] = barEndpoints(bar.x, bar.y, bar.angleDeg, bar.length || CONFIG.barLength);
      if (Geom.pointSegDist(spot.x, spot.y, a.x, a.y, b.x, b.y) < barNeed) return false;
    }
    return true;
  }

  /** 전체 초기화 — 모든 페그를 원래대로 되돌린다 */
  resetPegs() {
    for (const peg of this.pegs) {
      this.restorePeg(peg);
    }
  }
}

/** 막대 중심/각도로부터 양 끝점 좌표를 구한다 */
function barEndpoints(cx, cy, angleDeg, length = CONFIG.barLength) {
  const half = length / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  return [
    { x: cx - dx, y: cy - dy },
    { x: cx + dx, y: cy + dy },
  ];
}
