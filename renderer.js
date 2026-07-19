/* =========================================================================
 * renderer.js — 캔버스 직접 렌더링 (종이·색연필 스케치)
 * ========================================================================= */

class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    canvas.width = CONFIG.boardWidth;
    canvas.height = CONFIG.boardHeight;

    // 줄무늬·벽 해치는 프레임마다 흔들리지 않도록 시드 고정
    this.paperSeed = 42;
    this._wobble = this.makeRng(this.paperSeed);
    this.lineOffsets = [];
    for (let y = 40; y < CONFIG.boardHeight; y += 28) {
      this.lineOffsets.push(this._wobble() * 2.2 - 1.1);
    }
  }

  /** 0~1 결정론적 난수 (같은 시드 → 같은 결과) */
  makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  hash2(a, b) {
    return ((a * 73856093) ^ (b * 19349663)) >>> 0;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CONFIG.boardWidth, CONFIG.boardHeight);
    this.drawBackground();
    this.drawLaunchZone();
    this.drawWarpSpots();
    this.drawPegs();
    this.drawSprings();
    this.drawBars();
    this.drawWarpLinks();
    this.drawBalls();
    this.drawEffects();
    this.drawSinkZone();
    this.drawDeleteMarquee();
    this.drawPauseOverlay();
  }

  /** 일시정지 — 보드만 회색 (글자 없음) */
  drawPauseOverlay() {
    if (this.game.phase !== 'run' || !this.game.paused) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(72, 72, 72, 0.5)';
    ctx.fillRect(0, 0, CONFIG.boardWidth, CONFIG.boardHeight);
    ctx.restore();
  }

  drawDeleteMarquee() {
    const m = this.game.deleteMarquee;
    if (!m || this.game.phase !== 'edit') return;
    const ctx = this.ctx;
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0);
    const h = Math.abs(m.y1 - m.y0);

    ctx.save();
    ctx.fillStyle = 'rgba(163, 51, 51, 0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(139, 46, 46, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = '#f7f3ea';
    ctx.fillRect(0, 0, CONFIG.boardWidth, CONFIG.boardHeight);

    // 살짝 흔들린 노트 줄
    ctx.strokeStyle = 'rgba(47, 93, 140, 0.08)';
    ctx.lineWidth = 1;
    let i = 0;
    for (let y = 40; y < CONFIG.boardHeight; y += 28) {
      const wob = this.lineOffsets[i++] || 0;
      ctx.beginPath();
      ctx.moveTo(0, y + wob);
      ctx.lineTo(CONFIG.boardWidth, y + wob * 0.4);
      ctx.stroke();
    }

    // 마진 선 (미세하게 기울임)
    ctx.strokeStyle = 'rgba(180, 80, 70, 0.28)';
    ctx.beginPath();
    ctx.moveTo(CONFIG.wallThickness + 7, 0);
    ctx.lineTo(CONFIG.wallThickness + 10, CONFIG.boardHeight);
    ctx.stroke();

    // 벽 — 단색 칠 + 검은 테두리
    this.fillWall(0, 0, CONFIG.wallThickness, CONFIG.boardHeight, '#3d3832', 7);
    this.fillWall(
      CONFIG.boardWidth - CONFIG.wallThickness, 0,
      CONFIG.wallThickness, CONFIG.boardHeight, '#3d3832', 11
    );
  }

  drawLaunchZone() {
    const ctx = this.ctx;
    const g = this.game;

    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(42, 38, 34, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const y0 = CONFIG.launchZoneHeight;
    ctx.moveTo(CONFIG.wallThickness, y0 - 0.8);
    ctx.lineTo(CONFIG.boardWidth * 0.5, y0 + 0.6);
    ctx.lineTo(CONFIG.boardWidth - CONFIG.wallThickness, y0 - 0.4);
    ctx.stroke();
    ctx.restore();

    if (g.phase === 'edit') {
      ctx.fillStyle = 'rgba(47, 93, 140, 0.75)';
      ctx.font = '16px Gaegu, cursive';
      ctx.textAlign = 'center';
      ctx.fillText('상단을 좌우로 드래그해 낙하 위치를 고르세요', CONFIG.boardWidth / 2, 28);

      const score = g.ballStartScore();
      this.drawPreviewBall(g.launchX, CONFIG.launchY, score, false);
      if (g.isMirrorDropActive()) {
        this.drawPreviewBall(
          g.mirrorLaunchX(g.launchX),
          CONFIG.launchY,
          score,
          true
        );
      }
    }
  }

  /** 편집 중 낙하 위치 미리보기 공 */
  drawPreviewBall(x, y, score, mirror) {
    const ctx = this.ctx;
    ctx.save();
    if (mirror) ctx.globalAlpha = 0.55;

    const fill = mirror ? 'rgba(64, 196, 210, 0.85)' : '#e8e2d6';
    const stroke = mirror ? '#1a6b75' : '#2a2622';
    const seed = mirror ? 101 : 99;
    this.sketchCircleFill(x, y, CONFIG.ballRadius, fill, seed, 0.3, 2.0);
    this.sketchCircleStroke(x, y, CONFIG.ballRadius, stroke, seed);

    const label = BallManager.labelFor(score);
    ctx.fillStyle = mirror ? '#0d3d44' : '#2a2622';
    ctx.font = `bold ${label.size + 2}px Gaegu, cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.text, x, y + 0.5);
    ctx.restore();
  }

  drawWarpSpots() {
    const g = this.game;
    const ctx = this.ctx;

    const drawX = (spot, strong) => {
      const rng = this.makeRng(this.hash2(spot.id, 55));
      const j = (rng() - 0.5) * 1.4;
      const r = (strong ? 7 : 5) + rng() * 0.8;
      ctx.save();
      ctx.strokeStyle = strong ? '#6b4f9a' : 'rgba(107, 79, 154, 0.45)';
      ctx.lineWidth = strong ? 2.5 : 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(spot.x - r + j, spot.y - r);
      ctx.lineTo(spot.x + r, spot.y + r + j);
      ctx.moveTo(spot.x + r, spot.y - r + j);
      ctx.lineTo(spot.x - r + j, spot.y + r);
      ctx.stroke();
      ctx.restore();
    };

    // 지정된 도착지 X — 편집/실행 중 항상 표시
    const chosenIds = new Set();
    for (const bar of g.bars.bars) {
      if (bar.type !== 'warp' || !bar.warpSpot) continue;
      drawX(bar.warpSpot, true);
      chosenIds.add(bar.warpSpot.id);
    }

    // 후보(흐린) X — 워프 막대 선택 중일 때만 (다른 도구·드래그 시 즉시 숨김)
    if (g.phase !== 'edit') return;
    if (g.barDrag || g.invDrag) return;
    if (g.selectedTool !== 'warp') return;
    if (!g.selectedBar || g.selectedBar.type !== 'warp') return;

    const targetBar = g.selectedBar;
    const freeRange = g.hasEffect('warp_mult');

    for (const spot of g.board.warpSpots) {
      if (targetBar.warpSpot && targetBar.warpSpot.id === spot.id) continue;
      if (!g.board.isWarpSpotReachable(targetBar, spot, freeRange)) continue;
      if (!g.board.isWarpSpotFree(spot, g.bars.bars, targetBar.id)) continue;
      drawX(spot, false);
    }
  }

  drawWarpLinks() {
    const g = this.game;
    const ctx = this.ctx;
    const running = g.phase === 'run';

    for (const bar of g.bars.bars) {
      if (bar.type !== 'warp' || !bar.warpSpot) continue;
      const selected = g.selectedBar && g.selectedBar.id === bar.id;
      const rng = this.makeRng(bar.id * 13);

      ctx.save();
      ctx.setLineDash([3 + rng() * 2, 5 + rng() * 2]);
      if (selected) {
        ctx.strokeStyle = '#6b4f9a';
        ctx.lineWidth = 2;
      } else if (running) {
        ctx.strokeStyle = 'rgba(107, 79, 154, 0.55)';
        ctx.lineWidth = 1.4;
      } else {
        ctx.strokeStyle = 'rgba(107, 79, 154, 0.45)';
        ctx.lineWidth = 1.2;
      }
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bar.x, bar.y);
      const mx = (bar.x + bar.warpSpot.x) / 2 + (rng() - 0.5) * 12;
      const my = (bar.y + bar.warpSpot.y) / 2 + (rng() - 0.5) * 12;
      ctx.quadraticCurveTo(mx, my, bar.warpSpot.x, bar.warpSpot.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawPegs() {
    const ctx = this.ctx;
    for (const peg of this.game.board.pegs) {
      if (!peg.body) continue;

      const hovered = this.game.hoverPeg && this.game.hoverPeg.id === peg.id;
      const color = hovered ? '#2a2622' : '#5c564e';

      // 색칠 — 방향마다 삐져나옴이 제각각
      this.sketchCircleFill(peg.x, peg.y, CONFIG.pegRadius, color, peg.id, 0.4, 2.4);
      this.sketchCircleStroke(peg.x, peg.y, CONFIG.pegRadius, '#2a2622', peg.id);

      if (hovered && this.game.phase === 'edit') {
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, CONFIG.pegRadius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = this.game.isPegLocked(peg)
          ? 'rgba(139, 46, 46, 0.7)'
          : 'rgba(47, 93, 140, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (this.game.phase === 'edit' && this.game.isPegLocked(peg)) {
        ctx.save();
        ctx.translate(peg.x, peg.y - 3);
        const s = 1.55;
        ctx.scale(s, s);
        const red = '#9a2e2e';
        // 고리
        ctx.beginPath();
        ctx.arc(0, -3.2, 4.2, Math.PI * 0.95, Math.PI * 0.05, false);
        ctx.strokeStyle = red;
        ctx.lineWidth = 3.1;
        ctx.lineCap = 'round';
        ctx.stroke();
        // 몸통 (단색)
        ctx.fillStyle = red;
        this.roundRect(ctx, -5.5, -1.2, 11, 9.5, 1.8);
        ctx.fill();
        // 열쇠구멍
        ctx.fillStyle = '#f3efe6';
        ctx.beginPath();
        ctx.arc(0, 2.2, 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-0.7, 2.2, 1.4, 3.2);
        ctx.restore();
      }
    }
  }

  drawSprings() {
    const ctx = this.ctx;
    const g = this.game;
    const L = CONFIG.barLength;
    const T = CONFIG.barThickness;
    const color = '#c45c5c';

    for (const spring of g.springs) {
      const selected = g.selectedSpring && g.selectedSpring.id === spring.id;
      // 발사 방향에 수직인 막대 각도
      const barRot = ((spring.angleDeg + 90) * Math.PI) / 180;
      const launchRot = (spring.angleDeg * Math.PI) / 180;

      const rng = this.makeRng(spring.id * 131);
      const jitterRot = (rng() - 0.5) * 0.03;
      const jx = (rng() - 0.5) * 0.8;
      const jy = (rng() - 0.5) * 0.8;

      ctx.save();
      ctx.translate(spring.x + jx, spring.y + jy);
      ctx.rotate(barRot + jitterRot);

      ctx.fillStyle = color;
      this.sketchBleedRoundRect(ctx, -L / 2, -T / 2, L, T, T / 2, spring.id * 41);
      ctx.fill();

      this.roundRect(ctx, -L / 2, -T / 2, L, T, T / 2);
      ctx.strokeStyle = '#2a2622';
      ctx.lineWidth = 1.8 + rng() * 0.35;
      ctx.stroke();

      if (selected) {
        ctx.strokeStyle = '#8b2e2e';
        ctx.lineWidth = 2;
        this.roundRect(ctx, -L / 2 - 3, -T / 2 - 3, L + 6, T + 6, (T + 6) / 2);
        ctx.stroke();
      }
      ctx.restore();

      // 발사 방향 노란 화살 (아이콘)
      ctx.save();
      ctx.translate(spring.x, spring.y);
      ctx.rotate(launchRot);
      const iconX = T / 2 + 11;
      const arrowSize = 18;
      ctx.translate(iconX, 0);
      ctx.scale(arrowSize / 24, arrowSize / 24);
      ctx.translate(-12, -12);
      const arrowPath = new Path2D(
        (typeof RELIC_ICON_PATHS !== 'undefined' && RELIC_ICON_PATHS.arrowRight) ||
          'M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3'
      );
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = '#2a2622';
      ctx.stroke(arrowPath);
      ctx.lineWidth = 2.1;
      ctx.strokeStyle = '#e6b422';
      ctx.stroke(arrowPath);
      ctx.restore();
    }
  }

  drawBars() {
    const ctx = this.ctx;
    for (const bar of this.game.bars.bars) {
      const def = BAR_TYPES[bar.type];
      const selected = this.game.selectedBar && this.game.selectedBar.id === bar.id;
      const invalid = bar.invalidFlash > 0;
      const color = invalid ? '#c45c5c' : def.color;
      if (bar.dragging) continue;

      const rng = this.makeRng(bar.id * 97);
      const jitterRot = (rng() - 0.5) * 0.03;
      const jx = (rng() - 0.5) * 0.8;
      const jy = (rng() - 0.5) * 0.8;

      ctx.save();
      ctx.translate(bar.x + jx, bar.y + jy);
      ctx.rotate((this.game.bars.physicsAngleDeg(bar) * Math.PI) / 180 + jitterRot);

      const L = bar.length || CONFIG.barLength;
      const T = CONFIG.barThickness;

      ctx.fillStyle = color;
      this.sketchBleedRoundRect(ctx, -L / 2, -T / 2, L, T, T / 2, bar.id * 31);
      ctx.fill();

      this.roundRect(ctx, -L / 2, -T / 2, L, T, T / 2);
      ctx.strokeStyle = '#2a2622';
      ctx.lineWidth = 1.8 + rng() * 0.35;
      ctx.stroke();

      if (selected || invalid) {
        ctx.strokeStyle = invalid ? '#8b2e2e' : '#2f5d8c';
        ctx.lineWidth = 2;
        this.roundRect(ctx, -L / 2 - 3, -T / 2 - 3, L + 6, T + 6, (T + 6) / 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  drawBalls() {
    const ctx = this.ctx;
    for (const ball of this.game.balls.balls) {
      const p = ball.body.position;
      const mirror = !!ball.isMirror;

      ctx.save();
      if (mirror) ctx.globalAlpha = 0.55;

      const fill = mirror
        ? 'rgba(64, 196, 210, 0.85)'
        : ball.isGlass && (ball.hasWarped || ball.glassPurple)
          ? 'rgba(175, 145, 220, 0.45)'
          : ball.isGlass
            ? 'rgba(180, 220, 235, 0.42)'
            : ball.hasWarped
              ? '#9b7bc4'
              : '#e8e2d6';
      const stroke = mirror
        ? '#1a6b75'
        : ball.isGlass && (ball.hasWarped || ball.glassPurple)
          ? 'rgba(110, 70, 160, 0.9)'
          : ball.isGlass
            ? 'rgba(90, 140, 170, 0.85)'
            : ball.hasWarped
              ? '#5a3d7a'
              : '#2a2622';
      this.sketchCircleFill(p.x, p.y, CONFIG.ballRadius, fill, ball.id + 17, 0.3, 2.0);
      this.sketchCircleStroke(p.x, p.y, CONFIG.ballRadius, stroke, ball.id);

      if (ball.isGlass && !mirror) {
        ctx.beginPath();
        ctx.arc(p.x - 2.5, p.y - 2.5, CONFIG.ballRadius * 0.35, 0, Math.PI * 2);
        ctx.fillStyle =
          ball.hasWarped || ball.glassPurple
            ? 'rgba(235, 220, 255, 0.6)'
            : 'rgba(255, 255, 255, 0.55)';
        ctx.fill();
      }

      if (ball.spawnFlash > 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, CONFIG.ballRadius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = mirror
          ? 'rgba(64, 196, 210, 0.7)'
          : ball.isGlass && (ball.hasWarped || ball.glassPurple)
            ? 'rgba(140, 100, 200, 0.7)'
            : ball.isGlass
              ? 'rgba(90, 160, 190, 0.65)'
              : ball.hasWarped
                ? 'rgba(107, 79, 154, 0.55)'
                : 'rgba(47, 93, 140, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      const label = BallManager.labelFor(ball.score);
      ctx.fillStyle = mirror
        ? '#0d3d44'
        : ball.isGlass && (ball.hasWarped || ball.glassPurple)
          ? '#3a2460'
          : ball.isGlass
            ? '#2a4a58'
            : ball.hasWarped
              ? '#3d2a52'
              : '#2a2622';
      ctx.font = `bold ${label.size + 2}px Gaegu, cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, p.x, p.y + 0.5);
      ctx.restore();
    }
  }

  drawEffects() {
    const ctx = this.ctx;
    for (const fx of this.game.effects) {
      const t = fx.life / fx.maxLife;

      if (fx.kind === 'ring') {
        ctx.save();
        ctx.globalAlpha = t * 0.75;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 2.5 * t;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, (1 - t) * 30 + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = Math.min(1, t * 1.6);
        ctx.fillStyle = fx.color;
        ctx.font = 'bold 18px Gaegu, cursive';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fx.text, fx.x, fx.y - (1 - t) * 26);
        ctx.restore();
      }
    }
  }

  drawSinkZone() {
    const ctx = this.ctx;
    const g = this.game;
    const y = CONFIG.sinkY;
    const h = CONFIG.boardHeight - y;

    ctx.fillStyle = 'rgba(47, 93, 140, 0.18)';
    ctx.fillRect(0, y, CONFIG.boardWidth, h);

    const zone = g.sinkBonusZone;
    if (zone && g.hasEffect('sink_bonus') && (g.phase === 'run' || g.phase === 'edit')) {
      const zw = zone.x1 - zone.x0;
      ctx.fillStyle = 'rgba(230, 180, 40, 0.72)';
      ctx.fillRect(zone.x0, y, zw, h);
      ctx.strokeStyle = 'rgba(160, 110, 20, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(zone.x0 + 0.5, y + 0.5, zw - 1, h - 1);

      ctx.fillStyle = '#5c3d0a';
      ctx.font = 'bold 18px Gaegu, cursive';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`×${zone.mult}`, (zone.x0 + zone.x1) / 2, y + h / 2);
    }

    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = '#2a2622';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(CONFIG.boardWidth * 0.35, y - 0.8);
    ctx.lineTo(CONFIG.boardWidth * 0.7, y + 0.7);
    ctx.lineTo(CONFIG.boardWidth, y - 0.3);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   *  단색 칠 + 테두리
   * ------------------------------------------------------------------ */

  fillWall(x, y, w, h, color, seed) {
    const ctx = this.ctx;
    const rng = this.makeRng(seed);
    const bl = rng() * 1.8;
    const br = rng() * 1.8;
    ctx.fillStyle = color;
    ctx.fillRect(x - bl, y, w + bl + br, h);
    ctx.strokeStyle = '#2a2622';
    ctx.lineWidth = 1.8;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /** 원 색칠 — 둘레마다 삐져나오는 양이 제각각 */
  sketchCircleFill(cx, cy, r, color, seed, bleedMin = 0.5, bleedMax = 2.2) {
    const ctx = this.ctx;
    const rng = this.makeRng(this.hash2(seed, 71));
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const bleed = bleedMin + rng() * (bleedMax - bleedMin);
      const rr = r + bleed;
      const x = cx + Math.cos(t) * rr;
      const y = cy + Math.sin(t) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 막대 색칠 — 변·모서리마다 튀어나옴이 랜덤 */
  sketchBleedRoundRect(ctx, x, y, w, h, r, seed) {
    const rng = this.makeRng(seed);
    const bl = 0.4 + rng() * 2.6;
    const br = 0.4 + rng() * 2.6;
    const bt = 0.4 + rng() * 2.6;
    const bb = 0.4 + rng() * 2.6;

    const x0 = x - bl;
    const y0 = y - bt;
    const x1 = x + w + br;
    const y1 = y + h + bb;
    const rr = Math.min(r + (bl + br + bt + bb) * 0.12, Math.min(x1 - x0, y1 - y0) / 2);

    // 변을 따라 점을 찍되 바깥으로 미세하게 흔들림
    const edge = (ax, ay, bx, by, n) => {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = ax + (bx - ax) * t;
        const py = ay + (by - ay) * t;
        const nx = -(by - ay);
        const ny = bx - ax;
        const len = Math.hypot(nx, ny) || 1;
        const push = (rng() - 0.35) * 1.4; // 가끔 거의 안 튀고, 가끔 더 튐
        pts.push({ x: px + (nx / len) * push, y: py + (ny / len) * push });
      }
      return pts;
    };

    const top = edge(x0 + rr, y0, x1 - rr, y0, 6);
    const right = edge(x1, y0 + rr, x1, y1 - rr, 4);
    const bottom = edge(x1 - rr, y1, x0 + rr, y1, 6);
    const left = edge(x0, y1 - rr, x0, y0 + rr, 4);

    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    for (const p of top) ctx.lineTo(p.x, p.y);
    ctx.arcTo(x1, y0, x1, y0 + rr, rr);
    for (const p of right) ctx.lineTo(p.x, p.y);
    ctx.arcTo(x1, y1, x1 - rr, y1, rr);
    for (const p of bottom) ctx.lineTo(p.x, p.y);
    ctx.arcTo(x0, y1, x0, y1 - rr, rr);
    for (const p of left) ctx.lineTo(p.x, p.y);
    ctx.arcTo(x0, y0, x0 + rr, y0, rr);
    ctx.closePath();
  }

  /** 손떨림 원 외곽선 */
  sketchCircleStroke(cx, cy, r, color, seed) {
    const ctx = this.ctx;
    const rng = this.makeRng(this.hash2(seed, 44));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6 + rng() * 0.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const rr = r + (rng() - 0.5) * 0.9;
      const x = cx + Math.cos(t) * rr;
      const y = cy + Math.sin(t) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}
