/**
 * MC3 Roll Dialog helpers.
 *
 * Two exported async functions — one for PC skill rolls, one for NPC
 * Fields of Expertise. Both return a plain object with everything the
 * roll engine needs, or null if the user cancelled the dialog.
 *
 * Foundry v13 note: uses DialogV2 (foundry.applications.api.DialogV2)
 * and the namespaced renderTemplate. The V1 Dialog class is deprecated.
 *
 * DialogV2.wait() differences from the old Dialog:
 *   - Buttons are an array, not an object keyed by name.
 *   - Each button has an `action` string and an optional `callback`.
 *   - The callback receives (event, button, dialog) — the third argument
 *     is the DialogV2 instance; use dialog.element.querySelector() to
 *     read form fields instead of the old jQuery html.find().
 *   - The whole call is awaitable: DialogV2.wait() returns a Promise
 *     that resolves to whatever the fired button's callback returns.
 *   - rejectClose: false means closing the window (X button) resolves
 *     null rather than throwing an error.
 */

const { DialogV2 } = foundry.applications.api;

// Human-readable labels for the eight PC attributes.
const ATTRIBUTE_LABELS = {
  agility:        'Agility',
  awareness:      'Awareness',
  coordination:   'Coordination',
  intelligence:   'Intelligence',
  mentalStrength: 'Mental Strength',
  personality:    'Personality',
  physique:       'Physique',
  strength:       'Strength',
};

const DIALOG_TEMPLATE = 'systems/mutant-chronicles/templates/dice/roll-dialog.hbs';

/* ────────────────────────────────────────────────────────────────────────── */
/*  PC — Skill Roll                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Show a roll dialog for a PC skill.
 *
 * @param {Actor}  actor  The character actor.
 * @param {Item}   skill  The skill item being rolled.
 * @returns {Promise<{tn, focus, difficulty, numDice, rollLabel}|null>}
 */
