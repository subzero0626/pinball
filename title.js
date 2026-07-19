/* title.js — 메인 화면 */
class TitleScreen {
  constructor(game) {
    this.game = game;
    this.el = {
      root: document.getElementById('titleScreen'),
      btnPlay: document.getElementById('btnTitlePlay'),
    };

    this.el.btnPlay.addEventListener('click', () => this.startGame());
    document.body.classList.add('is-title');
  }

  startGame() {
    document.body.classList.remove('is-title');
    if (this.el.root) this.el.root.hidden = true;
    if (this.game && typeof this.game.beginFromTitle === 'function') {
      this.game.beginFromTitle();
    }
  }
}

window.TitleScreen = TitleScreen;
