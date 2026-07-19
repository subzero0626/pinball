/* =========================================================================
 * ui.js — 패널 / 드래프트 / 상태 표시
 * ========================================================================= */

class UI {
  constructor(game) {
    this.game = game;
    this.el = {
      btnStart: document.getElementById('btnStart'),
      message: document.getElementById('message'),
      toolButtons: Array.from(document.querySelectorAll('.tool-btn')),
      draftOverlay: document.getElementById('draftOverlay'),
      draftTitle: document.getElementById('draftTitle'),
      draftSubtitle: document.getElementById('draftSubtitle'),
      draftChoices: document.getElementById('draftChoices'),
      failOverlay: document.getElementById('failOverlay'),
      failTitle: document.getElementById('failTitle'),
      failSummary: document.getElementById('failSummary'),
      failBalls: document.getElementById('failBalls'),
      failTotal: document.getElementById('failTotal'),
      failBest: document.getElementById('failBest'),
      btnFailRetry: document.getElementById('btnFailRetry'),
      invCounts: Array.from(document.querySelectorAll('[data-inv]')),
      hudRound: document.getElementById('hudRound'),
      hudDrops: Array.from(document.querySelectorAll('#hudDrops .drop-dot')),
      hudScore: document.getElementById('hudScore'),
      recycleDrop: document.getElementById('recycleDrop'),
      recycleUses: document.getElementById('recycleUses'),
      sellDrop: document.getElementById('sellDrop'),
      relicTray: document.getElementById('relicTray'),
      ballScoreTip: document.getElementById('ballScoreTip'),
      barFloatTip: document.getElementById('barFloatTip'),
      hudGold: document.getElementById('hudGold'),
      shopPanel: document.getElementById('shopPanel'),
      shopBody: document.getElementById('shopBody'),
      shopHandle: document.getElementById('shopHandle'),
      shopOffers: document.getElementById('shopOffers'),
      btnShopReroll: document.getElementById('btnShopReroll'),
    };
    this.invGhost = null;
    this._relicTraySig = '';
    this._ballTipSig = '';
    this._floatTipEl = null;
    this._shopSig = '';
    this._shopSlide = 1;
    this._shopDrag = null;

    this.bindEvents();
    this.renderShop();
  }

  bindEvents() {
    const g = this.game;

    for (const btn of this.el.toolButtons) {
      const tool = btn.dataset.tool;

      if (btn.classList.contains('has-tip')) {
        this.bindBarFloatTip(btn);
      }

      if (tool === 'delete') {
        btn.addEventListener('click', () => {
          if (g.phase !== 'edit') return;
          g.selectTool('delete');
        });
        continue;
      }

      // 클릭 = 선택, 드래그 = 페그에 설치
      btn.addEventListener('pointerdown', (evt) => {
        if (g.phase !== 'edit' || evt.button !== 0) return;
        this.hideBarFloatTip();
        if (g.inventoryCount(tool) <= 0) {
          g.selectTool(tool);
          return;
        }
        evt.preventDefault();
        g.beginInvDrag(tool, evt.clientX, evt.clientY);
      });
    }

    if (this.el.recycleDrop && this.el.recycleDrop.classList.contains('has-tip')) {
      this.bindBarFloatTip(this.el.recycleDrop);
    }
    if (this.el.sellDrop && this.el.sellDrop.classList.contains('has-tip')) {
      this.bindBarFloatTip(this.el.sellDrop);
    }

    this.bindShopDrawer();
    if (this.el.btnShopReroll) {
      this.el.btnShopReroll.addEventListener('click', () => g.tryShopReroll());
    }

    this.el.btnStart.addEventListener('click', () => {
      if (g.phase === 'run') g.togglePause();
      else g.startDrop();
    });
    if (this.el.btnFailRetry) {
      this.el.btnFailRetry.addEventListener('click', () => g.confirmFailRetry());
    }
    if (this.el.draftOverlay) {
      this.el.draftOverlay.addEventListener('click', (evt) => {
        if (this.el.draftOverlay.hidden) return;
        // 선택지/시트 안 클릭은 무시 — 빈 공간(오버레이)만 토글
        if (evt.target.closest('.draft-sheet')) return;
        this.toggleDraftPeek();
      });
    }
  }

