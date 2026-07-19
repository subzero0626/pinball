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
      relicTray: document.getElementById('relicTray'),
    };
    this.invGhost = null;
    this._relicTraySig = '';

    this.bindEvents();
  }

  bindEvents() {
    const g = this.game;

    for (const btn of this.el.toolButtons) {
      const tool = btn.dataset.tool;

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
        if (g.inventoryCount(tool) <= 0) {
          g.selectTool(tool);
          return;
        }
        evt.preventDefault();
        g.beginInvDrag(tool, evt.clientX, evt.clientY);
      });
    }

    this.el.btnStart.addEventListener('click', () => g.startDrop());
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

  toggleDraftPeek() {
    if (!this.el.draftOverlay || this.el.draftOverlay.hidden) return;
    this.el.draftOverlay.classList.toggle('is-peek');
  }

  clearDraftPeek() {
    if (this.el.draftOverlay) this.el.draftOverlay.classList.remove('is-peek');
  }

  showInvGhost(type, clientX, clientY, angleDeg = 0) {
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

  setMessage(text) {
    if (!this.el.message) return;
    this.el.message.textContent = text || '';
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
      wrap.className = 'relic-slot has-tip';
      wrap.setAttribute('data-tip', `${def.label} — ${def.desc}`);
      wrap.innerHTML = typeof relicIconSvg === 'function'
        ? relicIconSvg(def.icon, 'relic-icon-svg')
        : '';
      const tip = document.createElement('span');
      tip.className = 'relic-tip';
      tip.innerHTML = `<strong>${def.label}</strong><span>${def.desc}</span>`;
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

    this.el.btnStart.disabled = !editing;
    this.el.btnStart.textContent =
      `드롭 ${g.dropIndex}/${CONFIG.dropsPerRound} 시작`;

    const showRecycle = g.hasEffect('bar_recycle');
    if (this.el.recycleDrop) {
      this.el.recycleDrop.hidden = !showRecycle;
      this.el.recycleDrop.classList.toggle('is-empty', g.recycleUsesLeft <= 0);
      if (this.el.recycleUses) {
        this.el.recycleUses.textContent = String(g.recycleUsesLeft);
      }
    }

    this.renderRelicTray();
  }
}
