/* =========================================================================
 * bars.js — 막대 생성 / 회전 / 삭제 / 겹침 검사
 *
 * 막대는 반드시 원래 페그가 있던 좌표를 중심으로 배치된다.
 * 막대를 설치하면 그 자리의 원형 페그는 물리 세계에서 완전히 제거된다.
 * ========================================================================= */

class BarManager {
  constructor(world, board, game = null) {
    this.world = world;
    this.board = board;
    this.game = game;
    this.bars = [];      // { id, pegId, x, y, type, angleDeg, body, warpSpot, invalidFlash }
    this.nextId = 1;
  }

  lengthOf(barOrType) {
    const type = typeof barOrType === 'string' ? barOrType : barOrType.type;
    return barLengthFor(type, this.game);
  }

  /** 페그 자리에 막대를 설치한다. 이미 막대가 있으면 종류만 교체한다. */
  createBar(peg, typeKey) {
    const existing = this.barAtPeg(peg.id);
    if (existing) {
      // 같은 위치에는 막대 하나만 — 각도를 유지한 채 종류를 교체한다.
      return this.changeBarType(existing, typeKey);
    }

    const bar = {
      id: this.nextId++,
      pegId: peg.id,
      x: peg.x,
      y: peg.y,
      type: typeKey,
      angleDeg: 0,
      body: null,
      warpSpot: null,
      invalidFlash: 0,
    };

    // 기본 각도(0°)가 설치 불가능한 자리(예: 벽에 가까운 바깥쪽 열)라면
    // 설치 가능한 각도를 찾아 그 각도로 놓는다. 세로(90°)를 우선한다.
    const preferred = [0, 90, 75, 105, 60, 120, 45, 135, 30, 150, 15, 165];
    const usable = preferred.find((deg) => this.isPlacementValid(bar, deg));
    if (usable === undefined) return null;
    bar.angleDeg = usable;

    this.board.removePegBody(peg);   // 원형 페그 완전 제거
    peg.occupiedBy = bar.id;
    bar.body = this.makeBarBody(bar);
    Matter.Composite.add(this.world, bar.body);
    this.bars.push(bar);
    return bar;
  }

  changeBarType(bar, typeKey) {
    if (bar.type === typeKey) return bar;
    bar.type = typeKey;
    if (typeKey !== 'warp') bar.warpSpot = null;
    Matter.Composite.remove(this.world, bar.body);
    bar.body = this.makeBarBody(bar);
    Matter.Composite.add(this.world, bar.body);
    return bar;
  }

  makeBarBody(bar) {
    const def = BAR_TYPES[bar.type];
    bar.length = this.lengthOf(bar);
    this.rollMicroTilt(bar);
    const body = Matter.Bodies.rectangle(
      bar.x, bar.y, bar.length, CONFIG.barThickness,
      {
        isStatic: true,
        isSensor: def.sensor,          // 특수 막대는 관통형
        restitution: CONFIG.restitution,
        friction: CONFIG.friction,
        frictionStatic: CONFIG.frictionStatic,
        angle: (this.physicsAngleDeg(bar) * Math.PI) / 180,
        label: 'bar',
      }
    );
    body.gameBar = bar;
    return body;
  }

  /** 0° 일반 막대만 ±normalFlatJitterDeg 랜덤 기울기 */
  rollMicroTilt(bar) {
    if (bar.type === 'normal' && bar.angleDeg === 0) {
      const mag = CONFIG.normalFlatJitterDeg;
      bar.microTiltDeg = (Math.random() * 2 - 1) * mag;
    } else {
      bar.microTiltDeg = 0;
    }
  }

  physicsAngleDeg(bar) {
    return bar.angleDeg + (bar.microTiltDeg || 0);
  }

  /** 길이 효과 등으로 물리 바디를 다시 만든다 */
  refreshBodies() {
    for (const bar of this.bars) {
      if (!bar.body) continue;
      Matter.Composite.remove(this.world, bar.body);
      bar.body = this.makeBarBody(bar);
      Matter.Composite.add(this.world, bar.body);
    }
  }

  barAtPeg(pegId) {
    return this.bars.find((b) => b.pegId === pegId) || null;
  }

  barById(id) {
    return this.bars.find((b) => b.id === id) || null;
  }

