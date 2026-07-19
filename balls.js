/* =========================================================================
 * balls.js — 공 생성 / 복제 / 워프 / 점수
 *
 * 공의 내부 데이터:
 *   { id, score, hasWarped, activeSensors, isClone, isGlass, isMirror, swampDepth }
 * activeSensors 는 "현재 겹쳐 있는 특수 막대 id" 집합으로,
 * 같은 센서 안에서 효과가 여러 번 발동하는 것을 막는다.
 * 점수/배수/복제는 재진입 시 무제한. 워프는 공당 1회.
 * 불완전 워프(chaos)는 hasWarped 와 무관.
 * 스프링은 스프링당 1회 발사 후 일반 막대(워프해도 spent 유지). 워프한 공도 미사용 스프링은 발사.
 * ========================================================================= */

class BallManager {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.balls = [];
    this.nextId = 1;
  }

  /** 배수 표시용 — 불필요한  Trailing 0 제거 */
  static formatFactor(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return String(n);
    const r = Math.round(x * 100) / 100;
    if (Number.isInteger(r)) return String(r);
    return String(r);
  }

  /** 공 생성 — 기본 점수는 항상 1점 */
  createBall(x, y, opts = {}) {
    const body = Matter.Bodies.circle(x, y, CONFIG.ballRadius, {
      restitution: CONFIG.restitution,
      friction: CONFIG.friction,
      frictionStatic: CONFIG.frictionStatic,
      frictionAir: CONFIG.frictionAir,
      density: CONFIG.ballDensity,
      label: 'ball',
      sleepThreshold: Infinity,
    });

    const score = gameInt(opts.score !== undefined ? opts.score : 1);
    const ball = {
      id: this.nextId++,
      body,
      score,
      scoreFormula: opts.scoreFormula != null ? String(opts.scoreFormula) : String(score),
      // hasWarped: 워프는 공당 1회. 스프링은 lastSpringAt 쿨다운(워프해도 유지)
      hasWarped: opts.hasWarped || false,
      lastSpringAt: opts.lastSpringAt || 0,
      isClone: opts.isClone || false,
      isMirror: opts.isMirror || false,
      isGlass: opts.isGlass || false,
      swampDepth: opts.swampDepth || 0,
      activeSensors: new Set(opts.activeSensors || []),
      stuckContacts: new Set(),
      lastContactScoreAt: 0,
      lastDirX: opts.lastDirX || 0,
      stuckSince: 0,
      stuckWarned: false,
      spawnFlash: opts.spawnFlash !== undefined ? opts.spawnFlash : (CONFIG.spawnFlashMs || 200),
      preVx: 0,
      preVy: 0,
      preX: x,
      preY: y,
    };

    body.gameBall = ball;
    Matter.Composite.add(this.world, body);
    this.balls.push(ball);
    if (this.game) this.game.ballsCreated = (this.game.ballsCreated || 0) + 1;

    if (opts.velocity) Matter.Body.setVelocity(body, opts.velocity);
    return ball;
  }

  /** 워프 제외 특수 막대는 횟수 제한 없음 (겹쳐 있는 동안만 1회) */
  canUseSensor(ball, barId) {
    return true;
  }

  markSensorUse(ball, barId) {
    /* no-op — 무제한 */
  }

  /** 점수 막대: 현재 점수 + amount (결과는 반올림 정수) */
  addScore(ball, amount) {
    const gain = gameInt(amount);
    ball.score = gameInt(ball.score + gain);
    if (!ball.scoreFormula) ball.scoreFormula = String(ball.score - gain);
    ball.scoreFormula += `+${gain}`;
    this.game.addEffect(ball.body.position.x, ball.body.position.y, `+${gain}`, BAR_TYPES.score.glow);
  }

  /** 배수 막대: 현재 점수 × factor (결과는 반올림 정수) */
  multiplyScore(ball, factor) {
    ball.score = gameInt(ball.score * factor);
    const label = BallManager.formatFactor(factor);
    if (!ball.scoreFormula) ball.scoreFormula = String(ball.score);
    else ball.scoreFormula += `×${label}`;
    this.game.addEffect(ball.body.position.x, ball.body.position.y, `×${label}`, BAR_TYPES.multiply.glow);
  }

  /**
   * 복제 막대: 같은 점수의 공을 추가한다.
   * cloneCount=1 → 총 2개, cloneCount=2 → 총 3개.
   */
  duplicateBall(ball, cloneCount = 1) {
    const pos = ball.body.position;
    const vel = ball.body.velocity;
    const offset = CONFIG.ballRadius * 0.9;
    const count = Math.max(1, cloneCount);

    Matter.Body.setPosition(ball.body, { x: pos.x - offset, y: pos.y });

    const clones = [];
    for (let i = 0; i < count; i++) {
      const clone = this.createBall(
        pos.x + offset * (i + 1),
        pos.y + CONFIG.barThickness,
        {
          score: gameInt(ball.score),
          scoreFormula: ball.scoreFormula,
          hasWarped: ball.hasWarped,
          lastSpringAt: ball.lastSpringAt || 0,
          isClone: true,
          isMirror: ball.isMirror || false,
          isGlass: ball.isGlass || false,
          swampDepth: ball.swampDepth || 0,
          activeSensors: ball.activeSensors,
          lastDirX: ball.lastDirX || 0,
          velocity: { x: vel.x, y: vel.y },
        }
      );
      clones.push(clone);
    }

    this.game.addEffect(pos.x, pos.y, count >= 2 ? '◎◎◎' : '◎◎', BAR_TYPES.duplicate.glow);
    this.game.addRing(pos.x, pos.y, BAR_TYPES.duplicate.glow);
    return clones;
  }

  /**
   * 워프 막대: 같은 막대는 공 하나당 한 번만.
   * 다른 워프 막대는 다시 탈 수 있다 (사용한 막대 수만큼 워프 가능하므로 무한 반복은 없다).
   * 도착 지점에서 아래 방향으로 일정한 속도로 다시 떨어진다.
   * 워프 성공 시 hasWarped=true → 다른 특수 막대를 1회 더 쓸 수 있다.
   */
  warpBall(ball, bar) {
    if (ball.hasWarped) return false;
    if (!bar.warpSpot) {
      this.game.addEffect(
        ball.body.position.x,
        ball.body.position.y,
        '도착?',
        BAR_TYPES.warp.glow
      );
      return false;
    }

    const from = { x: ball.body.position.x, y: ball.body.position.y };
    const to = bar.warpSpot;

    Matter.Body.setPosition(ball.body, { x: to.x, y: to.y });
    Matter.Body.setVelocity(ball.body, { x: 0, y: CONFIG.warpExitSpeed });
    Matter.Body.setAngularVelocity(ball.body, 0);

    ball.hasWarped = true;
    // 특수 막대만 재통과 가능. 스프링 spent/쿨다운은 공·스프링 모두 초기화하지 않음
    // (워프한 공도 아직 안 쓴 스프링은 발사됨)
    ball.activeSensors.clear();

    this.game.addRing(from.x, from.y, BAR_TYPES.warp.glow);
    this.game.addRing(to.x, to.y, BAR_TYPES.warp.glow);
    this.game.addEffect(to.x, to.y, '↯', BAR_TYPES.warp.glow);
    return true;
  }

  /**
   * 불완전 워프 — 보드 워프 후보 중 랜덤 이동.
   * hasWarped 는 건드리지 않는다 (일반 워프와 독립).
   */
  chaosWarpBall(ball) {
    if (!ball || !ball.body) return false;
    const bars = this.game.bars.bars;
    const spots = this.game.board.warpSpots.filter((s) =>
      this.game.board.isWarpSpotFree(s, bars)
    );
    if (spots.length === 0) {
      this.game.addEffect(
        ball.body.position.x,
        ball.body.position.y,
        '↯?',
        BAR_TYPES.chaos_warp.glow
      );
      return false;
    }

    const to = spots[Math.floor(Math.random() * spots.length)];
    const from = { x: ball.body.position.x, y: ball.body.position.y };

    Matter.Body.setPosition(ball.body, { x: to.x, y: to.y });
    Matter.Body.setVelocity(ball.body, { x: 0, y: CONFIG.warpExitSpeed });
    Matter.Body.setAngularVelocity(ball.body, 0);
    ball.activeSensors.clear();

    this.game.addRing(from.x, from.y, BAR_TYPES.chaos_warp.glow);
    this.game.addRing(to.x, to.y, BAR_TYPES.chaos_warp.glow);
    this.game.addEffect(to.x, to.y, '↯?', BAR_TYPES.chaos_warp.glow);
    return true;
  }

  removeBall(ball) {
    Matter.Composite.remove(this.world, ball.body);
    this.balls = this.balls.filter((b) => b.id !== ball.id);
  }

  removeAll() {
    for (const ball of [...this.balls]) this.removeBall(ball);
  }

  /** 속도 제한 — 늪에 있으면 swampMaxSpeed, 아니면 기본 캡 */
  clampSpeeds() {
    const swampCap = CONFIG.shopBars?.swampMaxSpeed ?? 0.45;
    for (const ball of this.balls) {
      const v = ball.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      const boosted =
        ball.springBoostUntil && performance.now() < ball.springBoostUntil;
      let cap = boosted
        ? CONFIG.effectBalance.springMaxSpeed || 18
        : CONFIG.maxBallSpeed;
      if (ball.swampDepth > 0) {
        cap = Math.min(cap, swampCap);
      }
      if (speed > cap) {
        const k = cap / speed;
        Matter.Body.setVelocity(ball.body, { x: v.x * k, y: v.y * k });
      }
    }
  }

  /** 연출 타이머 (ms) — 주사율과 무관 */
  tickVisuals(dtMs) {
    for (const ball of this.balls) {
      if (ball.spawnFlash > 0) {
        ball.spawnFlash = Math.max(0, ball.spawnFlash - dtMs);
      }
    }
  }

  /** 공에 표시할 글자 크기 / 문자열 (점수가 커져도 공 밖으로 벗어나지 않게) */
  static labelFor(score) {
    if (score < 100) return { text: String(score), size: 12 };
    if (score < 1000) return { text: String(score), size: 10 };
    if (score < 10000) return { text: String(score), size: 8 };
    if (score < 1000000) return { text: Math.floor(score / 1000) + 'k', size: 8 };
    return { text: Math.floor(score / 1000000) + 'M', size: 8 };
  }
}