  bindBarFloatTip(el) {
    el.addEventListener('pointerenter', () => this.showBarFloatTip(el));
    el.addEventListener('pointerleave', () => this.hideBarFloatTip());
    el.addEventListener('focus', () => this.showBarFloatTip(el));
    el.addEventListener('blur', () => this.hideBarFloatTip());
  }

  showBarFloatTip(el) {
    const tip = this.el.barFloatTip;
    if (!tip) return;
    if (document.body.classList.contains('is-inv-dragging')) return;
    const title = (el.getAttribute('data-tip-title') || '').trim();
    const text = (el.getAttribute('data-tip') || '').trim();
    if (!title && !text) return;

    const escape = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    if (title) {
      tip.innerHTML =
        `<strong class="tip-title">${escape(title)}</strong>` +
        (text
          ? `<span class="tip-body">${escape(text)}</span>`
          : '');
    } else if (text.includes('\n')) {
      const nl = text.indexOf('\n');
      const head = text.slice(0, nl).trim();
      const body = text.slice(nl + 1).trim();
      tip.innerHTML =
        `<strong class="tip-title">${escape(head)}</strong>` +
        (body ? `<span class="tip-body">${escape(body)}</span>` : '');
    } else {
      tip.innerHTML = `<span class="tip-body">${escape(text)}</span>`;
    }

    tip.hidden = false;
    this._floatTipEl = el;
    this.placeBarFloatTip(el);
  }

  placeBarFloatTip(el) {
    const tip = this.el.barFloatTip;
    if (!tip || tip.hidden || !el) return;
    const r = el.getBoundingClientRect();
    const gap = 10;
    tip.style.left = `${Math.round(r.right + gap)}px`;
    tip.style.top = `${Math.round(r.top + r.height / 2)}px`;
    // 화면 밖으로 나가면 살짝 안쪽으로
    const tr = tip.getBoundingClientRect();
    const overflow = tr.right - (window.innerWidth - 8);
    if (overflow > 0) {
      tip.style.left = `${Math.round(r.right + gap - overflow)}px`;
    }
  }

  hideBarFloatTip() {
    const tip = this.el.barFloatTip;
    if (tip) tip.hidden = true;
    this._floatTipEl = null;
    this._boardBarTipId = null;
  }

  /** 보드 위 상점 막대 호버 설명 */
  updateBoardBarTip(bar) {
    const tip = this.el.barFloatTip;
    if (!tip) return;
    if (document.body.classList.contains('is-inv-dragging')) {
      tip.hidden = true;
      return;
    }
    if (!bar || !BAR_TYPES[bar.type]?.shopOnly) {
      if (this._boardBarTipId != null) {
        tip.hidden = true;
        this._boardBarTipId = null;
      }
      return;
    }
    if (this._floatTipEl) return; // 버튼 팁이 우선

    const def = BAR_TYPES[bar.type];
    let desc = (typeof BAR_TIPS !== 'undefined' && BAR_TIPS[bar.type]) || '';
    if (bar.type === 'growth' && this.game.growthMult != null) {
      desc = `현재 ×${BallManager.formatFactor(this.game.growthMult)}\n${desc}`;
    }
    const escape = (s) =>
      String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    tip.innerHTML =
      `<strong class="tip-title">${escape(def.label)}</strong>` +
      (desc ? `<span class="tip-body">${escape(desc)}</span>` : '');
    tip.hidden = false;
    this._boardBarTipId = bar.id;

    // 막대 오른쪽에 표시
    const canvas = this.game.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (bar.x / CONFIG.boardWidth) * rect.width;
    const sy = rect.top + (bar.y / CONFIG.boardHeight) * rect.height;
    tip.style.left = `${Math.round(sx + 18)}px`;
    tip.style.top = `${Math.round(sy)}px`;
    const tr = tip.getBoundingClientRect();
    const overflow = tr.right - (window.innerWidth - 8);
    if (overflow > 0) {
      tip.style.left = `${Math.round(sx + 18 - overflow)}px`;
    }
  }

  toggleDraftPeek() {
    if (!this.el.draftOverlay || this.el.draftOverlay.hidden) return;
    this.el.draftOverlay.classList.toggle('is-peek');
  }

  clearDraftPeek() {
    if (this.el.draftOverlay) this.el.draftOverlay.classList.remove('is-peek');
  }