  /** 막대를 다른 페그 자리로 이동. 대상에 막대가 있으면 서로 자리를 바꾼다. */
  moveBarToPeg(bar, peg) {
    if (!bar || !peg) return false;
    if (bar.pegId === peg.id) return true;

    const other = this.barAtPeg(peg.id);
    if (other) {
      // 드래그 중 원위치에 페그를 다시 켜 둔 상태일 수 있음 → 스왑 전에 숨김
      const oldPeg = this.board.pegs.find((p) => p.id === bar.pegId);
      if (oldPeg && oldPeg.body) {
        this.board.removePegBody(oldPeg);
        oldPeg.occupiedBy = bar.id;
      }
      bar.dragging = false;
      return this.swapBars(bar, other);
    }

    const oldPeg = this.board.pegs.find((p) => p.id === bar.pegId);
    const saved = {
      x: bar.x,
      y: bar.y,
      pegId: bar.pegId,
      angleDeg: bar.angleDeg,
    };

    bar.x = peg.x;
    bar.y = peg.y;
    bar.pegId = peg.id;

    if (!this.isPlacementValid(bar, bar.angleDeg)) {
      const preferred = [
        bar.angleDeg, 0, 90, 75, 105, 60, 120, 45, 135, 30, 150, 15, 165,
      ];
      const usable = preferred.find((deg) => this.isPlacementValid(bar, deg));
      if (usable === undefined) {
        bar.x = saved.x;
        bar.y = saved.y;
        bar.pegId = saved.pegId;
        bar.angleDeg = saved.angleDeg;
        return false;
      }
      bar.angleDeg = usable;
    }

    if (oldPeg) this.board.restorePeg(oldPeg);
    this.board.removePegBody(peg);
    peg.occupiedBy = bar.id;
    bar.dragging = false;

    if (bar.body) Matter.Composite.remove(this.world, bar.body);
    bar.body = this.makeBarBody(bar);
    Matter.Composite.add(this.world, bar.body);
    this.pruneWarpTargets();
    return true;
  }

  /** 두 막대의 자리를 교환 */
  swapBars(a, b) {
    if (!a || !b || a.id === b.id) return false;

    const pegA = this.board.pegs.find((p) => p.id === a.pegId);
    const pegB = this.board.pegs.find((p) => p.id === b.pegId);
    if (!pegA || !pegB) return false;

    const saveA = { x: a.x, y: a.y, pegId: a.pegId, angleDeg: a.angleDeg };
    const saveB = { x: b.x, y: b.y, pegId: b.pegId, angleDeg: b.angleDeg };

    a.x = saveB.x;
    a.y = saveB.y;
    a.pegId = saveB.pegId;
    b.x = saveA.x;
    b.y = saveA.y;
    b.pegId = saveA.pegId;

    const pickAngle = (bar, preferredFirst) => {
      const preferred = [
        preferredFirst, 0, 90, 75, 105, 60, 120, 45, 135, 30, 150, 15, 165,
      ];
      return preferred.find((deg) => this.isPlacementValid(bar, deg));
    };

    const angA = pickAngle(a, saveA.angleDeg);
    const angB = pickAngle(b, saveB.angleDeg);
    if (angA === undefined || angB === undefined) {
      a.x = saveA.x;
      a.y = saveA.y;
      a.pegId = saveA.pegId;
      a.angleDeg = saveA.angleDeg;
      b.x = saveB.x;
      b.y = saveB.y;
      b.pegId = saveB.pegId;
      b.angleDeg = saveB.angleDeg;
      return false;
    }
    a.angleDeg = angA;
    b.angleDeg = angB;

    pegA.occupiedBy = b.id;
    pegB.occupiedBy = a.id;

    if (a.body) Matter.Composite.remove(this.world, a.body);
    if (b.body) Matter.Composite.remove(this.world, b.body);
    a.body = this.makeBarBody(a);
    b.body = this.makeBarBody(b);
    Matter.Composite.add(this.world, a.body);
    Matter.Composite.add(this.world, b.body);
    this.pruneWarpTargets();
    return true;
  }

