/* =========================================================================
 * game.js — 게임 전체 흐름, 입력 처리, 충돌 처리
 * ========================================================================= */

class Game {
  constructor(canvas) {
    this.engine = Matter.Engine.create();
    this.engine.gravity.y = CONFIG.gravity;
    this.engine.timing.timeScale = CONFIG.timeScale;   // 전체 진행 속도
    this.world = this.engine.world;

    // Matter.js 기본값(_restingThresh=4)은 상대 속도가 작으면 반발(restitution)을
    // 아예 적용하지 않아, 느린 공이 막대/페그에 자석처럼 붙는다.
    Matter.Resolver._restingThresh = 0.001;
    Matter.Resolver._restingThreshTangent = 0.001;

    this.board = new Board(this.world);
    this.bars = new BarManager(this.world, this.board, this);
    this.balls = new BallManager(this.world, this);

    this.phase = 'draft';                   // 'draft' | 'effect' | 'fail' | 'edit' | 'run'
    this.totalScore = 0;
    this.roundScore = 0;                    // 이번 라운드 드롭 점수 합
    this.dropScore = 0;                     // 현재 드롭 점수
    this.ballsCreated = 0;                  // 이번 판에서 생성한 공 수 (복제 포함)
    this.bestBallScore = 0;                 // 단일 공 최고 점수 (종료 시 확정분)
    this.roundNumber = 1;
    this.dropIndex = 1;                     // 1 .. dropsPerRound
    this.selectedTool = 'normal';
    this.selectedBar = null;
    this.hoverPeg = null;
    this.launchX = this.board.launchSlotXs()[Math.floor(CONFIG.cols / 2)];
    this.effects = [];
    this.pendingEffects = [];               // 충돌 이벤트에서 큐에 넣고 업데이트 후 처리
    this.pendingDeflects = [];              // 직각 충돌 시 ±20° 편향
    this.pendingPegJitters = [];            // 페그 충돌 시 2~3° 경로 지터
    this.usedDeflectKeys = new Set();       // 페그/막대당 1회 (키: 'peg:id' | 'bar:id')
    this.dragging = null;
    this.invDrag = null;
    this.barDrag = null;
    this.deleteMarquee = null;              // { x0, y0, x1, y1 } 삭제 드래그 영역
    this.inventory = this.startingInventory();
    this.draftOffers = [];                  // 막대: [{type,count}, ...] / 효과: [{id,label,desc}, ...]
    this.ownedEffects = [];                 // 라운드 클리어로 고른 추가 효과
    this.sinkBonusZone = null;              // { x0, x1, mult } | null
    this.recycleUsesLeft = 0;               // 재사용 남은 횟수 (라운드당)

    this.renderer = new Renderer(canvas, this);
    this.ui = new UI(this);
    this.bindCanvas(canvas);
    this.bindInvDrag();
    this.bindCollisions();
    this.bindKeyboard();

    this.openBarDraft(
      `일반 막대 ${CONFIG.startingNormalBars}개를 받았습니다. 막대 하나를 고르세요.`
    );
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /** 인벤에 넣을 수 있는 모든 막대 키 (일반 포함) */
  allBarKeys() {
    return Object.keys(BAR_TYPES);
  }

  emptyInventory() {
    const inv = {};
    for (const key of this.allBarKeys()) inv[key] = 0;
    return inv;
  }

  /** 시작용 기본 인벤 (일반 막대 N개) */
  startingInventory() {
    const inv = this.emptyInventory();
    inv.normal = CONFIG.startingNormalBars;
    return inv;
  }

  getTargetScore() {
    const targets = CONFIG.roundTargets;
    const i = this.roundNumber - 1;
    let t;
    if (i < targets.length) {
      t = targets[i];
    } else {
      const last = targets[targets.length - 1];
      const step = last - (targets[targets.length - 2] || last * 0.7);
      t = last + step * (i - targets.length + 1);
    }
    if (this.hasEffect('target_cut')) {
      t *= 1 - CONFIG.effectBalance.targetCutFrac;
    }
    return gameInt(t);
  }

  hasEffect(id) {
    return this.ownedEffects.includes(id);
  }

  remainingEffects() {
    return EFFECT_TYPES.filter((e) => !this.ownedEffects.includes(e.id));
  }

  scoreBarAmount(ball) {
    const base = CONFIG.effectBalance.scoreBarBase || 3;
    if (!this.hasEffect('score_boost') || !ball) return base;
    const hits = ball.scoreBarHits || 0;
    const amount = base * Math.pow(CONFIG.effectBalance.scoreBarEscalate, hits);
    ball.scoreBarHits = hits + 1;
    return gameInt(amount);
  }

  multiplyFactor() {
    return this.hasEffect('multiply_boost')
      ? CONFIG.effectBalance.multiplyFactor
      : 2;
  }

  /** 드롭마다 종료 보너스 구간을 다시 뽑는다 */
  rollSinkBonusZone() {
    if (!this.hasEffect('sink_bonus')) {
      this.sinkBonusZone = null;
      return;
    }
    const left = CONFIG.wallThickness;
    const right = CONFIG.boardWidth - CONFIG.wallThickness;
    const span = right - left;
    const zoneW = span * CONFIG.effectBalance.sinkBonusWidthFrac;
    const x0 = left + Math.random() * Math.max(0, span - zoneW);
    this.sinkBonusZone = {
      x0,
      x1: x0 + zoneW,
      mult: CONFIG.effectBalance.sinkBonusMult,
    };
  }

  advanceAfterRoundClear(message) {
    this.roundNumber += 1;
    this.dropIndex = 1;
    this.roundScore = 0;
    this.dropScore = 0;
    this.resetRecycleUses();
    this.rollSinkBonusZone();
    this.phase = 'edit';
    const firstOwned = this.allBarKeys().find((k) => this.inventory[k] > 0);
    this.selectedTool = firstOwned || 'delete';
    const text =
      typeof message === 'function'
        ? message()
        : message ||
          `라운드 ${this.roundNumber} — 목표 ${this.getTargetScore()}점. 드롭 1/${CONFIG.dropsPerRound}을 준비하세요.`;
    this.ui.setMessage(text);
  }

  ballStartScore() {
    return 1;
  }

  resetRecycleUses() {
    this.recycleUsesLeft = this.hasEffect('bar_recycle')
      ? CONFIG.effectBalance.recycleUsesPerRound
      : 0;
  }

  specialBarTypes() {
    return this.allBarKeys().filter((k) => k !== 'normal');
  }

  /** 보유 특수 막대 → 다른 특수 막대로 교환 */
  tryRecycleBar(type) {
    if (!this.hasEffect('bar_recycle')) return false;
    if (type === 'normal' || type === 'delete' || !BAR_TYPES[type]) {
      this.ui.setMessage('일반 막대는 재사용할 수 없습니다. 특수 막대만 가능합니다.');
      return false;
    }
    if (this.recycleUsesLeft <= 0) {
      this.ui.setMessage('이번 라운드 재사용 횟수를 모두 썼습니다.');
      return false;
    }
    if (this.inventoryCount(type) <= 0) return false;

    const pool = this.specialBarTypes().filter((k) => k !== type);
    if (pool.length === 0) {
      this.ui.setMessage('바꿀 수 있는 다른 특수 막대가 없습니다.');
      return false;
    }

    const next = pool[Math.floor(Math.random() * pool.length)];
    this.inventory[type]--;
    this.inventory[next] = (this.inventory[next] || 0) + 1;
    this.recycleUsesLeft -= 1;
    this.selectedTool = next;
    this.ui.setMessage(
      `${BAR_TYPES[type].label} → ${BAR_TYPES[next].label} (재사용 남은 ${this.recycleUsesLeft}회)`
    );
    return true;
  }

  /** 서로 다른 선택지 3개 (일반은 ×2, 나머지는 1개) */
  generateBarDraftOffers() {
    const pool = CONFIG.draftBarPool.map((o) => ({ type: o.type, count: o.count }));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.draftOffers = pool.slice(0, CONFIG.draftOfferCount);
  }

  /** 추가 효과 선택지 — 미보유 중 서로 다른 3개 */
  generateEffectDraftOffers() {
    const pool = this.remainingEffects().slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.draftOffers = pool.slice(0, CONFIG.draftOfferCount);
  }

  openBarDraft(message) {
    this.phase = 'draft';
    this.selectedBar = null;
    this.dragging = null;
    this.generateBarDraftOffers();
    this.ui.showBarDraft(this.draftOffers);
    this.ui.setMessage(message || '막대 3개 중 하나를 고르세요.');
  }

  openEffectDraft(message) {
    this.generateEffectDraftOffers();
    if (this.draftOffers.length === 0) {
      this.advanceAfterRoundClear('모든 추가 효과를 모았습니다. 다음 라운드를 준비하세요.');
      return;
    }
    this.phase = 'effect';
    this.selectedBar = null;
    this.dragging = null;
    this.ui.showEffectDraft(this.draftOffers);
    this.ui.setMessage(message || '라운드 클리어! 추가 효과를 고르세요.');
  }

  pickBarDraft(index) {
    if (this.phase !== 'draft') return;
    const offer = this.draftOffers[index];
    if (!offer || !BAR_TYPES[offer.type]) return;

    const count = offer.count || 1;
    this.inventory[offer.type] = (this.inventory[offer.type] || 0) + count;
    this.draftOffers = [];
    this.ui.hideDraft();
    this.enterEditAfterDraft(offer.type, count);
  }

  pickEffectDraft(index) {
    if (this.phase !== 'effect') return;
    const effect = this.draftOffers[index];
    if (!effect) return;

    this.ownedEffects.push(effect.id);
    this.draftOffers = [];
    this.ui.hideDraft();

    if (effect.id === 'long_special') {
      this.bars.refreshBodies();
    }
    if (effect.id === 'sink_bonus') {
      this.rollSinkBonusZone();
    }

    this.advanceAfterRoundClear(
      () =>
        `「${effect.label}」획득. 라운드 ${this.roundNumber} — 목표 ${this.getTargetScore()}점. 드롭 1/${CONFIG.dropsPerRound}을 준비하세요.`
    );
  }

  enterEditAfterDraft(gainedType, count = 1) {
    this.phase = 'edit';
    const firstOwned = this.allBarKeys().find((k) => this.inventory[k] > 0);
    this.selectedTool = firstOwned || 'delete';
    const label = BAR_TYPES[gainedType].label;
    const gained = count > 1 ? `${label} ×${count}` : label;
    this.ui.setMessage(
      `획득: ${gained}. 드롭 ${this.dropIndex}/${CONFIG.dropsPerRound} — 목표 ${this.getTargetScore()}점.`
    );
  }

  inventoryCount(type) {
    return this.inventory[type] || 0;
  }

  tryConsume(type) {
    if (this.inventoryCount(type) <= 0) return false;
    this.inventory[type]--;
    return true;
  }

  refund(type) {
    if (!BAR_TYPES[type] || type === 'delete') return;
    this.inventory[type] = (this.inventory[type] || 0) + 1;
  }

  /* ------------------------------------------------------------------ *
   *  충돌 처리 — 센서 중복 발동 방지
   * ------------------------------------------------------------------ */
  bindCollisions() {
    Matter.Events.on(this.engine, 'collisionStart', (evt) => {
      for (const pair of evt.pairs) {
        const ballBody = pair.bodyA.gameBall ? pair.bodyA
                       : pair.bodyB.gameBall ? pair.bodyB : null;
        if (!ballBody) continue;
        const other = ballBody === pair.bodyA ? pair.bodyB : pair.bodyA;
        const ball = ballBody.gameBall;
        const bar = other.gameBar || null;

        // 특수 막대 — 관통하며 효과만 발동
        if (bar && BAR_TYPES[bar.type].sensor) {
          if (ball.activeSensors.has(bar.id)) continue;
          ball.activeSensors.add(bar.id);
          if (ball.body.velocity.y <= 0) continue;
          this.pendingEffects.push({ ballId: ball.id, barId: bar.id });
          continue;
        }

        // 페그 가산 / 일반 막대 확률 점수 (최소 0.1초 간격, 붙어 있으면 제외)
        if (other.gamePeg && this.hasEffect('peg_score')) {
          this.tryContactScoreMult(ball, `peg:${other.gamePeg.id}`, () => {
            this.balls.multiplyScore(ball, CONFIG.effectBalance.pegScoreMult);
          });
        } else if (bar && bar.type === 'normal' && this.hasEffect('normal_proc')) {
          this.tryContactScoreMult(ball, `bar:${bar.id}`, () => {
            if (Math.random() < CONFIG.effectBalance.normalProcChance) {
              this.balls.multiplyScore(ball, CONFIG.effectBalance.normalProcMult);
            }
          });
        }

        // 페그 — 경로 지터 (동일 궤도 반복 완화)
        if (other.gamePeg) {
          this.pendingPegJitters.push({ ballId: ball.id });
        }

        // 페그 또는 일반 막대 — 거의 직각 충돌이면 좌우 ±20° 편향 후보
        // collisionStart 는 속도 해석 전에 오므로, 이때의 velocity 가 입사 속도다.
        if (bar || other.gamePeg) {
          const obstacleKey = bar ? `bar:${bar.id}` : `peg:${other.gamePeg.id}`;
          if (this.usedDeflectKeys.has(obstacleKey)) continue;

          this.pendingDeflects.push({
            ballId: ball.id,
            obstacleKey,
            otherX: other.position.x,
            otherY: other.position.y,
            isPeg: !!other.gamePeg,
            barAngleDeg: bar ? this.bars.physicsAngleDeg(bar) : 0,
            preVx: ballBody.velocity.x,
            preVy: ballBody.velocity.y,
          });
        }
      }
    });

    Matter.Events.on(this.engine, 'collisionEnd', (evt) => {
      for (const pair of evt.pairs) {
        const ballBody = pair.bodyA.gameBall ? pair.bodyA
                       : pair.bodyB.gameBall ? pair.bodyB : null;
        if (!ballBody) continue;
        const other = ballBody === pair.bodyA ? pair.bodyB : pair.bodyA;
        const ball = ballBody.gameBall;
        const bar = other.gameBar || null;

        if (bar && BAR_TYPES[bar.type].sensor) {
          ball.activeSensors.delete(bar.id);
        }
        if (ball.stuckContacts) {
          if (other.gamePeg) ball.stuckContacts.delete(`peg:${other.gamePeg.id}`);
          if (bar) ball.stuckContacts.delete(`bar:${bar.id}`);
        }
      }
    });
  }

  /**
   * 페그/일반 막대 점수 배율 — 접촉이 이어지는 동안 1회만, 최소 cooldownMs 간격.
   * 막대에 붙어 있는 상태(동일 접촉 재발동)에서는 배율하지 않는다.
   */
  tryContactScoreMult(ball, contactKey, applyFn) {
    if (!ball.stuckContacts) ball.stuckContacts = new Set();
    if (ball.stuckContacts.has(contactKey)) return;
    ball.stuckContacts.add(contactKey);

    // 거의 멈춘 채 붙어 있으면 배율 없음
    const v = ball.body.velocity;
    if (Math.hypot(v.x, v.y) < CONFIG.deflectMinSpeed) return;

    const now = performance.now();
    const gap = CONFIG.effectBalance.contactScoreCooldownMs || 100;
    if (now - (ball.lastContactScoreAt || 0) < gap) return;

    applyFn();
    ball.lastContactScoreAt = now;
  }

  classifyPair(pair) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    let ballBody = null;
    let barBody = null;

    if (a.gameBall && b.gameBar) { ballBody = a; barBody = b; }
    else if (b.gameBall && a.gameBar) { ballBody = b; barBody = a; }
    else return null;

    return { ball: ballBody.gameBall, bar: barBody.gameBar };
  }

