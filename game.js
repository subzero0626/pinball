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
    this.selectedSpring = null;
    this.springs = [];                      // 유물 스프링 { id, x, y, angleDeg, body }
    this.nextSpringId = 1;
    this.pendingSpringBoosts = [];
    this.hoverPeg = null;
    this.launchX = this.board.launchSlotXs()[Math.floor(CONFIG.cols / 2)];
    this.effects = [];
    this.pendingEffects = [];               // 충돌 이벤트에서 큐에 넣고 업데이트 후 처리
    this.pendingDeflects = [];              // 직각 충돌 시 ±20° 편향
    this.pendingFlatRolls = [];             // 0° 일반 막대 안착 시 이전 방향으로 굴림
    this.pendingPegJitters = [];            // 페그 충돌 시 2~3° 경로 지터
    this.usedDeflectKeys = new Set();       // 페그/막대당 1회 (키: 'peg:id' | 'bar:id')
    this.dragging = null;
    this.invDrag = null;
    this.barDrag = null;
    this.deleteMarquee = null;              // { x0, y0, x1, y1 } 삭제 드래그 영역
    this.inventory = this.startingInventory();
    this.draftOffers = [];                  // 막대: [{type,count}, ...] / 효과: [{id,label,desc}, ...]
    this.ownedEffects = [];                 // 라운드 클리어로 고른 유물
    this.sharedScoreBarHits = 0;            // 점수 나선 유물 — 드롭 내 모든 점수 막대·공 공유
    this.sinkBonusZone = null;              // { x0, x1, mult } | null
    this.recycleUsesLeft = 0;               // 재사용 남은 횟수 (라운드당)

    // 상점 / 골드 / 페그 잠금
    this.gold = 0;
    this.shopOffers = [];
    this.shopRerollCost = CONFIG.shop.rerollStartCost;
    this.relicPriceMap = {};
    this.barPriceMap = {};
    this.growthMult = null;                 // 성장 막대 — 첫 구매 시 0.7
    this.lockedPegIds = new Set();
    this.amplifyHitIds = new Set();         // 드롭 내 증폭 막대 1회 기록
    this.hoverBar = null;
    this.hoverBall = null;
    this.paused = false;

    this.renderer = new Renderer(canvas, this);
    this.ui = new UI(this);
    this.bindCanvas(canvas);
    this.bindInvDrag();
    this.bindCollisions();
    this.bindKeyboard();

    this._prevNow = null;
    this._physAcc = 0;

    this.refreshShopOffers();
    this.openBarDraft(
      `일반 막대 ${CONFIG.startingNormalBars}개를 받았습니다. 막대 하나를 고르세요.`
    );
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /** 인벤에 넣을 수 있는 막대 키 (상점 전용 제외) */
  allBarKeys() {
    return Object.keys(BAR_TYPES).filter((k) => !BAR_TYPES[k].shopOnly);
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
    if (!this.hasEffect('score_boost')) return base;
    const hits = this.sharedScoreBarHits || 0;
    const amount = base * Math.pow(CONFIG.effectBalance.scoreBarEscalate, hits);
    this.sharedScoreBarHits = hits + 1;
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
    let score = 1;
    if (this.hasEffect('risky_start')) {
      score += CONFIG.effectBalance.startScoreFlat || 4;
    }
    return score;
  }

  isMirrorDropActive() {
    if (!this.hasEffect('mirror_drop')) return false;
    const center = Math.floor(CONFIG.cols / 2);
    return this.board.launchSlotIndex(this.launchX) !== center;
  }

  mirrorLaunchX(x) {
    return CONFIG.boardWidth - x;
  }

  togglePause() {
    if (this.phase !== 'run') return;
    this.paused = !this.paused;
    this.ui.setMessage(this.paused ? '일시정지' : '재개');
  }

  resetRecycleUses() {
    this.recycleUsesLeft = this.hasEffect('bar_recycle')
      ? CONFIG.effectBalance.recycleUsesPerRound
      : 0;
  }

  specialBarTypes() {
    return this.allBarKeys().filter((k) => k !== 'normal' && !BAR_TYPES[k].shopOnly);
  }

  isPegLocked(peg) {
    if (!peg) return false;
    return this.lockedPegIds.has(peg.id);
  }

  lockRandomPeg() {
    const candidates = this.board.pegs.filter(
      (p) => !this.lockedPegIds.has(p.id) && !this.bars.barAtPeg(p.id)
    );
    if (candidates.length === 0) return null;
    const peg = candidates[Math.floor(Math.random() * candidates.length)];
    this.lockedPegIds.add(peg.id);
    return peg;
  }

  /* ------------------------------------------------------------------ *
   *  상점
   * ------------------------------------------------------------------ */
  getRelicPrice(id) {
    if (this.relicPriceMap[id] == null) {
      this.relicPriceMap[id] = pickWeightedPrice(CONFIG.shop.relicPriceWeights);
    }
    return this.relicPriceMap[id];
  }

  getShopBarPrice(type) {
    if (this.barPriceMap[type] == null) {
      this.barPriceMap[type] = pickWeightedPrice(CONFIG.shop.barPriceWeights);
    }
    return this.barPriceMap[type];
  }

  refreshShopOffers() {
    const count = CONFIG.shop.offerCount || 3;
    const chance = CONFIG.shop.barOfferChance ?? 0.22;
    const offers = [];
    const usedRelics = new Set();
    for (let i = 0; i < count; i++) {
      const remaining = this.remainingEffects().filter(
        (e) => !usedRelics.has(e.id)
      );
      let kind =
        Math.random() < chance || remaining.length === 0 ? 'bar' : 'relic';
      if (kind === 'bar' && (!SHOP_BAR_TYPES || SHOP_BAR_TYPES.length === 0)) {
        kind = 'relic';
      }
      if (kind === 'relic' && remaining.length === 0) {
        if (SHOP_BAR_TYPES && SHOP_BAR_TYPES.length > 0) kind = 'bar';
        else {
          offers.push(null);
          continue;
        }
      }

      if (kind === 'bar') {
        const type =
          SHOP_BAR_TYPES[Math.floor(Math.random() * SHOP_BAR_TYPES.length)];
        const def = BAR_TYPES[type];
        offers.push({
          kind: 'bar',
          type,
          label: def.label,
          desc: (typeof BAR_TIPS !== 'undefined' && BAR_TIPS[type]) || '',
          color: def.color,
          price: this.getShopBarPrice(type),
        });
      } else {
        const effect = remaining[Math.floor(Math.random() * remaining.length)];
        usedRelics.add(effect.id);
        offers.push({
          kind: 'relic',
          id: effect.id,
          label: effect.label,
          desc: effect.desc || '',
          icon: effect.icon,
          price: this.getRelicPrice(effect.id),
        });
      }
    }
    this.shopOffers = offers;
    if (this.ui) this.ui.renderShop();
  }

  tryShopReroll() {
    if (this.phase === 'run' || this.phase === 'fail') return false;
    if (this.gold < this.shopRerollCost) {
      this.ui.setMessage(`리롤에 ${this.shopRerollCost}G가 필요합니다.`);
      return false;
    }
    this.gold -= this.shopRerollCost;
    this.shopRerollCost += 1;
    this.refreshShopOffers();
    this.ui.refresh();
    this.ui.setMessage(`상점 리롤 (−${this.shopRerollCost - 1}G).`);
    return true;
  }

  buyShopOffer(index) {
    if (this.phase === 'run' || this.phase === 'fail') return false;
    const offer = this.shopOffers[index];
    if (!offer) return false;
    if (offer.kind === 'bar') return this.buyShopBar(index);
    return this.buyShopRelic(index);
  }

  buyShopRelic(index) {
    const offer = this.shopOffers[index];
    if (!offer || offer.kind !== 'relic') return false;
    if (this.ownedEffects.includes(offer.id)) {
      this.ui.setMessage('이미 보유한 유물입니다.');
      return false;
    }
    if (this.gold < offer.price) {
      this.ui.setMessage(`골드가 부족합니다 (${offer.price}G).`);
      return false;
    }
    const def = EFFECT_TYPES.find((e) => e.id === offer.id);
    if (!def) return false;

    this.gold -= offer.price;
    this.shopOffers[index] = null;
    this.grantEffect(def);
    this.ui.refresh();
    this.ui.setMessage(`「${def.label}」구매 (−${offer.price}G).`);
    return true;
  }

  buyShopBar(index) {
    const offer = this.shopOffers[index];
    if (!offer || offer.kind !== 'bar') return false;
    if (this.gold < offer.price) {
      this.ui.setMessage(`골드가 부족합니다 (${offer.price}G).`);
      return false;
    }
    const peg = this.pickRandomEmptyPegForBar();
    if (!peg) {
      this.ui.setMessage('빈 페그가 없어 상점 막대를 배치할 수 없습니다.');
      return false;
    }

    this.gold -= offer.price;
    const created = this.bars.createBar(peg, offer.type);
    if (!created) {
      this.gold += offer.price;
      this.ui.setMessage('이 위치에는 막대를 설치할 수 없습니다.');
      return false;
    }

    if (offer.type === 'growth' && this.growthMult == null) {
      this.growthMult = CONFIG.shopBars.growthStart ?? 0.7;
    }

    this.shopOffers[index] = null;
    this.selectedBar = created;
    this.ui.refresh();
    this.ui.setMessage(
      `${BAR_TYPES[offer.type].label} 구매 · 보드에 배치 (−${offer.price}G).`
    );
    return true;
  }

  pickRandomEmptyPegForBar() {
    const candidates = this.board.pegs.filter(
      (p) =>
        p.body &&
        !p.occupiedBy &&
        !this.bars.barAtPeg(p.id) &&
        !this.isPegLocked(p)
    );
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  grantEffect(effect) {
    if (!effect || !effect.id) return false;
    if (this.ownedEffects.includes(effect.id)) return false;
    this.ownedEffects.push(effect.id);
    if (effect.id === 'map_spring') this.spawnMapSpring();
    if (effect.id === 'sink_bonus') this.rollSinkBonusZone();
    this.ui.renderRelicTray();
    return true;
  }

  onRoundCleared() {
    this.gold += CONFIG.shop.roundGold || 12;
    this.shopRerollCost = CONFIG.shop.rerollStartCost;
    this.refreshShopOffers();
    this.lockRandomPeg();
  }

  sellPriceFor(type) {
    if (type === 'normal') return CONFIG.shop.sellNormal ?? 1;
    return CONFIG.shop.sellSpecial ?? 2;
  }

  trySellInventory(type) {
    if (!BAR_TYPES[type] || type === 'delete' || BAR_TYPES[type].shopOnly) {
      return false;
    }
    if (!this.tryConsume(type)) return false;
    const gain = this.sellPriceFor(type);
    this.gold += gain;
    this.ui.setMessage(`${BAR_TYPES[type].label} 판매 (+${gain}G).`);
    return true;
  }

  trySellBar(bar) {
    if (!bar) return false;
    if (BAR_TYPES[bar.type]?.shopOnly) {
      this.ui.setMessage('상점 막대는 영구 설치라 판매할 수 없습니다.');
      return false;
    }
    const gain = this.sellPriceFor(bar.type);
    if (this.selectedBar && this.selectedBar.id === bar.id) this.selectedBar = null;
    this.bars.removeBar(bar);
    this.gold += gain;
    this.ui.setMessage(`${BAR_TYPES[bar.type].label} 판매 (+${gain}G).`);
    return true;
  }

  /** 보드에서 막대 제거 → 보관함. 상점 막대는 불가 */
  removeBarFromBoard(bar) {
    if (!bar) return { ok: false };
    if (BAR_TYPES[bar.type]?.shopOnly) {
      return { ok: false, permanent: true };
    }
    this.refund(bar.type);
    if (this.selectedBar && this.selectedBar.id === bar.id) this.selectedBar = null;
    this.bars.removeBar(bar);
    return { ok: true };
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

  /** 유물 선택지 — 미보유 중 서로 다른 3개 */
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
    this.selectedSpring = null;
    this.dragging = null;
    this.generateBarDraftOffers();
    this.ui.showBarDraft(this.draftOffers);
    this.ui.setMessage(message || '막대 3개 중 하나를 고르세요.');
  }

  openEffectDraft(message) {
    this.onRoundCleared();
    this.ui.hideDraft();
    this.advanceAfterRoundClear(
      message ||
        (() =>
          `라운드 클리어! +${CONFIG.shop.roundGold}G. 라운드 ${this.roundNumber} — 목표 ${this.getTargetScore()}점. 상점에서 준비하세요.`)
    );
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

    this.draftOffers = [];
    this.ui.hideDraft();
    this.grantEffect(effect);

    this.advanceAfterRoundClear(
      () =>
        `「${effect.label}」획득. 라운드 ${this.roundNumber} — 목표 ${this.getTargetScore()}점. 드롭 1/${CONFIG.dropsPerRound}을 준비하세요.`
    );
  }

  /* ------------------------------------------------------------------ *
   *  맵 스프링 (유물)
   * ------------------------------------------------------------------ */
  clearSprings() {
    for (const s of this.springs) {
      if (s.body) Matter.Composite.remove(this.world, s.body);
    }
    this.springs = [];
    this.selectedSpring = null;
    this.pendingSpringBoosts = [];
  }

  /** 가운데 쪽으로 치우친 랜덤 좌표 (설명에는 안 씀) */
  pickSpringSpawnPos() {
    const half = CONFIG.barLength / 2;
    const margin = CONFIG.wallThickness + half + 8;
    const y0 = CONFIG.launchZoneHeight + half + 10;
    const y1 = CONFIG.sinkY - half - 20;
    const cx = CONFIG.boardWidth / 2;
    const cy = (y0 + y1) / 2;

    for (let attempt = 0; attempt < 60; attempt++) {
      const ux = (Math.random() + Math.random() + Math.random() + Math.random()) / 4;
      const uy = (Math.random() + Math.random() + Math.random() + Math.random()) / 4;
      const x = margin + ux * (CONFIG.boardWidth - margin * 2);
      const y = y0 + uy * (y1 - y0);

      const dist = Math.hypot(x - cx, y - cy);
      const maxDist = Math.hypot(CONFIG.boardWidth / 2, (y1 - y0) / 2);
      const centerWeight = 1 - dist / maxDist;
      if (Math.random() > 0.35 + centerWeight * 0.65) continue;

      if (this.isSpringPosClear(x, y, half + 6)) return { x, y };
    }
    return { x: cx, y: cy };
  }

  isSpringPosClear(x, y, need) {
    for (const peg of this.board.pegs) {
      if (!peg.body) continue;
      if (Math.hypot(peg.x - x, peg.y - y) < need + CONFIG.pegRadius) return false;
    }
    for (const bar of this.bars.bars) {
      const [a, b] = barEndpoints(bar.x, bar.y, bar.angleDeg, this.bars.lengthOf(bar));
      if (Geom.pointSegDist(x, y, a.x, a.y, b.x, b.y) < need + CONFIG.barThickness / 2) {
        return false;
      }
    }
    for (const s of this.springs) {
      if (Math.hypot(s.x - x, s.y - y) < need * 2) return false;
    }
    return true;
  }

  spawnMapSpring() {
    const pos = this.pickSpringSpawnPos();
    const spring = {
      id: this.nextSpringId++,
      x: pos.x,
      y: pos.y,
      angleDeg: 270, // 기본: 위쪽 (y↓ 좌표)
      body: null,
    };
    spring.body = this.makeSpringBody(spring);
    Matter.Composite.add(this.world, spring.body);
    this.springs.push(spring);
    this.selectedSpring = spring;
    this.selectedBar = null;
    this.ui.setMessage('도약 태엽 — 스프링이 맵에 생겼습니다. Q/E로 방향을 바꾸세요.');
    return spring;
  }

  makeSpringBody(spring) {
    const L = CONFIG.barLength;
    const T = CONFIG.barThickness;
    // 막대 장축은 발사 방향에 수직 — 처음부터 고체(통과 불가)
    const barAngle = ((spring.angleDeg + 90) * Math.PI) / 180;
    const body = Matter.Bodies.rectangle(spring.x, spring.y, L, T, {
      isStatic: true,
      isSensor: false,
      restitution: CONFIG.restitution,
      friction: CONFIG.friction,
      frictionStatic: CONFIG.frictionStatic,
      angle: barAngle,
      label: 'spring',
    });
    body.gameSpring = spring;
    return body;
  }

  /** 스프링 막대 물리 각도(도) — 장축 기준, 일반 막대와 동일 좌표계 */
  springBarAngleDeg(spring) {
    let a = spring.angleDeg + 90;
    a = ((a % 180) + 180) % 180;
    return a;
  }

  springAt(x, y) {
    const reach = CONFIG.barThickness / 2 + 7;
    const L = CONFIG.barLength;
    let best = null;
    let bestD = Infinity;
    for (const s of this.springs) {
      const barAngle = s.angleDeg + 90;
      const [a, b] = barEndpoints(s.x, s.y, barAngle, L);
      const d = Geom.pointSegDist(x, y, a.x, a.y, b.x, b.y);
      if (d < reach && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  rotateSpring(spring, deltaDeg) {
    if (!spring) return;
    const step = CONFIG.effectBalance.springAngleStep || CONFIG.angleStep;
    let snapped = Math.round((spring.angleDeg + deltaDeg) / step) * step;
    snapped = ((snapped % 360) + 360) % 360;
    spring.angleDeg = snapped;
    if (spring.body) {
      Matter.Body.setAngle(spring.body, ((spring.angleDeg + 90) * Math.PI) / 180);
    }
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
        const spring = other.gameSpring || null;

        // 맵 스프링 — 고체 막대. 공마다 1회 발사, 이후 그 공에게는 일반 막대
        if (spring) {
          if (!ball.usedSpringIds?.has(spring.id)) {
            this.pendingSpringBoosts.push({
              ballId: ball.id,
              springId: spring.id,
              preVx: ballBody.velocity.x,
              preVy: ballBody.velocity.y,
              angleDeg: spring.angleDeg,
            });
            continue;
          }

          const obstacleKey = `spring:${spring.id}`;
          if (this.hasEffect('normal_proc')) {
            this.tryContactScoreMult(ball, obstacleKey, () => {
              if (Math.random() < CONFIG.effectBalance.normalProcChance) {
                this.balls.multiplyScore(ball, CONFIG.effectBalance.normalProcMult);
              }
            });
          }
          if (!this.usedDeflectKeys.has(obstacleKey)) {
            this.pendingDeflects.push({
              ballId: ball.id,
              obstacleKey,
              otherX: other.position.x,
              otherY: other.position.y,
              isPeg: false,
              barAngleDeg: this.springBarAngleDeg(spring),
              preVx: ballBody.velocity.x,
              preVy: ballBody.velocity.y,
            });
          }
          if (this.springBarAngleDeg(spring) === 0) {
            const preferX =
              Math.abs(ballBody.velocity.x) > CONFIG.lastDirMinSpeed
                ? ballBody.velocity.x
                : (ball.lastDirX || 0);
            this.pendingFlatRolls.push({ ballId: ball.id, preferX });
          }
          continue;
        }

        // 특수 막대 — 관통하며 효과만 발동
        // 공이 이전 프레임에 막대보다 완전히 위에 있었고, 아래로 떨어질 때만
        if (bar && BAR_TYPES[bar.type].sensor) {
          if (ball.activeSensors.has(bar.id)) continue;
          const fallVy = ball.preVy != null ? ball.preVy : ballBody.velocity.y;
          if (fallVy <= 0) continue;
          if (!this.ballWasFullyAboveBar(ball, bar)) continue;
          ball.activeSensors.add(bar.id);
          this.pendingEffects.push({ ballId: ball.id, barId: bar.id });
          continue;
        }

        // 페그 가산 / 일반·중력 막대 점수 (최소 0.1초 간격, 붙어 있으면 제외)
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
        } else if (bar && bar.type === 'gravity') {
          this.tryContactScoreMult(ball, `bar:${bar.id}`, () => {
            this.balls.addScore(ball, CONFIG.shopBars.gravityScore ?? 4);
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
          if (!this.usedDeflectKeys.has(obstacleKey)) {
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

        // 0° 일반·중력 막대에 안착하면 이전 가로 힘 방향으로 굴림
        if (
          bar &&
          (bar.type === 'normal' || bar.type === 'gravity') &&
          bar.angleDeg === 0
        ) {
          const preferX =
            Math.abs(ballBody.velocity.x) > CONFIG.lastDirMinSpeed
              ? ballBody.velocity.x
              : (ball.lastDirX || 0);
          this.pendingFlatRolls.push({ ballId: ball.id, preferX });
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
        const spring = other.gameSpring || null;

        if (bar && BAR_TYPES[bar.type].sensor) {
          ball.activeSensors.delete(bar.id);
          // 늪 — 벗어나면 속도 복구
          if (bar.type === 'swamp' && ball.swampDepth > 0) {
            ball.swampDepth -= 1;
            if (ball.swampDepth <= 0) {
              ball.swampDepth = 0;
              const v = ballBody.velocity;
              const speed = Math.hypot(v.x, v.y) || 1;
              const exit = CONFIG.shopBars.swampExitSpeed ?? 2.2;
              Matter.Body.setVelocity(ballBody, {
                x: (v.x / speed) * exit,
                y: (v.y / speed) * exit,
              });
            }
          }
        }
        if (ball.stuckContacts) {
          if (other.gamePeg) ball.stuckContacts.delete(`peg:${other.gamePeg.id}`);
          if (bar) ball.stuckContacts.delete(`bar:${bar.id}`);
          if (spring) ball.stuckContacts.delete(`spring:${spring.id}`);
        }
      }
    });
  }

  /**
   * 특수 막대 발동 조건 — 직전 위치에서 공이 대체로 막대 위에 있었는지
   * (완전히 100%는 아니어도 sensorAboveSlack 만큼은 봐줌)
   */
  ballWasFullyAboveBar(ball, bar) {
    if (!ball || !bar) return false;
    const py = ball.preY != null ? ball.preY : ball.body.position.y;
    const ballBottom = py + CONFIG.ballRadius;
    const slack = CONFIG.sensorAboveSlack ?? CONFIG.ballRadius * 0.55;
    return ballBottom <= this.barWorldTopY(bar) + slack;
  }

  /** 막대 사각형의 월드 좌표 상단(가장 작은 y) */
  barWorldTopY(bar) {
    const len = this.bars.lengthOf(bar);
    const ang = (this.bars.physicsAngleDeg(bar) * Math.PI) / 180;
    const hw = len / 2;
    const hh = CONFIG.barThickness / 2;
    const extY = hw * Math.abs(Math.sin(ang)) + hh * Math.abs(Math.cos(ang));
    return bar.y - extY;
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
   * 일반 막대: 입사·이전 가로 힘 방향. 페그: 좌우 랜덤.
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

      const tx = -n.y;
      const ty = n.x;
      let sign;
      if (item.isPeg) {
        sign = Math.random() < 0.5 ? -1 : 1;
      } else {
        let along = item.preVx * tx + item.preVy * ty;
        if (Math.abs(along) < CONFIG.lastDirMinSpeed) {
          const preferX =
            Math.abs(item.preVx) >= CONFIG.lastDirMinSpeed
              ? item.preVx
              : (ball.lastDirX || 0);
          along = preferX * tx;
        }
        sign = along >= 0 ? 1 : -1;
        if (Math.abs(along) < 1e-9) sign = 1;
        const worldDX = sign * tx;
        if (Math.abs(worldDX) > 0.01) ball.lastDirX = Math.sign(worldDX);
        else if (Math.abs(item.preVx) >= CONFIG.lastDirMinSpeed) {
          ball.lastDirX = Math.sign(item.preVx);
        }
      }

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

  /** 0° 일자 일반 막대에 거의 멈춘 공을 이전 힘 방향으로 굴린다 */
  processPendingFlatRolls() {
    if (this.pendingFlatRolls.length === 0) return;
    const queue = this.pendingFlatRolls;
    this.pendingFlatRolls = [];
    const seen = new Set();

    for (const item of queue) {
      if (seen.has(item.ballId)) continue;
      seen.add(item.ballId);
      const ball = this.balls.balls.find((x) => x.id === item.ballId);
      if (!ball || !ball.body) continue;

      const v = ball.body.velocity;
      const dir =
        Math.sign(item.preferX) ||
        Math.sign(ball.lastDirX) ||
        1;
      ball.lastDirX = dir;

      // 가로로 거의 멈춘 안착만 — 이미 빠르게 튕기는 경우는 건드리지 않음
      if (Math.abs(v.x) >= CONFIG.flatRollMinSpeed) continue;

      Matter.Body.setVelocity(ball.body, {
        x: dir * CONFIG.flatRollMinSpeed,
        y: v.y,
      });
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
    const sb = CONFIG.shopBars || {};

    for (const item of queue) {
      const ball = this.balls.balls.find((x) => x.id === item.ballId);
      const bar = this.bars.barById(item.barId);
      if (!ball || !bar) continue;

      // 워프 제외 특수 막대: 빠져나갔다 다시 들어오면 무제한 발동
      // (겹쳐 있는 동안은 activeSensors로 1회만)

      let skipNudge = false;

      switch (bar.type) {
        case 'score': {
          let amount = this.scoreBarAmount(ball);
          if (ball.isMirror) amount = gameInt(amount * 0.5) || 1;
          this.balls.addScore(ball, amount);
          break;
        }
        case 'multiply': {
          const factor = ball.isMirror
            ? CONFIG.effectBalance.mirrorMultiplyFactor
            : this.multiplyFactor();
          this.balls.multiplyScore(ball, factor);
          break;
        }
        case 'duplicate': {
          if (ball.isMirror) {
            if (Math.random() >= CONFIG.effectBalance.mirrorDuplicateChance) break;
            let clones = 1;
            if (Math.random() < CONFIG.effectBalance.mirrorTripleChance) clones = 2;
            this.balls.duplicateBall(ball, clones);
            break;
          }
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
          skipNudge = true;
          break;
        }
        case 'swamp': {
          this.balls.addScore(ball, sb.swampScore ?? 4);
          ball.swampDepth = (ball.swampDepth || 0) + 1;
          const v = ball.body.velocity;
          const speed = Math.hypot(v.x, v.y);
          const max = sb.swampMaxSpeed ?? 0.45;
          if (speed > max && speed > 0) {
            Matter.Body.setVelocity(ball.body, {
              x: (v.x / speed) * max,
              y: (v.y / speed) * max,
            });
          }
          skipNudge = true;
          break;
        }
        case 'amplify': {
          const first = !this.amplifyHitIds.has(bar.id);
          if (first) this.amplifyHitIds.add(bar.id);
          const factor = first
            ? sb.amplifyFirst ?? 3
            : sb.amplifyRest ?? 0.9;
          this.balls.multiplyScore(ball, factor);
          break;
        }
        case 'gamble': {
          const win = Math.random() < (sb.gambleWinChance ?? 0.6);
          const factor = win
            ? sb.gambleWinMult ?? 1.4
            : sb.gambleLoseMult ?? 0.8;
          this.balls.multiplyScore(ball, factor);
          break;
        }
        case 'chaos_warp': {
          const ok = this.balls.chaosWarpBall(ball);
          if (!ok) this.nudgeBallOnPass(ball);
          skipNudge = true;
          break;
        }
        case 'growth': {
          const mult = this.growthMult != null
            ? this.growthMult
            : sb.growthStart ?? 0.7;
          this.balls.multiplyScore(ball, mult);
          break;
        }
        case 'glass': {
          this.balls.multiplyScore(ball, sb.glassMult ?? 2.4);
          ball.isGlass = true;
          break;
        }
        default:
          break;   // 일반 막대는 효과 없음
      }

      // 유리 성배 — 특수 통과 시 확률 파괴
      if (
        this.hasEffect('risky_start') &&
        BAR_TYPES[bar.type].sensor &&
        Math.random() < (CONFIG.effectBalance.passBreakChance ?? 0.04)
      ) {
        this.addEffect(
          ball.body.position.x,
          ball.body.position.y,
          '파괴',
          '#8b2e2e'
        );
        this.balls.removeBall(ball);
        continue;
      }

      // 통과형(특수) 막대만 방향 꺾기 — 워프·늪·불완전 워프는 위에서 처리
      if (
        !skipNudge &&
        BAR_TYPES[bar.type].sensor &&
        bar.type !== 'warp' &&
        bar.type !== 'chaos_warp' &&
        bar.type !== 'swamp'
      ) {
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
    this.paused = false;
    this.selectedBar = null;
    this.hoverPeg = null;
    this.hoverBar = null;
    this.hoverBall = null;
    this.rollSinkBonusZone();
    this.dragging = null;
    this.dropScore = 0;
    this.sharedScoreBarHits = 0; // 점수 나선 — 드롭마다 초기화
    this.amplifyHitIds.clear();
    this.usedDeflectKeys.clear();
    this.pendingDeflects = [];
    this.pendingFlatRolls = [];
    this.pendingPegJitters = [];
    this.snapLaunchToSlot();

    const startScore = this.ballStartScore();
    this.balls.createBall(this.launchX, CONFIG.launchY, {
      score: startScore,
      velocity: { x: 0, y: CONFIG.launchSpeed },
    });
    if (this.isMirrorDropActive()) {
      this.balls.createBall(this.mirrorLaunchX(this.launchX), CONFIG.launchY, {
        score: startScore,
        isMirror: true,
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

    if (this.growthMult != null) {
      this.growthMult =
        Math.round(
          (this.growthMult + (CONFIG.shopBars.growthPerDrop ?? 0.1)) * 100
        ) / 100;
    }

    if (lastDrop) {
      if (this.roundScore >= target) {
        this.openEffectDraft(
          `드롭 ${dropDone} 종료 (+${this.dropScore}). 합계 ${this.roundScore}/${target} — 목표 달성! +${CONFIG.shop.roundGold}G. 상점을 이용하세요.`
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
    if (
      ball.isGlass &&
      Math.random() < (CONFIG.shopBars.glassBreakChance ?? 0.5)
    ) {
      this.addEffect(
        ball.body.position.x,
        CONFIG.sinkY + 12,
        '깨짐',
        BAR_TYPES.glass.glow
      );
      this.balls.removeBall(ball);
      return;
    }

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
    this.sharedScoreBarHits = 0;
    this.sinkBonusZone = null;
    this.recycleUsesLeft = 0;
    this.gold = 0;
    this.shopRerollCost = CONFIG.shop.rerollStartCost;
    this.relicPriceMap = {};
    this.barPriceMap = {};
    this.growthMult = null;
    this.lockedPegIds = new Set();
    this.amplifyHitIds = new Set();
    this.paused = false;
    this.hoverBar = null;
    this.hoverBall = null;
    this.selectedBar = null;
    this.selectedSpring = null;
    this.clearSprings();
    this.selectedTool = 'normal';
    this.ui.renderRelicTray();
    this.launchX = this.board.launchSlotXs()[Math.floor(CONFIG.cols / 2)];
    this.effects = [];
    this.pendingEffects = [];
    this.pendingDeflects = [];
    this.pendingPegJitters = [];
    this.usedDeflectKeys.clear();
    this.inventory = this.startingInventory();
    this.ui.hideFail();
    this.refreshShopOffers();
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
    if (BAR_TYPES[type].shopOnly) return false;

    if (this.isPegLocked(peg)) {
      this.ui.setMessage('잠긴 페그에는 막대를 설치할 수 없습니다.');
      return false;
    }

    const existing = this.bars.barAtPeg(peg.id);
    if (existing && existing.type === type) {
      this.selectedBar = existing;
      this.selectedTool = type;
      this.ui.setMessage(`${BAR_TYPES[type].label} 선택 — Q/E, 휠, 드래그로 회전할 수 있습니다.`);
      return true;
    }

    if (existing && BAR_TYPES[existing.type]?.shopOnly) {
      this.ui.setMessage('상점 막대는 다른 종류로 교체할 수 없습니다.');
      return false;
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
    const overSell = this.ui.isOverSell(clientX, clientY);
    this.ui.setRecycleHot(overRecycle && this.invDrag.type !== 'normal');
    this.ui.setSellHot(overSell);

    const canvas = this.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const over =
      !overRecycle &&
      !overSell &&
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
    this.ui.setSellHot(false);

    if (!moved) {
      this.selectTool(type);
      this.hoverPeg = null;
      return;
    }

    if (this.ui.isOverSell(clientX, clientY)) {
      this.trySellInventory(type);
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

  /** 삭제 마퀴 사각형 안의 막대를 보관함으로 (상점 막대는 건너뜀) */
  refundBarsInMarquee() {
    const m = this.deleteMarquee;
    if (!m) return { removed: 0, skipped: 0 };
    const left = Math.min(m.x0, m.x1);
    const right = Math.max(m.x0, m.x1);
    const top = Math.min(m.y0, m.y1);
    const bottom = Math.max(m.y0, m.y1);
    if (right - left < 4 || bottom - top < 4) return { removed: 0, skipped: 0 };

    const hit = this.bars.bars.filter(
      (b) => b.x >= left && b.x <= right && b.y >= top && b.y <= bottom
    );
    let removed = 0;
    let skipped = 0;
    for (const bar of [...hit]) {
      const result = this.removeBarFromBoard(bar);
      if (result.permanent) skipped += 1;
      else if (result.ok) removed += 1;
    }
    return { removed, skipped };
  }

  /** 스프링 부스트 — 공마다 스프링당 1회 발사. 이후 그 공에게는 일반 막대 */
  processPendingSpringBoosts() {
    if (this.pendingSpringBoosts.length === 0) return;
    const queue = this.pendingSpringBoosts;
    this.pendingSpringBoosts = [];
    const seen = new Set();
    const mult = CONFIG.effectBalance.springBounceMult || 3;
    const cap = CONFIG.effectBalance.springMaxSpeed || 18;
    const now = performance.now();

    for (const item of queue) {
      const spring = this.springs.find((s) => s.id === item.springId);
      if (!spring) continue;

      const ball = this.balls.balls.find((b) => b.id === item.ballId);
      if (!ball || !ball.body) continue;
      if (!ball.usedSpringIds) ball.usedSpringIds = new Set();
      if (ball.usedSpringIds.has(spring.id)) continue;

      const key = `${spring.id}:${ball.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ball.usedSpringIds.add(spring.id);

      const recorded = Math.hypot(item.preVx, item.preVy);
      const baseSpeed = Math.max(
        Math.min(recorded > 0.01 ? recorded : CONFIG.launchSpeed, CONFIG.maxBallSpeed),
        CONFIG.launchSpeed || 1.2
      );

      const rad = (item.angleDeg * Math.PI) / 180;
      const outSpeed = Math.min(baseSpeed * mult, cap);
      Matter.Body.setVelocity(ball.body, {
        x: Math.cos(rad) * outSpeed,
        y: Math.sin(rad) * outSpeed,
      });
      ball.springBoostUntil = now + 450;
      this.addRing(
        ball.body.position.x,
        ball.body.position.y,
        '#c45c2a'
      );
    }
  }

  rotateSelected(delta) {
    if (this.phase !== 'edit') return;
    if (this.selectedSpring) {
      this.rotateSpring(this.selectedSpring, delta);
      this.ui.setMessage(`스프링 방향 ${this.selectedSpring.angleDeg}° — Q/E·휠로 회전`);
      return;
    }
    if (!this.selectedBar) return;
    const ok = this.bars.rotateBar(this.selectedBar, delta);
    if (!ok) {
      this.ui.setMessage('그 각도로는 설치할 수 없습니다 (겹침 또는 보드 밖). 이전 각도로 되돌렸습니다.');
    }
  }

    handleClick(x, y) {
    if (this.phase !== 'edit') return;

    // 0) 스프링 선택
    const spring = this.springAt(x, y);
    if (spring) {
      this.selectedSpring = spring;
      this.selectedBar = null;
      this.ui.setMessage(`스프링 선택 (${spring.angleDeg}°) — Q/E·휠로 방향 회전`);
      return;
    }

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
      const freeRange = this.hasEffect('warp_mult');
      const spot = this.board.warpSpotAt(x, y, 18, bar, freeRange);
      if (spot && bar) {
        if (
          this.board.isWarpSpotReachable(bar, spot, freeRange) &&
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
        if (!this.board.isWarpSpotReachable(bar, spot, freeRange)) {
          this.ui.setMessage(
            freeRange
              ? '그 워프 도착지는 사용할 수 없습니다.'
              : '워프는 위·아래 3칸 이내로만 이동할 수 있습니다.'
          );
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
      this.selectedSpring = null;
      this.selectedTool = bar.type;
      this.ui.setMessage(
        `${BAR_TYPES[bar.type].label} 선택 — Q/E·휠로 회전, 드래그로 이동. 삭제는 삭제 도구를 쓰세요.`
      );
      return;
    }

    // 3) 빈 공간/페그 클릭 — 설치는 드래그만, 선택·흐린 × 해제
    this.selectedBar = null;
    this.selectedSpring = null;
    const peg = this.board.pegAt(x, y);
    if (peg) {
      if (this.isPegLocked(peg)) {
        this.ui.setMessage('잠긴 페그입니다. 막대를 설치할 수 없습니다.');
      } else {
        this.ui.setMessage('막대는 보유 칸에서 페그로 드래그해야 설치됩니다.');
      }
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

    const overSell = this.ui.isOverSell(clientX, clientY);
    this.ui.setSellHot(overSell && this.barDrag.moved);

    const canvas = this.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const over =
      !overSell &&
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
    this.ui.setSellHot(false);
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

    if (this.ui.isOverSell(clientX, clientY)) {
      // liftForDrag 로 페그가 복구된 상태 — 판매 실패 시 원위치 복구
      if (!this.trySellBar(bar)) {
        this.bars.restoreAfterDragCancel(bar);
      }
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
        if (this.isPegLocked(peg) && peg.id !== fromPegId) {
          this.bars.restoreAfterDragCancel(bar);
          this.ui.setMessage('잠긴 페그로는 옮길 수 없습니다.');
          return;
        }
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
        this.hoverBar = this.bars.barAt(p.x, p.y);
        this.ui.updateBoardBarTip(this.hoverBar);
        this.hoverBall = null;
      } else if (this.phase === 'run') {
        this.hoverPeg = null;
        this.hoverBar = null;
        this.ui.updateBoardBarTip(null);
        let best = null;
        let bestD = Infinity;
        for (const ball of this.balls.balls) {
          if (!ball.body) continue;
          const d = Math.hypot(
            ball.body.position.x - p.x,
            ball.body.position.y - p.y
          );
          if (d < CONFIG.ballRadius + 14 && d < bestD) {
            best = ball;
            bestD = d;
          }
        }
        this.hoverBall = best;
      } else {
        this.hoverPeg = null;
        this.hoverBar = null;
        this.hoverBall = null;
        this.ui.updateBoardBarTip(null);
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
          const { removed, skipped } = this.refundBarsInMarquee();
          if (removed > 0 && skipped > 0) {
            this.ui.setMessage(
              `막대 ${removed}개를 보관함으로 되돌렸습니다. 상점 막대 ${skipped}개는 영구라 제외했습니다.`
            );
          } else if (removed > 0) {
            this.ui.setMessage(
              `선택한 영역에서 막대 ${removed}개를 보관함으로 되돌렸습니다.`
            );
          } else if (skipped > 0) {
            this.ui.setMessage(
              `상점 막대 ${skipped}개는 영구 설치라 삭제되지 않습니다.`
            );
          } else {
            this.ui.setMessage('선택한 영역 안에 막대가 없습니다.');
          }
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
      if (!this.barDrag && !this.invDrag) {
        this.hoverPeg = null;
        this.hoverBar = null;
        this.hoverBall = null;
        this.ui.updateBoardBarTip(null);
      }
    });

    canvas.addEventListener('wheel', (evt) => {
      if (this.phase !== 'edit' || (!this.selectedBar && !this.selectedSpring)) return;
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

      if (this.phase === 'run' && (k === 'enter' || k === ' ')) {
        evt.preventDefault();
        this.togglePause();
        return;
      }

      // 편집 중: Enter / Space 로 게임 시작
      if (this.phase === 'edit' && (k === 'enter' || k === ' ')) {
        evt.preventDefault();
        this.startDrop();
        return;
      }

      if (this.phase !== 'edit') return;

      if (k === 'q') this.rotateSelected(-CONFIG.angleStep);
      else if (k === 'e') this.rotateSelected(CONFIG.angleStep);
      else if (k === 'escape') {
        this.selectedBar = null;
        this.selectedSpring = null;
      }
      else if ((k === 'delete' || k === 'backspace') && this.selectedBar) {
        evt.preventDefault();
        const removedType = this.selectedBar.type;
        const result = this.removeBarFromBoard(this.selectedBar);
        if (result.permanent) {
          this.ui.setMessage(
            `${BAR_TYPES[removedType].label} 은(는) 영구 상점 막대라 삭제할 수 없습니다.`
          );
        } else if (result.ok) {
          this.ui.setMessage(
            `${BAR_TYPES[removedType].label} 제거 — 보유로 돌아왔습니다.`
          );
        }
      }
    });
  }

  /* ------------------------------------------------------------------ *
   *  연출
   * ------------------------------------------------------------------ */
  addEffect(x, y, text, color) {
    const life = CONFIG.effectLifeMs || 750;
    this.effects.push({ kind: 'text', x, y, text, color, life, maxLife: life });
  }

  addRing(x, y, color) {
    const life = CONFIG.ringLifeMs || 470;
    this.effects.push({ kind: 'ring', x, y, color, life, maxLife: life });
  }

  tickEffects(dtMs) {
    for (const fx of this.effects) fx.life -= dtMs;
    this.effects = this.effects.filter((fx) => fx.life > 0);
  }

  /** 공 정지 감시 — 5초 이상이면 이번 드롭 0점 */
  checkStuckBalls() {
    if (this.phase !== 'run') return;
    const now = performance.now();
    const maxSp = CONFIG.stuckSpeedMax ?? 0.08;
    const warnMs = CONFIG.stuckWarnMs ?? 2500;
    const failMs = CONFIG.stuckFailMs ?? 5000;

    for (const ball of this.balls.balls) {
      if (!ball.body) continue;
      const v = ball.body.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed <= maxSp) {
        if (!ball.stuckSince) {
          ball.stuckSince = now;
          ball.stuckWarned = false;
        } else {
          const elapsed = now - ball.stuckSince;
          if (!ball.stuckWarned && elapsed >= warnMs) {
            ball.stuckWarned = true;
            this.ui.setMessage('공이 멈춤 — 계속 가두면 이번 드롭은 0점입니다!');
          }
          if (elapsed >= failMs) {
            this.failDropByStuck();
            return;
          }
        }
      } else {
        ball.stuckSince = 0;
        ball.stuckWarned = false;
      }
    }
  }

  failDropByStuck() {
    this.dropScore = 0;
    this.balls.removeAll();
    this.pendingEffects = [];
    this.pendingDeflects = [];
    this.pendingFlatRolls = [];
    this.pendingPegJitters = [];
    this.pendingSpringBoosts = [];
    this.ui.setMessage('공이 5초 이상 멈춰 이번 드롭은 0점입니다.');
    this.endDrop();
  }

  /* ------------------------------------------------------------------ *
   *  메인 루프 — 물리/연출은 고정 스텝, 그리기만 모니터 주사율
   * ------------------------------------------------------------------ */
  loop(now) {
    if (this._prevNow == null) this._prevNow = now;
    let dt = now - this._prevNow;
    this._prevNow = now;
    if (dt < 0) dt = 0;
    if (dt > 250) dt = 250; // 탭 복귀 등 큰 공백은 잘라 냄

    const step = CONFIG.fixedDtMs || 1000 / 60;
    const maxSteps = CONFIG.maxPhysSteps || 5;

    if (this.phase === 'run' && !this.paused) {
      this._physAcc += dt;
      let steps = 0;
      while (
        this._physAcc >= step &&
        steps < maxSteps &&
        this.phase === 'run' &&
        !this.paused
      ) {
        this.fixedUpdate(step);
        this._physAcc -= step;
        steps++;
      }
      if (steps >= maxSteps) this._physAcc = 0;
    } else {
      this._physAcc = 0;
    }

    this.bars.tick(dt);
    this.balls.tickVisuals(dt);
    this.tickEffects(dt);
    this.renderer.draw();
    this.ui.refresh();
    requestAnimationFrame(this.loop);
  }

  /** 고정 시간 스텝 1회 — 주사율과 무관하게 같은 속도로 진행 */
  fixedUpdate(dtMs) {
    for (const ball of this.balls.balls) {
      ball.preVx = ball.body.velocity.x;
      ball.preVy = ball.body.velocity.y;
      ball.preX = ball.body.position.x;
      ball.preY = ball.body.position.y;
      if (Math.abs(ball.preVx) >= CONFIG.lastDirMinSpeed) {
        ball.lastDirX = Math.sign(ball.preVx);
      }
    }

    Matter.Engine.update(this.engine, dtMs);
    this.processPendingEffects();
    this.processPendingDeflects();
    this.processPendingFlatRolls();
    this.processPendingPegJitters();
    this.processPendingSpringBoosts();
    this.balls.clampSpeeds();
    this.checkStuckBalls();

    if (this.phase !== 'run') return;

    for (const ball of [...this.balls.balls]) {
      const p = ball.body.position;
      if (p.y > CONFIG.sinkY) {
        this.sinkBall(ball);
      } else if (p.y > CONFIG.boardHeight + 200 || p.x < -100 || p.x > CONFIG.boardWidth + 100) {
        this.balls.removeBall(ball);
      }
    }

    if (this.balls.balls.length === 0) {
      this.endDrop();
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (typeof Matter === 'undefined') {
    console.error('Matter.js 를 불러오지 못했습니다. matter.min.js 파일이 있는지 확인하세요.');
    return;
  }
  window.game = new Game(document.getElementById('board'));
});
