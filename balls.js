/* =========================================================================
 * balls.js — 공 생성 / 복제 / 워프 / 점수
 *
 * 공의 내부 데이터:
 *   { id, score, hasWarped, activeSensors, sensorHits, isClone }
 * activeSensors 는 "현재 겹쳐 있는 특수 막대 id" 집합으로,
 * 같은 센서 안에서 효과가 여러 번 발동하는 것을 막는다.
 * sensorHits 는 워프 제외 특수 막대 통과 횟수 (기본 1회, 워프 후 2회).
 * ========================================================================= */

class BallManager {
  constructor(world, game) {
    this.world = world;
    this.game = game;
    this.balls = [];
    this.nextId = 1;
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

    const ball = {
      id: this.nextId++,
      body,
      score: gameInt(opts.score !== undefined ? opts.score : 1),
      // hasWarped: 한 번이라도 워프했는지 (표시/호환용)
      hasWarped: opts.hasWarped || false,
      // usedWarps: 이미 사용한 워프 막대 id 집합.
      // 같은 막대는 다시 탈 수 없지만, 다른 워프 막대는 다시 탈 수 있다.
      usedWarps: new Set(opts.usedWarps || []),
      isClone: opts.isClone || false,
      activeSensors: new Set(opts.activeSensors || []),
      // 워프 제외 특수 막대(+3/×2/복제) 통과 횟수. 기본 1회, 워프 후 최대 2회.
      sensorHits: opts.sensorHits instanceof Map
        ? new Map(opts.sensorHits)
        : new Map(opts.sensorHits || []),
      // 점수 증강: 이 공이 점수 막대를 통과한 횟수
      scoreBarHits: opts.scoreBarHits || 0,
      stuckContacts: new Set(),
      lastContactScoreAt: 0,
      spawnFlash: 12,
      preVx: 0,
      preVy: 0,
    };

    body.gameBall = ball;
    Matter.Composite.add(this.world, body);
    this.balls.push(ball);
    if (this.game) this.game.ballsCreated = (this.game.ballsCreated || 0) + 1;

    if (opts.velocity) Matter.Body.setVelocity(body, opts.velocity);
    return ball;
  }

  /** 워프 제외 특수 막대: 기본 1회, 워프한 공은 1회 더(최대 2회) */
  maxSensorHits(ball) {
    return ball.hasWarped ? 2 : 1;
  }

  canUseSensor(ball, barId) {
    const used = ball.sensorHits.get(barId) || 0;
    return used < this.maxSensorHits(ball);
  }

  markSensorUse(ball, barId) {
    ball.sensorHits.set(barId, (ball.sensorHits.get(barId) || 0) + 1);
  }

  /** 점수 막대: 현재 점수 + amount (결과는 반올림 정수) */
  addScore(ball, amount) {
    const gain = gameInt(amount);
    ball.score = gameInt(ball.score + gain);
    this.game.addEffect(ball.body.position.x, ball.body.position.y, `+${gain}`, BAR_TYPES.score.glow);
  }

  /** 배수 막대: 현재 점수 × factor (결과는 반올림 정수) */
  multiplyScore(ball, factor) {
    ball.score = gameInt(ball.score * factor);
    this.game.addEffect(ball.body.position.x, ball.body.position.y, `×${factor}`, BAR_TYPES.multiply.glow);
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
          hasWarped: ball.hasWarped,
          usedWarps: ball.usedWarps,
          isClone: true,
          activeSensors: ball.activeSensors,
          sensorHits: ball.sensorHits,
          scoreBarHits: ball.scoreBarHits || 0,
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
   * 도착 지점에서 아래 방향의 일정한 속도로 다시 떨어진다.
   * 워프 성공 시 hasWarped=true → 다른 특수 막대를 1회 더 쓸 수 있다.
   */
  warpBall(ball, bar) {
    if (ball.usedWarps.has(bar.id)) return false;   // 이 막대는 이미 사용함
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

    ball.usedWarps.add(bar.id);     // 이 막대는 다시 사용 불가
    ball.hasWarped = true;
    ball.activeSensors.clear();     // 새 위치에서 다시 판정

    this.game.addRing(from.x, from.y, BAR_TYPES.warp.glow);
    this.game.addRing(to.x, to.y, BAR_TYPES.warp.glow);
    this.game.addEffect(to.x, to.y, '↯', BAR_TYPES.warp.glow);
    return true;
  }

  removeBall(ball) {
    Matter.Composite.remove(this.world, ball.body);
    this.balls = this.balls.filter((b) => b.id !== ball.id);
  }

  removeAll() {
    for (const ball of [...this.balls]) this.removeBall(ball);
  }

  /** 속도 제한 — 너무 빠르게 튕겨 화면 밖으로 날아가지 않도록 */
  clampSpeeds() {
    for (const ball of this.balls) {
      const v = ball.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed > CONFIG.maxBallSpeed) {
        const k = CONFIG.maxBallSpeed / speed;
        Matter.Body.setVelocity(ball.body, { x: v.x * k, y: v.y * k });
      }
      if (ball.spawnFlash > 0) ball.spawnFlash--;
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