  /** 표면에서 공 쪽으로 향하는 단위 법선 */
  surfaceNormal(item, ballPos) {
    if (item.isPeg) {
      let nx = ballPos.x - item.otherX;
      let ny = ballPos.y - item.otherY;
      const len = Math.hypot(nx, ny) || 1;
      return { x: nx / len, y: ny / len };
    }
    // 막대 장축이 angleDeg 이므로 법선은 ±90°
    const rad = (item.barAngleDeg * Math.PI) / 180;
    let nx = -Math.sin(rad);
    let ny = Math.cos(rad);
    // 공 쪽을 향하는 면 선택
    const toBallX = ballPos.x - item.otherX;
    const toBallY = ballPos.y - item.otherY;
    if (nx * toBallX + ny * toBallY < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { x: nx, y: ny };
  }

  /**
   * 페그/일반 막대에 거의 직각으로 부딪힌 경우만,
   * 튕김 방향을 법선 기준 좌우 ±deflectAngleDeg 로 강제한다.
   * 같은 페그/막대는 라운드당 1회만.
   */
  processPendingDeflects() {
    if (this.pendingDeflects.length === 0) return;
    const queue = this.pendingDeflects;
    this.pendingDeflects = [];

    const cosMin = Math.cos((CONFIG.deflectMaxOffDeg * Math.PI) / 180);
    const deflectRad = (CONFIG.deflectAngleDeg * Math.PI) / 180;
    const seenBall = new Set();

    for (const item of queue) {
      if (seenBall.has(item.ballId)) continue;
      if (this.usedDeflectKeys.has(item.obstacleKey)) continue;

      const ball = this.balls.balls.find((x) => x.id === item.ballId);
      if (!ball) continue;

      const preSpeed = Math.hypot(item.preVx, item.preVy);
      if (preSpeed < CONFIG.deflectMinSpeed) continue;

      const n = this.surfaceNormal(item, ball.body.position);
      // 입사 속도가 법선과 거의 평행(=직각 충돌)할 때만
      const align = Math.abs(item.preVx * n.x + item.preVy * n.y) / preSpeed;
      if (align < cosMin) continue;

      // 튕긴 뒤 속도 크기 (너무 작으면 입사 속도 기준으로 보정)
      const cur = ball.body.velocity;
      const outSpeed = Math.max(Math.hypot(cur.x, cur.y), preSpeed * CONFIG.restitution * 0.85);
      if (outSpeed < CONFIG.deflectMinSpeed) continue;

      // 법선에서 접선 쪽으로 ±20° (왼쪽/오른쪽 랜덤)
      const sign = Math.random() < 0.5 ? -1 : 1;
      const tx = -n.y;
      const ty = n.x;
      const c = Math.cos(deflectRad);
      const s = Math.sin(deflectRad);
      const dx = n.x * c + sign * tx * s;
      const dy = n.y * c + sign * ty * s;

      Matter.Body.setVelocity(ball.body, {
        x: dx * outSpeed,
        y: dy * outSpeed,
      });

      this.usedDeflectKeys.add(item.obstacleKey);
      seenBall.add(item.ballId);
    }
  }

  /** 페그 충돌 후 속도 방향을 ±2~3° 틀어 동일 경로를 깨뜨린다 */
  processPendingPegJitters() {
    if (this.pendingPegJitters.length === 0) return;
    const queue = this.pendingPegJitters;
    this.pendingPegJitters = [];

    const seenBall = new Set();
    for (const item of queue) {
      if (seenBall.has(item.ballId)) continue;
      const ball = this.balls.balls.find((x) => x.id === item.ballId);
      if (!ball || !ball.body) continue;

      const v = ball.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed < CONFIG.deflectMinSpeed) continue;

      const sign = Math.random() < 0.5 ? -1 : 1;
      const deg =
        CONFIG.pegPathJitterMinDeg +
        Math.random() * (CONFIG.pegPathJitterMaxDeg - CONFIG.pegPathJitterMinDeg);
      const rad = (sign * deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      let nx = v.x * cos - v.y * sin;
      let ny = v.x * sin + v.y * cos;
      if (this.hasEffect('peg_bounce')) {
        const boost = CONFIG.effectBalance.pegBounceMult;
        nx *= boost;
        ny *= boost;
      }
      Matter.Body.setVelocity(ball.body, { x: nx, y: ny });
      seenBall.add(item.ballId);
    }
  }

  /** 큐에 쌓인 특수 막대 효과를 물리 업데이트 이후에 한 번씩 실행 */
  processPendingEffects() {
    if (this.pendingEffects.length === 0) return;
    const queue = this.pendingEffects;
    this.pendingEffects = [];

    for (const item of queue) {
      const ball = this.balls.balls.find((x) => x.id === item.ballId);
      const bar = this.bars.barById(item.barId);
      if (!ball || !bar) continue;

      // 워프 제외 특수 막대: 공당 1회, 워프한 공은 1회 더(최대 2회)
      if (bar.type !== 'warp') {
        if (!this.balls.canUseSensor(ball, bar.id)) continue;
        this.balls.markSensorUse(ball, bar.id);
      }

      switch (bar.type) {
        case 'score':
          this.balls.addScore(ball, this.scoreBarAmount(ball));
          break;
        case 'multiply':
          this.balls.multiplyScore(ball, this.multiplyFactor());
          break;
        case 'duplicate': {
          let clones = 1;
          if (
            this.hasEffect('duplicate_triple') &&
            Math.random() < CONFIG.effectBalance.duplicateTripleChance
          ) {
            clones = 2;
          }
          this.balls.duplicateBall(ball, clones);
          break;
        }
        case 'warp': {
          const ok = this.balls.warpBall(ball, bar);
          if (ok && this.hasEffect('warp_mult')) {
            this.balls.multiplyScore(ball, CONFIG.effectBalance.warpScoreMult);
          }
          // 워프 성공 시에는 출구 속도를 유지 (꺾기로 궤도가 깨지지 않게)
          if (!ok && BAR_TYPES[bar.type].sensor) {
            this.nudgeBallOnPass(ball);
          }
          break;
        }
        default:
          break;   // 일반 막대는 효과 없음
      }

      // 통과형(특수) 막대만 방향 꺾기 — 워프는 위에서 처리
      if (BAR_TYPES[bar.type].sensor && bar.type !== 'warp') {
        this.nudgeBallOnPass(ball);
      }
    }
  }

  /** 특수 막대 통과 시 속도 방향을 랜덤으로 꺾는다 (일반 막대 제외) */
  nudgeBallOnPass(ball) {
    if (!ball || !ball.body) return;
    const v = ball.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed < CONFIG.deflectMinSpeed) return;

    const eb = CONFIG.effectBalance;
    const minDeg = this.hasEffect('pass_stable') ? eb.passNudgeMinDeg : CONFIG.passNudgeMinDeg;
    const maxDeg = this.hasEffect('pass_stable') ? eb.passNudgeMaxDeg : CONFIG.passNudgeMaxDeg;

    const sign = Math.random() < 0.5 ? -1 : 1;
    const deg = minDeg + Math.random() * (maxDeg - minDeg);
    const rad = (sign * deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    Matter.Body.setVelocity(ball.body, {
      x: v.x * cos - v.y * sin,
      y: v.x * sin + v.y * cos,
    });
  }

  /* ------------------------------------------------------------------ *
   *  드롭 / 라운드 진행
   * ------------------------------------------------------------------ */
  startDrop() {
    if (this.phase !== 'edit') return;

    this.bars.pruneWarpTargets();
    const unset = this.bars.bars.filter((b) => b.type === 'warp' && !b.warpSpot);
    if (unset.length > 0) {
      this.ui.setMessage('도착 위치가 지정되지 않은 워프 막대가 있습니다. 통과해도 효과가 발동하지 않습니다.');
    } else {
      this.ui.setMessage(
        `드롭 ${this.dropIndex}/${CONFIG.dropsPerRound} 실행 중 — 편집이 잠겼습니다.`
      );
    }

    this.phase = 'run';
    this.selectedBar = null;
    this.hoverPeg = null;
    this.rollSinkBonusZone();
    this.dragging = null;
    this.dropScore = 0;
    this.usedDeflectKeys.clear();
    this.pendingDeflects = [];
    this.pendingPegJitters = [];
    this.snapLaunchToSlot();

    for (let i = 0; i < CONFIG.ballsPerRound; i++) {
      this.balls.createBall(this.launchX, CONFIG.launchY, {
        score: this.ballStartScore(),
        velocity: { x: 0, y: CONFIG.launchSpeed },
      });
    }
  }

  /** @deprecated 호환용 — startDrop 과 동일 */
  startRound() {
    this.startDrop();
  }

  endDrop() {
    this.roundScore += this.dropScore;
    const target = this.getTargetScore();
    const dropDone = this.dropIndex;
    const lastDrop = dropDone >= CONFIG.dropsPerRound;

    if (lastDrop) {
      if (this.roundScore >= target) {
        this.openEffectDraft(
          `드롭 ${dropDone} 종료 (+${this.dropScore}). 합계 ${this.roundScore}/${target} — 목표 달성! 추가 효과를 고르세요.`
        );
      } else {
        const failedSum = this.roundScore;
        this.openFailScreen(failedSum, target);
      }
      return;
    }

    this.dropIndex += 1;
    this.openBarDraft(
      `드롭 ${dropDone} 종료 (+${this.dropScore}점). 라운드 합계 ${this.roundScore}/${target}. 막대 하나를 고른 뒤 드롭 ${this.dropIndex}을 준비하세요.`
    );
  }

  openFailScreen(failedSum, target) {
    this.phase = 'fail';
    this.selectedBar = null;
    this.dragging = null;
    this.ui.hideDraft();
    this.ui.showFail({
      round: this.roundNumber,
      roundScore: failedSum,
      target,
      ballsCreated: this.ballsCreated,
      totalScore: this.totalScore,
      bestBallScore: this.bestBallScore,
    });
    this.ui.setMessage('게임 오버 — 처음부터 다시 시작합니다.');
  }

  confirmFailRetry() {
    if (this.phase !== 'fail') return;
    this.ui.hideFail();
    this.resetGame('처음부터 다시 시작합니다. 막대 하나를 고르세요.');
  }

  /** @deprecated */
  endRound() {
    this.endDrop();
  }

  /** 공이 보드 아래 종료 구역에 도착 */
  sinkBall(ball) {
    let gained = gameInt(ball.score);
    const zone = this.sinkBonusZone;
    if (zone) {
      const x = ball.body.position.x;
      if (x >= zone.x0 && x <= zone.x1) {
        gained = gameInt(gained * zone.mult);
        this.addEffect(
          ball.body.position.x,
          CONFIG.sinkY + 12,
          `×${zone.mult}`,
          '#c9a227'
        );
      }
    }
    this.totalScore = gameInt(this.totalScore + gained);
    this.dropScore = gameInt(this.dropScore + gained);
    if (gained > this.bestBallScore) this.bestBallScore = gained;
    this.addEffect(ball.body.position.x, CONFIG.sinkY + 12, `+${gained}`, '#2f5d8c');
    this.balls.removeBall(ball);
  }

  /** 초기화 — 모든 것을 처음 상태로 */
  resetGame(message) {
    this.balls.removeAll();
    this.bars.removeAll();
    this.board.resetPegs();
    this.totalScore = 0;
    this.roundScore = 0;
    this.dropScore = 0;
    this.ballsCreated = 0;
    this.bestBallScore = 0;
    this.roundNumber = 1;
    this.dropIndex = 1;
    this.ownedEffects = [];
    this.sinkBonusZone = null;
    this.recycleUsesLeft = 0;
    this.selectedBar = null;
    this.selectedTool = 'normal';
    this.launchX = this.board.launchSlotXs()[Math.floor(CONFIG.cols / 2)];
    this.effects = [];
    this.pendingEffects = [];
    this.pendingDeflects = [];
    this.pendingPegJitters = [];
    this.usedDeflectKeys.clear();
    this.inventory = this.startingInventory();
    this.ui.hideFail();
    this.openBarDraft(
      message ||
        `초기화됨 — 일반 막대 ${CONFIG.startingNormalBars}개. 막대 하나를 고르세요.`
    );
  }

  /** 다시 편집 — 막대·보유는 유지, 공만 치우고 자유롭게 수정 */
  backToEdit() {
    if (this.phase === 'draft' || this.phase === 'effect' || this.phase === 'fail') return;
    this.balls.removeAll();
    this.effects = [];
    this.pendingEffects = [];
    this.pendingDeflects = [];
    this.pendingPegJitters = [];
    this.usedDeflectKeys.clear();
    this.phase = 'edit';
    this.ui.hideDraft();
    this.ui.setMessage('편집 단계입니다. 배치·회전·삭제를 마음대로 수정할 수 있습니다.');
  }

  /* ------------------------------------------------------------------ *
   *  편집 조작
   * ------------------------------------------------------------------ */
  selectTool(tool) {
    if (this.phase !== 'edit') return;
    if (tool !== 'delete' && this.inventoryCount(tool) <= 0) {
      this.ui.setMessage(`${BAR_TYPES[tool].label} 이(가) 없습니다. 드래프트에서 얻으세요.`);
      return;
    }
    this.selectedTool = tool;
    // 워프가 아닌 도구로 바꾸면 워프 선택·흐린 × 즉시 해제
    if (tool !== 'warp' && this.selectedBar && this.selectedBar.type === 'warp') {
      this.selectedBar = null;
    }
    if (tool === 'delete') {
      this.ui.setMessage('삭제 도구 — 보드에서 드래그해 사각형을 만들면 안의 막대가 보관함으로 돌아갑니다.');
    } else {
      this.ui.setMessage(
        `${BAR_TYPES[tool].label} (남은 ${this.inventoryCount(tool)}개) — 보유 칸에서 페그로 드래그해 설치하세요.`
      );
    }
  }

  /** 인벤 막대를 페그에 설치/교체 */
  placeBarOnPeg(type, peg) {
    if (this.phase !== 'edit') return false;
    if (!peg || !BAR_TYPES[type] || type === 'delete') return false;

    const existing = this.bars.barAtPeg(peg.id);
    if (existing && existing.type === type) {
      this.selectedBar = existing;
      this.selectedTool = type;
      this.ui.setMessage(`${BAR_TYPES[type].label} 선택 — Q/E, 휠, 드래그로 회전할 수 있습니다.`);
      return true;
    }

    if (!this.tryConsume(type)) {
      this.ui.setMessage(`${BAR_TYPES[type].label} 이(가) 없습니다.`);
      return false;
    }

    if (existing) {
      const prev = existing.type;
      this.bars.changeBarType(existing, type);
      this.refund(prev);
      this.selectedBar = existing;
      this.selectedTool = type;
      this.ui.setMessage(`${BAR_TYPES[type].label} 로 교체했습니다.`);
    } else {
      const created = this.bars.createBar(peg, type);
      if (!created) {
        this.refund(type);
        this.ui.setMessage('이 위치에는 막대를 설치할 수 없습니다.');
        return false;
      }
      this.selectedBar = created;
      this.selectedTool = type;
      this.ui.setMessage(
        `${BAR_TYPES[type].label} 설치 (남은 ${this.inventoryCount(type)}개)`
      );
    }

    // 해당 종류를 다 써도 삭제 도구로 넘어가지 않음.
    // 다른 보유 막대가 있으면 그쪽으로만 바꾸고, 없으면 빈 상태로 유지.
    if (this.inventoryCount(type) <= 0) {
      const next = this.allBarKeys().find((k) => this.inventoryCount(k) > 0);
      if (next) this.selectedTool = next;
    }
    return true;
  }

  beginInvDrag(type, clientX, clientY) {
    if (this.phase !== 'edit' || type === 'delete') return;
    if (this.inventoryCount(type) <= 0) return;
    this.selectedTool = type;
    if (type !== 'warp') this.selectedBar = null;
    this.invDrag = {
      type,
      startX: clientX,
      startY: clientY,
      moved: false,
    };
    this.ui.showInvGhost(type, clientX, clientY);
    this.ui.setMessage(`${BAR_TYPES[type].label} — 페그 위에 놓으세요.`);
  }

  moveInvDrag(clientX, clientY) {
    if (!this.invDrag) return;
    const dx = clientX - this.invDrag.startX;
    const dy = clientY - this.invDrag.startY;
    if (Math.hypot(dx, dy) > 6) this.invDrag.moved = true;

    this.ui.moveInvGhost(clientX, clientY);

    const overRecycle = this.ui.isOverRecycle(clientX, clientY);
    this.ui.setRecycleHot(overRecycle && this.invDrag.type !== 'normal');

    const canvas = this.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const over =
      !overRecycle &&
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (over) {
      const x = ((clientX - rect.left) / rect.width) * CONFIG.boardWidth;
      const y = ((clientY - rect.top) / rect.height) * CONFIG.boardHeight;
      this.hoverPeg = this.board.pegSlotAt(x, y);
    } else {
      this.hoverPeg = null;
    }
  }

  endInvDrag(clientX, clientY) {
    if (!this.invDrag) return;
    const { type, moved } = this.invDrag;
    this.invDrag = null;
    this.ui.hideInvGhost();
    this.ui.setRecycleHot(false);

    if (!moved) {
      this.selectTool(type);
      this.hoverPeg = null;
      return;
    }

    if (this.ui.isOverRecycle(clientX, clientY)) {
      this.tryRecycleBar(type);
      this.hoverPeg = null;
      return;
    }

    const canvas = this.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const over =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (over) {
      const x = ((clientX - rect.left) / rect.width) * CONFIG.boardWidth;
      const y = ((clientY - rect.top) / rect.height) * CONFIG.boardHeight;
      const peg = this.board.pegSlotAt(x, y, 18);
      if (peg) {
        this.placeBarOnPeg(type, peg);
        this.hoverPeg = null;
        return;
      }
    }

    this.hoverPeg = null;
    this.selectedTool = type;
    this.ui.setMessage('페그 위에 놓아야 설치됩니다.');
  }

  /** 삭제 마퀴 사각형 안의 막대를 모두 보관함으로 */
  refundBarsInMarquee() {
    const m = this.deleteMarquee;
    if (!m) return 0;
    const left = Math.min(m.x0, m.x1);
    const right = Math.max(m.x0, m.x1);
    const top = Math.min(m.y0, m.y1);
    const bottom = Math.max(m.y0, m.y1);
    if (right - left < 4 || bottom - top < 4) return 0;

    const hit = this.bars.bars.filter(
      (b) => b.x >= left && b.x <= right && b.y >= top && b.y <= bottom
    );
    for (const bar of [...hit]) {
      this.refund(bar.type);
      if (this.selectedBar && this.selectedBar.id === bar.id) this.selectedBar = null;
      this.bars.removeBar(bar);
    }
    return hit.length;
  }

  rotateSelected(delta) {
    if (this.phase !== 'edit' || !this.selectedBar) return;
    const ok = this.bars.rotateBar(this.selectedBar, delta);
    if (!ok) {
      this.ui.setMessage('그 각도로는 설치할 수 없습니다 (겹침 또는 보드 밖). 이전 각도로 되돌렸습니다.');
    }
  }

  handleClick(x, y) {
    if (this.phase !== 'edit') return;

    // 1) 워프 도착 지점 지정 — 선택된 워프 막대, 또는 도착 미지정 워프
    const warpTarget =
      this.selectedBar && this.selectedBar.type === 'warp'
        ? this.selectedBar
        : this.bars.bars.find((b) => b.type === 'warp' && !b.warpSpot) || null;

    if (warpTarget || this.selectedTool === 'warp') {
      const bar =
        warpTarget ||
        this.bars.bars.filter((b) => b.type === 'warp').slice(-1)[0] ||
        null;
      const spot = this.board.warpSpotAt(x, y, 18, bar);
      if (spot && bar) {
        if (
          this.board.isWarpSpotReachable(bar, spot) &&
          this.board.isWarpSpotFree(spot, this.bars.bars, bar.id)
        ) {
          bar.warpSpot = {
            id: spot.id,
            x: spot.x,
            y: spot.y,
            gapRow: spot.gapRow,
          };
          this.selectedBar = bar;
          this.ui.setMessage('워프 도착 위치를 지정했습니다.');
          return;
        }
        if (!this.board.isWarpSpotReachable(bar, spot)) {
          this.ui.setMessage('워프는 위·아래 3칸 이내로만 이동할 수 있습니다.');
          return;
        }
        this.ui.setMessage('그 위치는 페그/일반 막대와 겹쳐 도착지로 쓸 수 없습니다.');
        return;
      }
    }

    // 2) 설치된 막대 클릭 → 선택만 (삭제는 삭제 도구 영역 드래그)
    const bar = this.bars.barAt(x, y);
    if (bar) {
      this.selectedBar = bar;
      this.selectedTool = bar.type;
      this.ui.setMessage(
        `${BAR_TYPES[bar.type].label} 선택 — Q/E·휠로 회전, 드래그로 이동. 삭제는 삭제 도구를 쓰세요.`
      );
      return;
    }

    // 3) 빈 공간/페그 클릭 — 설치는 드래그만, 선택·흐린 × 해제
    this.selectedBar = null;
    const peg = this.board.pegAt(x, y);
    if (peg) {
      this.ui.setMessage('막대는 보유 칸에서 페그로 드래그해야 설치됩니다.');
    }
  }

  beginBarRelocate(bar, clientX, clientY) {
    if (this.phase !== 'edit' || !bar) return;
    this.selectedBar = bar;
    this.selectedTool = bar.type;
    this.barDrag = {
      bar,
      startX: clientX,
      startY: clientY,
      moved: false,
      fromPegId: bar.pegId,
    };
  }

  moveBarRelocate(clientX, clientY) {
    if (!this.barDrag) return;
    const dx = clientX - this.barDrag.startX;
    const dy = clientY - this.barDrag.startY;
    if (Math.hypot(dx, dy) > 8) {
      if (!this.barDrag.moved) {
        this.barDrag.moved = true;
        this.bars.liftForDrag(this.barDrag.bar);
        this.ui.showInvGhost(
          this.barDrag.bar.type,
          clientX,
          clientY,
          this.barDrag.bar.angleDeg
        );
        this.ui.setMessage('다른 페그 위에 놓으세요. (막대가 있으면 서로 바꿉니다)');
      }
      this.ui.moveInvGhost(clientX, clientY, this.barDrag.bar.angleDeg);
    }

    const canvas = this.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const over =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;
    if (over) {
      const x = ((clientX - rect.left) / rect.width) * CONFIG.boardWidth;
      const y = ((clientY - rect.top) / rect.height) * CONFIG.boardHeight;
      this.hoverPeg = this.board.pegSlotAt(x, y);
    } else {
      this.hoverPeg = null;
    }
  }

  endBarRelocate(clientX, clientY) {
    if (!this.barDrag) return;
    const { bar, moved, fromPegId } = this.barDrag;
    this.barDrag = null;
    this.ui.hideInvGhost();
    this.hoverPeg = null;

    if (!moved) {
      // 짧은 클릭 = 선택만 (삭제는 삭제 도구로)
      this.selectedBar = bar;
      this.selectedTool = bar.type;
      this.ui.setMessage(
        `${BAR_TYPES[bar.type].label} 선택 — Q/E·휠로 회전, 드래그로 이동. 삭제는 삭제 도구를 쓰세요.`
      );
      return;
    }

    const canvas = this.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const over =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (over) {
      const x = ((clientX - rect.left) / rect.width) * CONFIG.boardWidth;
      const y = ((clientY - rect.top) / rect.height) * CONFIG.boardHeight;
      const peg = this.board.pegSlotAt(x, y, 20);
      if (peg) {
        const swapped = this.bars.barAtPeg(peg.id) && peg.id !== fromPegId;
        if (this.bars.moveBarToPeg(bar, peg)) {
          bar.dragging = false;
          this.selectedBar = bar;
          this.ui.setMessage(
            swapped
              ? `${BAR_TYPES[bar.type].label} 자리를 바꿨습니다.`
              : `${BAR_TYPES[bar.type].label} 을(를) 옮겼습니다.`
          );
          return;
        }
      }
    }

    // 실패/취소 — 원래 자리에 막대·페그 상태 복구
    this.bars.restoreAfterDragCancel(bar);
    this.ui.setMessage('페그 위에 놓아야 옮길 수 있습니다.');
  }

  setLaunchFromX(x) {
    const min = CONFIG.wallThickness + CONFIG.ballRadius + 2;
    const max = CONFIG.boardWidth - CONFIG.wallThickness - CONFIG.ballRadius - 2;
    const next = Math.max(min, Math.min(max, x));
    if (Math.abs(next - this.launchX) < 0.05) return false;
    this.launchX = next;
    return true;
  }

  snapLaunchToSlot() {
    this.launchX = this.board.nearestLaunchSlot(this.launchX);
  }

  announceLaunchSlot() {
    const slot = this.board.launchSlotIndex(this.launchX) + 1;
    this.ui.setMessage(`낙하 위치 ${slot}/${CONFIG.cols} (맨 위 페그 바로 위)`);
  }

  /* ------------------------------------------------------------------ *
   *  입력 바인딩
   * ------------------------------------------------------------------ */
  bindCanvas(canvas) {
    const toBoard = (evt) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((evt.clientX - rect.left) / rect.width) * CONFIG.boardWidth,
        y: ((evt.clientY - rect.top) / rect.height) * CONFIG.boardHeight,
      };
    };