  /** 클릭 좌표에 있는 막대 찾기 */
  barAt(x, y) {
    const reach = CONFIG.barThickness / 2 + 7;
    let best = null;
    let bestDist = Infinity;
    for (const bar of this.bars) {
      const [a, b] = barEndpoints(bar.x, bar.y, bar.angleDeg, this.lengthOf(bar));
      const d = Geom.pointSegDist(x, y, a.x, a.y, b.x, b.y);
      if (d < reach && d < bestDist) {
        best = bar;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * 회전 시도. 설치할 수 없는 각도면 false 를 반환하고 이전 각도를 유지한다.
   * (호출한 쪽에서 붉게 표시한다)
   */
  rotateBar(bar, deltaDeg) {
    return this.setBarAngle(bar, bar.angleDeg + deltaDeg);
  }

  setBarAngle(bar, rawDeg) {
    const snapped = Geom.snapAngle(rawDeg);
    if (snapped === bar.angleDeg) return true;

    if (!this.isPlacementValid(bar, snapped)) {
      bar.invalidFlash = 24;          // 붉게 깜빡이고 이전 각도로 되돌린다
      return false;
    }

    bar.angleDeg = snapped;
    Matter.Body.setAngle(bar.body, (snapped * Math.PI) / 180);
    return true;
  }

  /** 막대를 제거하고 원형 페그를 복구한다 */
  removeBar(bar) {
    if (bar.body) Matter.Composite.remove(this.world, bar.body);
    this.bars = this.bars.filter((b) => b.id !== bar.id);
    const peg = this.board.pegs.find((p) => p.id === bar.pegId);
    if (peg) this.board.restorePeg(peg);
  }

  /** 이동 드래그 시작: 페그를 다시 보이게 하고 물리 몸체는 잠시 뺌 */
  liftForDrag(bar) {
    bar.dragging = true;
    if (bar.body) {
      Matter.Composite.remove(this.world, bar.body);
      bar.body = null;
    }
    const peg = this.board.pegs.find((p) => p.id === bar.pegId);
    if (peg) this.board.restorePeg(peg);
  }

  /** 이동 취소: 페그를 다시 숨기고 막대 몸체 복구 */
  restoreAfterDragCancel(bar) {
    bar.dragging = false;
    const peg = this.board.pegs.find((p) => p.id === bar.pegId);
    if (peg) {
      this.board.removePegBody(peg);
      peg.occupiedBy = bar.id;
    }
    if (!bar.body) {
      bar.body = this.makeBarBody(bar);
      Matter.Composite.add(this.world, bar.body);
    }
  }

  removeAll() {
    for (const bar of [...this.bars]) this.removeBar(bar);
  }

  /**
   * 겹침 방지 검사.
   *  - 보드 벽 밖으로 나가지 않는가
   *  - 다른 원형 페그와 심하게 겹치지 않는가
   *  - 다른 막대(적어도 한쪽이 물리 충돌체)와 겹치지 않는가
   */
  isPlacementValid(bar, angleDeg) {
    const [a, b] = barEndpoints(bar.x, bar.y, angleDeg, this.lengthOf(bar));
    const halfT = CONFIG.barThickness / 2;
    const clear = CONFIG.barClearance;

    // 보드 위/아래 경계
    if (Math.min(a.y, b.y) < halfT || Math.max(a.y, b.y) > CONFIG.sinkY - halfT) return false;

    // 벽과의 간격 — 공이 들어갈 수 없는 좁은 주머니를 만들면 안 된다.
    // (막대가 벽에 가까우면 그 사이에 공이 끼어 라운드가 끝나지 않는다)
    const ballGap = CONFIG.ballRadius * 2 + clear * 2;
    const leftGap = Math.min(a.x, b.x) - halfT - CONFIG.wallThickness;
    const rightGap = CONFIG.boardWidth - CONFIG.wallThickness - Math.max(a.x, b.x) - halfT;
    if (leftGap < ballGap || rightGap < ballGap) return false;

    // 남아 있는 원형 페그와의 겹침
    const pegNeed = CONFIG.pegRadius + halfT + clear;
    for (const peg of this.board.pegs) {
      if (!peg.body) continue;              // 이미 막대로 교체된 자리는 검사 제외
      if (peg.id === bar.pegId) continue;   // 자기 자신의 자리
      if (Geom.pointSegDist(peg.x, peg.y, a.x, a.y, b.x, b.y) < pegNeed) return false;
    }

    // 다른 막대와의 겹침 — 물리 충돌체가 끼는 문제를 막기 위한 검사
    const barNeed = CONFIG.barThickness + clear;
    const thisPhysical = BAR_TYPES[bar.type].sensor === false;
    for (const other of this.bars) {
      if (other.id === bar.id) continue;
      const otherPhysical = BAR_TYPES[other.type].sensor === false;
      if (!thisPhysical && !otherPhysical) continue;  // 관통형끼리는 겹쳐도 무해
      const [c, d] = barEndpoints(other.x, other.y, other.angleDeg, this.lengthOf(other));
      if (Geom.segSegDist(a, b, c, d) < barNeed) return false;
    }

    return true;
  }

  /** 유효하지 않은 워프 목적지가 남아 있으면 정리한다 */
  pruneWarpTargets() {
    for (const bar of this.bars) {
      if (bar.type !== 'warp' || !bar.warpSpot) continue;
      const spot = bar.warpSpot;
      const ok =
        this.board.isWarpSpotReachable(bar, spot) &&
        this.board.isWarpSpotFree(spot, this.bars, bar.id);
      if (!ok) bar.warpSpot = null;
    }
  }

  tick() {
    for (const bar of this.bars) {
      if (bar.invalidFlash > 0) bar.invalidFlash--;
    }
  }
}