  showInvGhost(type, clientX, clientY, angleDeg = 0) {
    this.hideBarFloatTip();
    this.hideInvGhost();
    const def = BAR_TYPES[type];
    const ghost = document.createElement('div');
    ghost.className = `inv-drag-ghost inv-drag-bar ${type}`;
    ghost.style.setProperty('--bar-color', def.color);
    ghost.style.setProperty('--bar-angle', `${angleDeg}deg`);
    document.body.appendChild(ghost);
    this.invGhost = ghost;
    document.body.classList.add('is-inv-dragging');
    this.moveInvGhost(clientX, clientY, angleDeg);
  }

  moveInvGhost(clientX, clientY, angleDeg) {
    if (!this.invGhost) return;
    this.invGhost.style.left = `${clientX}px`;
    this.invGhost.style.top = `${clientY}px`;
    if (angleDeg !== undefined) {
      this.invGhost.style.setProperty('--bar-angle', `${angleDeg}deg`);
    }
  }

  hideInvGhost() {
    if (this.invGhost) {
      this.invGhost.remove();
      this.invGhost = null;
    }
    document.body.classList.remove('is-inv-dragging');
    this.setRecycleHot(false);
    this.setSellHot(false);
    this.hideBarFloatTip();
  }

  isOverRecycle(clientX, clientY) {
    const el = this.el.recycleDrop;
    if (!el || el.hidden) return false;
    const r = el.getBoundingClientRect();
    return (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    );
  }

  setRecycleHot(on) {
    if (!this.el.recycleDrop) return;
    this.el.recycleDrop.classList.toggle('is-hot', !!on);
  }