    canvas.addEventListener('mousedown', (evt) => {
      if (evt.button !== 0) return;
      if (this.phase !== 'edit') return;
      const p = toBoard(evt);
      this.pressPoint = p;

      // 삭제 도구: 보드에서 사각형 드래그
      if (this.selectedTool === 'delete') {
        this.dragging = { kind: 'marquee', moved: false };
        this.deleteMarquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
        return;
      }

      // 상단 낙하 구역: 좌우 드래그로 7슬롯 중 선택 (클릭만으로는 안 바뀜)
      if (p.y < CONFIG.launchZoneHeight) {
        this.dragging = { kind: 'launch', moved: false };
        return;
      }

      // 배치된 막대: 드래그로 다른 페그로 이동
      const bar = this.bars.barAt(p.x, p.y);
      if (bar) {
        this.pressPoint = null;
        this.beginBarRelocate(bar, evt.clientX, evt.clientY);
        return;
      }
    });

    canvas.addEventListener('mousemove', (evt) => {
      const p = toBoard(evt);

      if (this.phase === 'edit' && !this.barDrag && !this.invDrag) {
        this.hoverPeg = this.board.pegAt(p.x, p.y);
      } else if (this.phase !== 'edit') {
        this.hoverPeg = null;
      }

      if (!this.dragging) return;

      if (this.dragging.kind === 'marquee' && this.deleteMarquee) {
        this.deleteMarquee.x1 = p.x;
        this.deleteMarquee.y1 = p.y;
        if (this.pressPoint) {
          const d = Math.hypot(p.x - this.pressPoint.x, p.y - this.pressPoint.y);
          if (d > 6) this.dragging.moved = true;
        }
        return;
      }

      if (this.dragging.kind === 'launch') {
        const movedFar = Math.hypot(p.x - this.pressPoint.x, p.y - this.pressPoint.y) > 4;
        if (!movedFar && !this.dragging.moved) return;
        this.dragging.moved = true;
        this.setLaunchFromX(p.x);
        return;
      }
    });

