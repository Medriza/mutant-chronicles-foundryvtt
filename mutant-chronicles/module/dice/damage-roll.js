/**
 * MC3 Damage Roll Engine — Dark Symmetry Dice (DSD).
 *
 * DSD are d6s with custom face resolution:
 *   1 → 1 damage
 *   2 → 2 damage
 *   3, 4, 5 → 0 damage
 *   6 → Dark Symmetry Icon (DSI) — 0 damage, triggers weapon special effect
 *
 * Total damage = sum of die results + weapon's flat damage bonus.
 * DSI count is reported separately on the chat card.
 *
 * Exported functions:
 *   rollDSD({ actor, weapon, bonusDamageDice })  → Promise<damageResult>
 *   sendDamageToChat(damageResult)               → Promise<void>
 */

const DAMAGE_TEMPLATE = 'systems/mutant-chronicles/templates/dice/damage-chat.hbs';

/**
 * Evaluate a DSD damage roll and return a structured result object.
 *
 * @param {object} params
 * @param {Actor}  params.actor           The attacking actor (for chat attribution).
 * @param {Item}   params.weapon          The weapon item being used.
 * @param {number} params.bonusDamageDice Extra DSD purchased with Momentum.
 * @returns {Promise<object>} damageResult
 */
export async function rollDSD({ actor, weapon, bonusDamageDice = 0 }) {
  const numDice   = (weapon.system.damageDice ?? 0) + bonusDamageDice;
  const flatBonus = weapon.system.damageFlat  ?? 0;

  // Roll the dice (if there are any).
  const roll = numDice > 0 ? new Roll(`${numDice}d6`) : null;
  if (roll) await roll.evaluate();

  // Classify each die face.
  const dice = roll ? roll.dice[0].results.map(({ result }) => {
    const damage   = result === 1 ? 1 : result === 2 ? 2 : 0;
    const isDSI    = result === 6;

    // CSS class drives colour in damage-chat.hbs:
    //   dsd-one    → amber  (1 damage)
    //   dsd-two    → gold   (2 damage)
    //   dsd-miss   → grey   (0 damage, faces 3–5)
    //   dsd-effect → red    (DSI, face 6)
    const cssClass = result === 1 ? 'dsd-one'
                   : result === 2 ? 'dsd-two'
                   : result === 6 ? 'dsd-effect'
                   :                'dsd-miss';

    return { result, damage, isDSI, cssClass };
  }) : [];

  const totalDamage = dice.reduce((sum, d) => sum + d.damage, 0) + flatBonus;
  const dsiCount    = dice.filter(d => d.isDSI).length;

  return {
    weaponName: weapon.name,
    numDice,
    flatBonus,
    dice,
    totalDamage,
    dsiCount,
    roll,
    actor,
  };
}

/**
 * Render a damage result into the chat log.
 *
 * @param {object} damageResult  The object returned by rollDSD().
 */
export async function sendDamageToChat(damageResult) {
  const content = await foundry.applications.handlebars.renderTemplate(
    DAMAGE_TEMPLATE,
    damageResult
  );

  await ChatMessage.create({
    content,
    // Only attach the Roll object if we actually rolled dice.
    // (A flat-bonus-only result has roll: null.)
    ...(damageResult.roll ? { rolls: [damageResult.roll] } : {}),
    speaker: ChatMessage.getSpeaker({ actor: damageResult.actor }),
  });
}