  isOverSell(clientX, clientY) {
    const el = this.el.sellDrop;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    );
  }

  setSellHot(on) {
    if (!this.el.sellDrop) return;
    this.el.sellDrop.classList.toggle('is-hot', !!on);
  }

  /** 상점 서랍 — 핸들 드래그 + 열림/닫힘 자석 스냅 */
  bindShopDrawer() {
    const panel = this.el.shopPanel;
    const handle = this.el.shopHandle;
    if (!panel || !handle) return;

    this.setShopSlide(1, false);

    const onMove = (evt) => {
      const drag = this._shopDrag;
      if (!drag || evt.pointerId !== drag.pointerId) return;
      const travel = this.shopDrawerTravel();
      if (travel <= 0) return;
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastT);
      const dx = evt.clientX - drag.startX;
      // 오른쪽으로 끌면 열림(1), 왼쪽이면 닫힘(0)
      let t = drag.startT + dx / travel;
      t = Math.max(0, Math.min(1, t));
      const prev = drag.lastTval;
      drag.vel = (t - prev) / dt;
      drag.lastT = now;
      drag.lastTval = t;
      this.setShopSlide(t, false);
    };

    const onUp = (evt) => {
      const drag = this._shopDrag;
      if (!drag || evt.pointerId !== drag.pointerId) return;
      this._shopDrag = null;
      panel.classList.remove('is-dragging');
      try {
        handle.releasePointerCapture(evt.pointerId);
      } catch (_) {
        /* ignore */
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      const vel = drag.vel || 0;
      let target;
      if (Math.abs(vel) > 0.0012) {
        target = vel > 0 ? 1 : 0;
      } else {
        // 끝쪽에 가까우면 자석처럼 붙음
        const t = this._shopSlide;
        if (t <= 0.18) target = 0;
        else if (t >= 0.82) target = 1;
        else target = t >= 0.5 ? 1 : 0;
      }
      this.setShopSlide(target, true);
    };

    handle.addEventListener('pointerdown', (evt) => {
      if (evt.button != null && evt.button !== 0) return;
      evt.preventDefault();
      this.hideBarFloatTip();
      panel.classList.remove('is-snapping');
      panel.classList.add('is-dragging');
      this._shopDrag = {
        pointerId: evt.pointerId,
        startX: evt.clientX,
        startT: this._shopSlide,
        lastT: performance.now(),
        lastTval: this._shopSlide,
        vel: 0,
      };
      try {
        handle.setPointerCapture(evt.pointerId);
      } catch (_) {
        /* ignore */
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  shopDrawerTravel() {
    const panel = this.el.shopPanel;
    if (!panel) return 1;
    const handleW =
      parseFloat(getComputedStyle(panel).getPropertyValue('--shop-handle-w')) || 32;
    return Math.max(1, panel.offsetWidth - handleW);
  }

  setShopSlide(t, animate) {
    const panel = this.el.shopPanel;
    if (!panel) return;
    const next = Math.max(0, Math.min(1, t));
    this._shopSlide = next;
    panel.style.setProperty('--shop-t', String(next));
    panel.classList.toggle('is-snapping', !!animate);
    panel.classList.toggle('is-closed', next < 0.5);
    panel.setAttribute('aria-expanded', next >= 0.5 ? 'true' : 'false');
  }

  renderShop() {
    const box = this.el.shopOffers;
    if (!box) return;
    const g = this.game;
    const offers = g.shopOffers || [];
    const phase = g.phase;
    const canInteract = phase !== 'run' && phase !== 'fail';
    const sig = `${g.gold}|${g.shopRerollCost}|${phase}|${offers
      .map((o) => {
        if (!o) return '-';
        if (o.kind === 'bar') return `b:${o.type}:${o.price}`;
        return `r:${o.id}:${o.price}`;
      })
      .join(',')}`;

    const syncOfferEnabled = () => {
      const buttons = box.querySelectorAll('.shop-offer');
      buttons.forEach((btn, i) => {
        const offer = offers[i];
        if (!offer || btn.classList.contains('is-empty')) {
          btn.disabled = true;
          return;
        }
        const price = offer.price || 0;
        const canBuy =
          canInteract &&
          g.gold >= price &&
          (offer.kind !== 'relic' || !g.ownedEffects.includes(offer.id));
        btn.disabled = !canBuy;
      });
      if (this.el.btnShopReroll) {
        this.el.btnShopReroll.textContent = `리롤 · ${g.shopRerollCost}G`;
        this.el.btnShopReroll.disabled =
          !canInteract || g.gold < g.shopRerollCost;
      }
    };

    if (sig === this._shopSig && box.childNodes.length) {
      syncOfferEnabled();
      return;
    }
    this._shopSig = sig;
    box.innerHTML = '';

    for (let i = 0; i < (CONFIG.shop.offerCount || 3); i++) {
      const offer = offers[i] || null;
      const btn = document.createElement('button');
      btn.type = 'button';
      if (!offer) {
        btn.className = 'shop-offer is-empty';
        btn.disabled = true;
        btn.innerHTML = '';
        btn.setAttribute('aria-label', '빈 칸');
        box.appendChild(btn);
        continue;
      }

      const price = offer.price || 0;
      const canBuy =
        canInteract &&
        g.gold >= price &&
        (offer.kind !== 'relic' || !g.ownedEffects.includes(offer.id));

      btn.className = 'shop-offer has-tip';
      btn.disabled = !canBuy;
      btn.setAttribute('data-tip-title', offer.label || '');
      let tipBody = `${price}G`;
      if (offer.kind === 'bar' && offer.type === 'growth' && g.growthMult != null) {
        tipBody += `\n현재 성장 ×${BallManager.formatFactor(g.growthMult)}`;
      }
      if (offer.desc) tipBody += `\n${offer.desc}`;
      btn.setAttribute('data-tip', tipBody);
      btn.setAttribute('aria-label', `${offer.label} ${price}G`);

      if (offer.kind === 'bar') {
        const color = offer.color || '#6b6560';
        btn.innerHTML = `
          <span class="shop-offer-visual">
            <span class="shop-bar-swatch" style="--sw:${color}"></span>
          </span>
          <span class="shop-offer-price">${price}G</span>
        `;
      } else {
        const icon =
          typeof relicIconSvg === 'function'
            ? relicIconSvg(offer.icon, 'relic-icon-svg')
            : '';
        btn.innerHTML = `
          <span class="shop-offer-visual">
            ${icon || '<span class="shop-offer-empty">?</span>'}
          </span>
          <span class="shop-offer-price">${price}G</span>
        `;
      }

      btn.addEventListener('click', () => g.buyShopOffer(i));
      this.bindBarFloatTip(btn);
      box.appendChild(btn);
    }

    syncOfferEnabled();
  }

  setMessage(text) {
    if (!this.el.message) return;
    this.el.message.textContent = text || '';
  }

  /** 점수 수식 HTML — +숫자는 초록, ×숫자는 파랑 */
  formatScoreFormulaHtml(formula) {
    const src = String(formula || '');
    let html = '';
    let lastOp = null;
    const re = /(\d+(?:\.\d+)?)|([+×xX*()])|./g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1] != null) {
        const num = m[1];
        if (lastOp === '+') {
          html += `<span class="op-add">${num}</span>`;
        } else if (lastOp === '×') {
          html += `<span class="op-mul">${num}</span>`;
        } else {
          html += num;
        }
        lastOp = null;
      } else if (m[2] != null) {
        let op = m[2];
        if (op === 'x' || op === 'X' || op === '*') op = '×';
        html += op;
        if (op === '+' || op === '×') lastOp = op;
        else lastOp = null;
      } else {
        html += m[0];
        lastOp = null;
      }
    }
    return html || src;
  }

  updateBallScoreTip() {
    const tip = this.el.ballScoreTip;
    if (!tip) return;
    const g = this.game;
    const ball = g.hoverBall;
    if (g.phase !== 'run' || !ball || !ball.body) {
      tip.hidden = true;
      this._ballTipSig = '';
      return;
    }

    const formula = ball.scoreFormula || String(ball.score);
    const sig = `${ball.id}|${formula}|${ball.score}`;
    const canvas = g.renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.left + (ball.body.position.x / CONFIG.boardWidth) * rect.width;
    const sy = rect.top + (ball.body.position.y / CONFIG.boardHeight) * rect.height;
    const gap = (CONFIG.ballRadius / CONFIG.boardWidth) * rect.width + 10;

    tip.style.left = `${Math.round(sx + gap)}px`;
    tip.style.top = `${Math.round(sy)}px`;

    if (sig !== this._ballTipSig) {
      this._ballTipSig = sig;
      const formulaEl = tip.querySelector('.formula');
      const totalEl = tip.querySelector('.total');
      if (formulaEl) formulaEl.innerHTML = this.formatScoreFormulaHtml(formula);
      if (totalEl) totalEl.textContent = `= ${ball.score}`;
    }
    tip.hidden = false;

    // 오른쪽이 화면 밖이면 살짝 당김
    const tr = tip.getBoundingClientRect();
    const overflow = tr.right - (window.innerWidth - 8);
    if (overflow > 0) {
      tip.style.left = `${Math.round(sx + gap - overflow)}px`;
    }
  }

  showBarDraft(offers) {
    this.clearDraftPeek();
    this.el.draftTitle.textContent = '막대 고르기';
    this.el.draftSubtitle.textContent = '서로 다른 3가지 · 일반은 ×2 · 하나를 고르세요';
    this._renderDraftChoices(offers, (index) => this.game.pickBarDraft(index));
    this.el.draftOverlay.hidden = false;
  }

  showEffectDraft(offers) {
    this.clearDraftPeek();
    this.el.draftTitle.textContent = '유물 고르기';
    this.el.draftSubtitle.textContent = '라운드 클리어 보상 · 서로 다른 유물 중 하나';
    this._renderDraftChoices(offers, (index) => this.game.pickEffectDraft(index), true);
    this.el.draftOverlay.hidden = false;
  }

  _renderDraftChoices(offers, onPick, isEffect = false) {
    const box = this.el.draftChoices;
    box.innerHTML = '';

    offers.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'draft-choice';

      if (isEffect) {
        const icon = typeof relicIconSvg === 'function'
          ? relicIconSvg(item.icon, 'relic-icon-svg draft-relic-icon')
          : '';
        btn.innerHTML = `
          <span class="draft-relic-head">
            ${icon}
            <span class="draft-choice-label draft-effect-name">${item.label}</span>
          </span>
          <span class="draft-effect-desc">${item.desc || ''}</span>
        `;
      } else {
        const type = item.type;
        const count = item.count || 1;
        const countLabel = count > 1 ? ` ×${count}` : '';
        btn.innerHTML = `
          <span class="draft-choice-label">선택지 ${index + 1}</span>
          <span class="draft-pack">
            <span class="draft-bar">
              <span class="swatch ${type}"></span>${BAR_TYPES[type].label}${countLabel}
            </span>
          </span>
        `;
      }

      btn.addEventListener('click', () => onPick(index));
      box.appendChild(btn);
    });

    if (typeof window.applySketchJitter === 'function') {
      window.applySketchJitter(this.el.draftOverlay);
    }
  }

  renderRelicTray() {
    const tray = this.el.relicTray;
    if (!tray) return;
    const g = this.game;
    const sig = g.ownedEffects.join(',');
    if (sig === this._relicTraySig && tray.childNodes.length === g.ownedEffects.length) {
      return;
    }
    this._relicTraySig = sig;
    tray.innerHTML = '';

    for (const id of g.ownedEffects) {
      const def = EFFECT_TYPES.find((e) => e.id === id);
      if (!def) continue;
      const wrap = document.createElement('div');
      wrap.className = 'relic-slot';
      wrap.tabIndex = 0;
      wrap.setAttribute('aria-label', `${def.label}. ${def.desc}`);
      wrap.innerHTML = typeof relicIconSvg === 'function'
        ? relicIconSvg(def.icon, 'relic-icon-svg')
        : '';
      const tip = document.createElement('span');
      tip.className = 'relic-tip';
      tip.innerHTML =
        `<strong class="tip-title">${def.label}</strong>` +
        `<span class="tip-body">${String(def.desc || '').replace(/\n/g, '<br>')}</span>`;
      wrap.appendChild(tip);
      tray.appendChild(wrap);
    }
  }

  hideDraft() {
    this.clearDraftPeek();
    this.el.draftOverlay.hidden = true;
    this.el.draftChoices.innerHTML = '';
  }

  showFail({ round, roundScore, target, ballsCreated, totalScore, bestBallScore }) {
    if (this.el.failTitle) {
      this.el.failTitle.textContent = `라운드 ${round} 실패`;
    }
    if (this.el.failSummary) {
      this.el.failSummary.innerHTML =
        `이번 라운드 <strong>${roundScore}</strong> / 목표 <strong>${target}</strong>`;
    }
    if (this.el.failBalls) this.el.failBalls.textContent = String(ballsCreated ?? 0);
    if (this.el.failTotal) this.el.failTotal.textContent = String(totalScore ?? 0);
    if (this.el.failBest) this.el.failBest.textContent = String(bestBallScore ?? 0);
    if (this.el.failOverlay) {
      this.el.failOverlay.hidden = false;
      if (typeof window.applySketchJitter === 'function') {
        window.applySketchJitter(this.el.failOverlay);
      }
    }
  }

  hideFail() {
    if (this.el.failOverlay) this.el.failOverlay.hidden = true;
  }

  refresh() {
    const g = this.game;
    const editing = g.phase === 'edit';
    if (g.phase === 'title') return;

    this.el.hudRound.textContent = String(g.roundNumber);

    this.el.hudDrops.forEach((dot, i) => {
      const n = i + 1;
      dot.classList.toggle('done', n < g.dropIndex);
      dot.classList.toggle('current', n === g.dropIndex);
    });

    const scored = g.phase === 'run' ? g.roundScore + g.dropScore : g.roundScore;
    const target = g.getTargetScore();
    this.el.hudScore.textContent = `${scored}/${target}`;
    this.el.hudScore.classList.toggle('met', scored >= target);

    for (const el of this.el.invCounts) {
      el.textContent = g.inventoryCount(el.dataset.inv);
    }

    for (const btn of this.el.toolButtons) {
      const tool = btn.dataset.tool;
      btn.classList.toggle('active', tool === g.selectedTool);
      const empty = tool !== 'delete' && g.inventoryCount(tool) <= 0;
      btn.classList.toggle('empty-inv', empty);
      btn.disabled = !editing;
      if (tool !== 'delete') {
        btn.classList.toggle('draggable-inv', editing && !empty);
      }
    }

    if (g.phase === 'run') {
      this.el.btnStart.disabled = false;
      this.el.btnStart.textContent = g.paused ? '재개' : '일시정지';
    } else {
      this.el.btnStart.disabled = !editing;
      this.el.btnStart.textContent =
        `드롭 ${g.dropIndex}/${CONFIG.dropsPerRound} 시작`;
    }

    if (this.el.hudGold) {
      this.el.hudGold.textContent = `${g.gold}G`;
    }

    this.renderShop();

    document.body.classList.remove('is-paused');
    this.updateBallScoreTip();
    if (this._floatTipEl) this.placeBarFloatTip(this._floatTipEl);

    const showRecycle = g.hasEffect('bar_recycle');
    if (this.el.recycleDrop) {
      this.el.recycleDrop.hidden = !showRecycle;
      this.el.recycleDrop.classList.toggle('is-empty', g.recycleUsesLeft <= 0);
      if (this.el.recycleUses) {
        this.el.recycleUses.textContent = String(g.recycleUsesLeft);
      }
    }

    if (this.el.sellDrop) {
      this.el.sellDrop.hidden = false;
    }

    this.renderRelicTray();
  }
}