    const endDrag = (evt) => {
      if (this.barDrag || this.invDrag) return;

      const drag = this.dragging;
      this.dragging = null;

      if (drag && drag.kind === 'marquee') {
        if (drag.moved) {
          const n = this.refundBarsInMarquee();
          this.ui.setMessage(
            n > 0
              ? `선택한 영역에서 막대 ${n}개를 보관함으로 되돌렸습니다.`
              : '선택한 영역 안에 막대가 없습니다.'
          );
        } else if (this.pressPoint) {
          const p = toBoard(evt);
          if (Math.hypot(p.x - this.pressPoint.x, p.y - this.pressPoint.y) < 6) {
            this.handleClick(p.x, p.y);
          }
        }
        this.deleteMarquee = null;
        this.pressPoint = null;
        return;
      }

      if (drag && drag.kind === 'launch') {
        if (drag.moved) {
          this.snapLaunchToSlot();
          this.announceLaunchSlot();
        }
        this.pressPoint = null;
        return;
      }

      const wasDrag = drag && drag.moved;
      if (wasDrag) {
        this.pressPoint = null;
        return;
      }
      if (!this.pressPoint) return;

      const p = toBoard(evt);
      if (Math.hypot(p.x - this.pressPoint.x, p.y - this.pressPoint.y) < 6) {
        this.handleClick(p.x, p.y);
      }
      this.pressPoint = null;
    };

    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => {
      if (this.dragging && this.dragging.kind === 'launch') {
        this.dragging = null;
      }
      if (this.dragging && this.dragging.kind === 'marquee') {
        this.dragging = null;
        this.deleteMarquee = null;
      }
      if (!this.barDrag && !this.invDrag) this.hoverPeg = null;
    });

    canvas.addEventListener('wheel', (evt) => {
      if (this.phase !== 'edit' || !this.selectedBar) return;
      evt.preventDefault();
      this.rotateSelected(evt.deltaY > 0 ? CONFIG.angleStep : -CONFIG.angleStep);
    }, { passive: false });

    canvas.addEventListener('contextmenu', (evt) => evt.preventDefault());
  }

  bindInvDrag() {
    window.addEventListener('pointermove', (evt) => {
      if (this.invDrag) this.moveInvDrag(evt.clientX, evt.clientY);
      else if (this.barDrag) this.moveBarRelocate(evt.clientX, evt.clientY);
    });

    window.addEventListener('pointerup', (evt) => {
      if (this.invDrag) this.endInvDrag(evt.clientX, evt.clientY);
      else if (this.barDrag) this.endBarRelocate(evt.clientX, evt.clientY);
    });

    window.addEventListener('pointercancel', () => {
      if (this.invDrag) {
        this.invDrag = null;
        this.hoverPeg = null;
        this.ui.hideInvGhost();
      }
      if (this.barDrag) {
        if (this.barDrag.moved) this.bars.restoreAfterDragCancel(this.barDrag.bar);
        else this.barDrag.bar.dragging = false;
        this.barDrag = null;
        this.hoverPeg = null;
        this.ui.hideInvGhost();
      }
    });
  }

  bindKeyboard() {
    window.addEventListener('keydown', (evt) => {
      const k = evt.key.toLowerCase();

      // 편집 중: Enter / Space 로 게임 시작
      if (this.phase === 'edit' && (k === 'enter' || k === ' ')) {
        evt.preventDefault();
        this.startDrop();
        return;
      }

      if (this.phase !== 'edit') return;

      if (k === 'q') this.rotateSelected(-CONFIG.angleStep);
      else if (k === 'e') this.rotateSelected(CONFIG.angleStep);
      else if (k === 'escape') this.selectedBar = null;
      else if ((k === 'delete' || k === 'backspace') && this.selectedBar) {
        evt.preventDefault();
        const removedType = this.selectedBar.type;
        this.refund(removedType);
        this.bars.removeBar(this.selectedBar);
        this.selectedBar = null;
        this.ui.setMessage(`${BAR_TYPES[removedType].label} 제거 — 보유로 돌아왔습니다.`);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  연출
   * ------------------------------------------------------------------ */
  addEffect(x, y, text, color) {
    this.effects.push({ kind: 'text', x, y, text, color, life: CONFIG.effectLife, maxLife: CONFIG.effectLife });
  }

  addRing(x, y, color) {
    this.effects.push({ kind: 'ring', x, y, color, life: 28, maxLife: 28 });
  }

  tickEffects() {
    for (const fx of this.effects) fx.life--;
    this.effects = this.effects.filter((fx) => fx.life > 0);
  }

  /* ------------------------------------------------------------------ *
   *  메인 루프
   * ------------------------------------------------------------------ */
  loop() {
    if (this.phase === 'run') {
      // 충돌 판정용 — 이번 프레임 물리 업데이트 직전 속도
      for (const ball of this.balls.balls) {
        ball.preVx = ball.body.velocity.x;
        ball.preVy = ball.body.velocity.y;
      }

      Matter.Engine.update(this.engine, 1000 / 60);
      this.processPendingEffects();
      this.processPendingDeflects();
      this.processPendingPegJitters();
      this.balls.clampSpeeds();

      // 종료 구역 도착 판정
      for (const ball of [...this.balls.balls]) {
        const p = ball.body.position;
        if (p.y > CONFIG.sinkY) {
          this.sinkBall(ball);
        } else if (p.y > CONFIG.boardHeight + 200 || p.x < -100 || p.x > CONFIG.boardWidth + 100) {
          this.balls.removeBall(ball);   // 안전장치: 보드를 완전히 이탈한 공
        }
      }

      if (this.balls.balls.length === 0) {
        this.endDrop();
      }
    }

    this.bars.tick();
    this.tickEffects();
    this.renderer.draw();
    this.ui.refresh();
    requestAnimationFrame(this.loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (typeof Matter === 'undefined') {
    document.getElementById('message').textContent =
      'Matter.js 를 불러오지 못했습니다. vendor/matter.min.js 파일이 있는지 확인하세요.';
    return;
  }
  window.game = new Game(document.getElementById('board'));
});
