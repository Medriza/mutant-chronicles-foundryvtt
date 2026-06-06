/**
 * MC3 Pool Tracker — floating ApplicationV2 window that manages:
 *   - Group Momentum Pool (0–6, shown as pip circles)
 *   - Dark Symmetry Pool  (0–∞, shown as a number)
 *
 * Architecture notes (Foundry v13):
 *   - Registered as CONFIG.ui.mc3pools so Foundry creates one singleton
 *     instance accessible everywhere as ui.mc3pools.
 *   - Opened by a hotbar macro: ui.mc3pools.render({ force: true })
 *   - Foundry remembers the window position per client — once placed, it
 *     reopens in the same spot every session.
 *
 *   V2 class stack:
 *     HandlebarsApplicationMixin  — adds _renderHTML / _replaceHTML so PARTS
 *                                   and _prepareContext work.
 *     ApplicationV2               — the base floating window class.
 *
 *   V2 vs V1 cheat-sheet:
 *     V1 defaultOptions  →  V2 DEFAULT_OPTIONS (static class field)
 *     V1 getData()       →  V2 _prepareContext()
 *     V1 activateListeners(html) with jQuery  →  V2 _onRender() with this.element
 */

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class PoolTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {

  // ---------------------------------------------------------------------------
  // Window configuration
  // ---------------------------------------------------------------------------

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'mc3-pool-tracker',
    classes: ['mc3-pool-tracker'],
    window: {
      title:     'MC3 Pools',
      resizable: false,
    },
    position: {
      width: 260,
    },
  };

  /**
   * PARTS declares which Handlebars templates to render.
   * The mixin's _renderHTML reads this and injects the output into the window.
   * @override
   */
  static PARTS = {
    main: {
      template: 'systems/mutant-chronicles/templates/apps/pool-tracker.hbs',
    }
  };

  // ---------------------------------------------------------------------------
  // Template data  (V2: _prepareContext replaces V1 getData)
  // ---------------------------------------------------------------------------

  /** @override */
  async _prepareContext(options) {
    const momentum     = game.settings.get('mutant-chronicles', 'momentumPool');
    const darkSymmetry = game.settings.get('mutant-chronicles', 'darkSymmetryPool');

    // 6 pip objects — the template renders filled/empty circles from this array.
    const momentumPips = Array.from({ length: 6 }, (_, i) => ({
      filled: i < momentum,
    }));

    return {
      isGM: game.user.isGM,
      momentum,
      darkSymmetry,
      momentumPips,
    };
  }

  // ---------------------------------------------------------------------------
  // Event wiring  (V2: _onRender; native DOM, no jQuery)
  // ---------------------------------------------------------------------------

  /**
   * Called after every render. PARTS-based rendering replaces the DOM nodes,
   * so old listeners are gone — attach fresh ones here each time.
   * @override
   */
  _onRender(context, options) {
    if (!game.user.isGM) return;

    this.element.querySelector('.momentum-increase')
      ?.addEventListener('click', () => this._onMomentumChange(+1));
    this.element.querySelector('.momentum-decrease')
      ?.addEventListener('click', () => this._onMomentumChange(-1));
    this.element.querySelector('.ds-increase')
      ?.addEventListener('click', () => this._onDSChange(+1));
    this.element.querySelector('.ds-decrease')
      ?.addEventListener('click', () => this._onDSChange(-1));
    this.element.querySelector('.new-session-btn')
      ?.addEventListener('click', () => this._onNewSession());
  }

  // ---------------------------------------------------------------------------
  // Handler methods
  // ---------------------------------------------------------------------------

  /**
   * Adjust the Group Momentum Pool by delta (+1 or −1), clamped to [0, 6].
   * @param {number} delta  +1 to bank momentum, −1 to spend.
   */
  async _onMomentumChange(delta) {
    const current = game.settings.get('mutant-chronicles', 'momentumPool');
    const next    = Math.clamp(current + delta, 0, 6);
    if (next === current) return;
    await game.settings.set('mutant-chronicles', 'momentumPool', next);
    // The updateSetting hook in mutant-chronicles.js re-renders on all clients.
  }

  /**
   * Adjust the Dark Symmetry Pool by delta (+1 or −1), clamped to [0, 99].
   * @param {number} delta  +1 to add, −1 to spend.
   */
  async _onDSChange(delta) {
    const current = game.settings.get('mutant-chronicles', 'darkSymmetryPool');
    const next    = Math.clamp(current + delta, 0, 99);
    if (next === current) return;
    await game.settings.set('mutant-chronicles', 'darkSymmetryPool', next);
  }

  /**
   * "New Session" — set DS to the sum of Chronicle Points across all PC actors.
   * Called at the start of each session before play begins.
   */
  async _onNewSession() {
    const pcs   = game.actors.filter(a => a.type === 'character');
    const total = pcs.reduce((sum, a) => sum + (a.system.chroniclePoints?.value ?? 0), 0);

    // Reset Momentum to 0 and set DS to total Chronicle Points.
    await game.settings.set('mutant-chronicles', 'momentumPool', 0);
    await game.settings.set('mutant-chronicles', 'darkSymmetryPool', total);

    ChatMessage.create({
      content: `<strong>MC3 | New Session</strong><br>
        Dark Symmetry Pool set to <strong>${total}</strong>
        (${pcs.length} PC Chronicle Points).`,
      whisper: [],
    });
  }
}
