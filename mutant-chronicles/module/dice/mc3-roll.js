/**
 * MC3 Roll Engine.
 *
 * Takes the roll parameters assembled by the dialog (roll-dialog.js) and
 * produces a fully-evaluated result object that the chat card template can
 * render directly. Nothing in here touches the DOM or the chat log — it is
 * pure data transformation.
 *
 * MC3 2d20 success-counting rules:
 *   roll ≤ focus        → 2 successes  (focus hit)
 *   roll ≤ TN           → 1 success    (normal hit)
 *   roll > TN           → 0 successes  (miss)
 *   roll = 20           → complication (always 0 successes regardless of TN)
 *
 * Momentum = total successes − difficulty.
 *   ≥ 0  → success (momentum ≥ 0 means the test passed, extra = bonus momentum)
 *   < 0  → failure (shortfall = how many successes short)
 *
 * Exported functions:
 *   rollMC3(rollParams)          → Promise<rollResult>
 *   sendRollToChat(rollResult)   → Promise<void>
 */

const CHAT_TEMPLATE = 'systems/mutant-chronicles/templates/dice/roll-chat.hbs';

/**
 * Register custom Handlebars helpers used by roll-chat.hbs.
 * Call this once from the 'init' hook in mutant-chronicles.js.
 */
export function registerRollHelpers() {
  // {{ne a b}} — true if a !== b. Used for pluralisation in the chat card.
  Handlebars.registerHelper('ne', (a, b) => a !== b);

  // {{inc n}} — returns n + 1. Used to display 1-based career numbers in
  // tab-lifepath.hbs ({{#each}} gives 0-based keys).
  Handlebars.registerHelper('inc', (n) => parseInt(n) + 1);

  // {{camelToTitle str}} — converts camelCase to Title Case with spaces.
  // e.g. "mentalStrength" → "Mental Strength". Used for attribute group headers
  // on the skills tab so the data key doesn't need to change.
  Handlebars.registerHelper('camelToTitle', (str) =>
    str
      .replace(/([A-Z])/g, ' $1')        // insert space before each capital
      .replace(/^./, s => s.toUpperCase()) // capitalise the first letter
      .trim()
  );
}

/**
 * Render a completed rollResult into the chat log.
 * Foundry's ChatMessage.create() handles speaker attribution automatically.
 *
 * @param {object} rollResult  The object returned by rollMC3().
 */
export async function sendRollToChat(rollResult) {
  const content = await foundry.applications.handlebars.renderTemplate(
    CHAT_TEMPLATE,
    rollResult
  );

  await ChatMessage.create({
    content,
    // Attach the Roll object so Foundry renders the built-in dice tooltip
    // (the expandable formula bar under each chat message).
    rolls:   [rollResult.roll],
    // ChatMessage.getSpeaker() reads the currently-selected token, falling
    // back to the actor name — so rolls appear attributed to the character
    // rather than the GM's user account.
    speaker: ChatMessage.getSpeaker({ actor: rollResult.actor }),
  });
}

/**
 * Evaluate an MC3 roll and return a structured result object.
 *
 * @param {object} rollParams
 * @param {number}  rollParams.tn          Target Number (attribute + expertise)
 * @param {number}  rollParams.focus       Focus threshold (roll ≤ focus = 2 successes)
 * @param {number}  rollParams.difficulty  Difficulty (0–5)
 * @param {number}  rollParams.numDice     Number of d20s to roll (usually 2 + bonus)
 * @param {string}  rollParams.rollLabel   Human-readable label for the chat card header
 *
 * @returns {Promise<object>} rollResult — see structure below
 */
export async function rollMC3({ tn, focus, difficulty, numDice, rollLabel }) {

  // ── 1. Roll the dice ──────────────────────────────────────────────────────
  // Foundry's Roll class evaluates a dice expression and stores each
  // individual die result in roll.dice[0].results. We ask for numDice d20s.
  const roll = new Roll(`${numDice}d20`);

  // In Foundry v13, evaluate() is always async — no options needed.
  // Use roll.evaluateSync() only if you explicitly need a blocking call.
  await roll.evaluate();

  // ── 2. Classify each die ──────────────────────────────────────────────────
  // roll.dice[0].results is an array of objects: { result: <number>, active: true }
  // We map each raw value to a richer object the template can render directly.
  const dice = roll.dice[0].results.map(({ result }) => {
    const isComplication = result === 20;

    // A complication always gives 0 successes, even if TN ≥ 20 somehow.
    const successes = isComplication ? 0
                    : result <= focus ? 2
                    : result <= tn    ? 1
                    :                   0;

    // CSS class drives the colour in the chat card:
    //   focus       → gold  (double success)
    //   hit         → green (normal success)
    //   complication→ red
    //   miss        → grey
    const cssClass = isComplication           ? 'complication'
                   : result <= focus          ? 'focus'
                   : result <= tn             ? 'hit'
                   :                           'miss';

    return { result, successes, isComplication, cssClass };
  });

  // ── 3. Totals ─────────────────────────────────────────────────────────────
  const totalSuccesses    = dice.reduce((sum, d) => sum + d.successes, 0);
  const totalComplications = dice.filter(d => d.isComplication).length;
  const momentum          = totalSuccesses - difficulty;
  const isSuccess         = momentum >= 0;

  // ── 4. Build the result object ────────────────────────────────────────────
  // Every key here maps directly to a {{variable}} in roll-chat.hbs.
  return {
    rollLabel,
    tn,
    focus,
    difficulty,
    numDice,

    // Per-die breakdown (array — template uses {{#each}})
    dice,

    // Totals
    totalSuccesses,
    totalComplications,
    momentum,           // positive = bonus momentum, negative = shortfall
    isSuccess,

    // The Foundry Roll object — stored so Foundry can display it in the
    // dice tooltip (the 3D dice animation hook also reads from this).
    roll,
  };
}