export async function showSkillRollDialog(actor, skill) {
  const attrKey       = skill.system.attribute;
  const attrValue     = actor.system.attributes[attrKey]?.value ?? 0;
  const expertise     = skill.system.expertise ?? 0;
  const focus         = skill.system.focus     ?? 0;
  const tn            = attrValue + expertise;

  const templateData = {
    isSkill:        true,
    isExpertise:    false,
    skillName:      skill.name,
    attributeLabel: ATTRIBUTE_LABELS[attrKey] ?? attrKey,
    attributeValue: attrValue,
    expertiseValue: expertise,
    focusValue:     focus,
    tn,
    currentDS: game.settings.get('mutant-chronicles', 'darkSymmetryPool'),
  };

  // foundry.applications.handlebars.renderTemplate replaces the deprecated
  // global renderTemplate().
  const content = await foundry.applications.handlebars.renderTemplate(DIALOG_TEMPLATE, templateData);

  // Wire stepper buttons after the dialog renders.
  // Foundry strips inline event handlers (onclick, oninput) from content HTML,
  // so we use the renderDialogV2 hook to add them after render.
  // Hooks.once fires exactly once for the next DialogV2 that renders — ours.
  Hooks.once('renderDialogV2', (_app, html) => {
    const root  = html instanceof HTMLElement ? html : html[0];
    const total = root.querySelector('.bonus-total-value');

    function syncTotal() {
      if (!total) return;
      const b = parseInt(root.querySelector('[name="buyDice"]')?.value   || '0') || 0;
      const e = parseInt(root.querySelector('[name="extraDice"]')?.value || '0') || 0;
      total.textContent = Math.max(0, b) + Math.max(0, e);
    }

    // Wire every stepper button in this dialog
    root.querySelectorAll('.counter-stepper .stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name   = btn.dataset.name;
        const input  = root.querySelector(`[name="${name}"]`);
        if (!input) return;
        const min    = parseInt(input.dataset.min  ?? '0');
        const max    = parseInt(input.dataset.max  ?? '99');
        const delta  = btn.classList.contains('stepper-up') ? 1 : -1;
        const next   = Math.min(max, Math.max(min, (parseInt(input.value) || 0) + delta));
        input.value  = next;
        // Update the display span in the same .counter-stepper
        const display = btn.closest('.counter-stepper')?.querySelector('.stepper-val');
        if (display) display.textContent = next;
        syncTotal();
      });
    });
  });

  // DialogV2.wait() returns a Promise that resolves to whatever the
  // clicked button's callback returns, or null if the window is closed.
  return DialogV2.wait({
    window:       { title: `Roll: ${skill.name}` },
    classes:      ['mc3-dialog'],
    position:     { width: 420 },
    content,
    rejectClose:  false,   // resolve null on window-X rather than throwing
    buttons: [
      {
        action:   'roll',
        label:    'Roll',
        icon:     'fas fa-dice',
        default:  true,
        callback: (event, button, dialog) => {
          // dialog.element is the root DOM node of the rendered dialog.
          const difficulty = parseInt(dialog.element.querySelector('[name="difficulty"]').value, 10);
          const buyDice    = Math.min(3, parseInt(dialog.element.querySelector('[name="buyDice"]').value,   10) || 0);
          const extraDice  = Math.max(0, parseInt(dialog.element.querySelector('[name="extraDice"]').value, 10) || 0);
          return {
            tn,
            focus,
            difficulty,
            numDice:     2 + buyDice + extraDice,
            rollLabel:   skill.name,
            rollFormula: `${ATTRIBUTE_LABELS[attrKey]} ${attrValue} + EXP ${expertise}`,
            dsSpend:     buyDice,   // each bought die costs 1 DS
          };
        },
      },
      {
        action:   'cancel',
        label:    'Cancel',
        icon:     'fas fa-times',
        callback: () => null,   // explicit null so the sheet guard works
      },
    ],
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  NPC — Expertise Roll                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Show a roll dialog for an NPC Field of Expertise.
 *
 * @param {Actor}  actor      The NPC actor.
 * @param {string} field      Field key: 'movement' | 'combat' | etc.
 * @param {object} expertise  system.expertise[field]: { exp, foc }
 * @returns {Promise<{tn, focus, difficulty, numDice, rollLabel}|null>}
 */
export async function showExpertiseRollDialog(actor, field, expertise) {
  const attributes = Object.entries(actor.system.attributes).map(([key, data]) => ({
    key,
    label: ATTRIBUTE_LABELS[key] ?? key,
    value: data.value ?? 0,
  }));

  const fieldLabel = field.charAt(0).toUpperCase() + field.slice(1);

  const templateData = {
    isSkill:        false,
    isExpertise:    true,
    fieldLabel,
    expertiseValue: expertise.exp ?? 0,
    focusValue:     expertise.foc ?? 0,
    attributes,
  };

  const content = await foundry.applications.handlebars.renderTemplate(DIALOG_TEMPLATE, templateData);

  // Wire stepper buttons for the NPC expertise dialog.
  Hooks.once('renderDialogV2', (_app, html) => {
    const root = html instanceof HTMLElement ? html : html[0];
    root.querySelectorAll('.counter-stepper .stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name  = btn.dataset.name;
        const input = root.querySelector(`[name="${name}"]`);
        if (!input) return;
        const min   = parseInt(input.dataset.min  ?? '0');
        const max   = parseInt(input.dataset.max  ?? '99');
        const delta = btn.classList.contains('stepper-up') ? 1 : -1;
        const next  = Math.min(max, Math.max(min, (parseInt(input.value) || 0) + delta));
        input.value = next;
        const display = btn.closest('.counter-stepper')?.querySelector('.stepper-val');
        if (display) display.textContent = next;
      });
    });
  });

  return DialogV2.wait({
    window:       { title: `Roll: ${fieldLabel}` },
    classes:      ['mc3-dialog'],
    position:     { width: 420 },
    content,
    rejectClose:  false,
    buttons: [
      {
        action:   'roll',
        label:    'Roll',
        icon:     'fas fa-dice',
        default:  true,
        callback: (event, button, dialog) => {
          const attrKey    = dialog.element.querySelector('[name="attribute"]').value;
          const attrValue  = actor.system.attributes[attrKey]?.value ?? 0;
          const exp        = expertise.exp ?? 0;
          const foc        = expertise.foc ?? 0;
          const tn         = attrValue + exp;
          const difficulty = parseInt(dialog.element.querySelector('[name="difficulty"]').value, 10);
          const extraDice  = Math.max(0, parseInt(dialog.element.querySelector('[name="extraDice"]').value, 10) || 0);
          return {
            tn,
            focus:     foc,
            difficulty,
            numDice:   2 + extraDice,
            rollLabel:   fieldLabel,
            rollFormula: `${ATTRIBUTE_LABELS[attrKey] ?? attrKey} ${attrValue} + EXP ${exp}`,
          };
        },
      },
      {
        action:   'cancel',
        label:    'Cancel',
        icon:     'fas fa-times',
        callback: () => null,
      },
    ],
  });
}
