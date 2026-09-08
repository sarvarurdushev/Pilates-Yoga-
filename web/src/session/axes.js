/**
 * What to ask about *this* structure, in words a person can act on.
 *
 * Two things this file is trying to get right at once, and they pull against
 * each other.
 *
 * **The questions must be specific to the structure.** Three earlier versions
 * asked every muscle the same thing and were therefore wrong about almost all
 * of them. So every question is still built from a fact the atlas holds about
 * this one structure: what it does, which muscles the atlas names as covering
 * for it, which has to let go for it to work, where it should be felt, its
 * documented failure mode, and whatever the camera measured here.
 *
 * **But the words must be readable.** The first version of this quoted the
 * clinical register straight out of the atlas -- *"adduction and medial
 * rotation of the humerus; clavicular head flexes, sternocostal head extends
 * from flexion"* -- which is correct, and unreadable, and a question nobody can
 * read is a question answered badly. Every muscle in the atlas carries a second
 * register written for a person rather than a clinician, and that is what leads
 * now. The clinical wording is still there, one press away, for the coach who
 * wants it.
 *
 * Every anatomy word in a question's explanation is wrapped so it can be
 * pressed: see `glossary.js`. A question that says "is the deltoid taking over"
 * is only answerable by somebody who knows where the deltoid is, and pressing
 * the word lights it up on the body in front of them.
 *
 * The words live in the explanation and never in the title, because the title
 * is a button that folds the question open -- and a button inside a button is
 * not valid HTML. The parser closes the outer one, which silently truncated
 * every title at its first anatomy word.
 */
import { term } from './glossary.js';

/** 0 to 10, and both ends named in words somebody can picture. */
export const SCALE = 10;

const first = (list, n = 2) => (Array.isArray(list) ? list.slice(0, n) : []);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/** The first sentence of a plain description. The rest is background. */
const oneLine = (text, least = 70) => {
  const clean = String(text ?? '').trim();
  if (!clean) return '';
  /* Sentences, until there is enough to be an explanation. "The chest muscle."
   * is a true first sentence and a useless answer to "what is this for". */
  let out = '';
  for (const part of clean.split(/(?<=\.)\s+/)) {
    out = out ? `${out} ${part}` : part;
    if (out.length >= least) break;
  }
  return out;
};

/**
 * @param {object} record   registry entry: kind, name, muscle, fma
 * @param {object} [context] {measured, joints, registry}
 */
export function axesFor(record, context = {}) {
  const kind = record?.kind ?? '';
  if (kind === 'muscle') return forMuscle(record, context);
  if (kind === 'bone') return forBone(record, context);
  if (kind === 'nerve') return forNerve(record, context);
  return { axes: [], why: '' };
}

/* ------------------------------------------------------------------ muscle */

function forMuscle(record, context) {
  const m = record.muscle;
  const name = record?.name?.en ?? 'this muscle';
  const axes = [];

  if (m) {
    axes.push({
      key: 'job', title: 'Is it doing its own job?',
      /* The plain register. What this muscle is for, in the atlas's own words
       * for a person -- not the Latin. */
      plain: oneLine(m.en?.does) || `What ${name} is for.`,
      clinical: m.actions?.en ?? '',
      low: 'not helping at all', high: 'doing all of it, every rep',
    });
  }

  /* Named substitution. "Is something covering for it" cannot be answered;
   * "is the deltoid covering for it" can, by looking -- and the atlas already
   * knows which muscles those are for this one. */
  for (const other of first(m?.synergists, 2)) {
    axes.push({
      key: `cover:${other}`, title: `Is the ${other} taking over?`,
      plain: `The ${term(other)} helps with the same movement. When this muscle is `
           + 'quiet, that one does the work instead — and the exercise stops '
           + 'training what it was meant to.',
      low: 'it is doing everything', high: 'each doing its own share',
      terms: [other],
    });
  }

  const anta = first(m?.antagonists, 1)[0];
  if (anta) {
    axes.push({
      key: `release:${anta}`, title: `Does the ${anta} let go?`,
      plain: `The ${term(anta)} pulls the opposite way. It has to relax for this `
           + 'muscle to move anything. If both hold on at once, nothing moves '
           + 'and everything grips.',
      low: 'never lets go', high: 'lets go cleanly every rep',
      terms: [anta],
    });
  }

  const feels = m?.en?.feels ?? '';
  if (feels) {
    axes.push({
      key: 'feel', title: 'Do they feel it in the right place?',
      plain: feels,
      low: 'feels it somewhere else entirely',
      high: 'finds it there without being told',
    });
  }

  const known = m?.dysfunction?.en ?? '';
  if (known) {
    axes.push({
      key: 'known', title: 'The thing this muscle is known for',
      plain: oneLine(known),
      clinical: known,
      low: 'exactly as described', high: 'no sign of it',
      cited: true,
    });
  }

  const measured = context.measured;
  if (measured && measured.value != null) {
    axes.push({
      key: 'matches', title: 'Does the number match what you saw?',
      plain: `The camera measured ${measured.value} ${measured.unit} here this `
           + 'class. You watched the same movement. Do the two agree?',
      low: 'they disagree completely', high: 'the number is telling the truth',
      bridge: true,
    });
  }

  return {
    axes,
    why: m
      ? `These questions are about ${name} and nothing else — its own job, the `
        + 'muscles the atlas names as helping it or opposing it, and what the '
        + 'camera measured here. Any underlined word can be pressed.'
      : 'Nothing has been written up about this one, so there is nothing '
        + 'specific to ask. Write what you saw.',
  };
}

/* -------------------------------------------------------------------- bone */

function forBone(record, context) {
  const name = record?.name?.en ?? 'this bone';
  const joints = context.joints ?? [];
  const axes = [{
    key: 'place', title: 'Does it start in the right place?',
    plain: `Where ${name} sits before the movement begins. Everything after `
         + 'this depends on it.',
    low: 'never in position', high: 'in position every time',
  }, {
    key: 'hold', title: 'Does it stay there under load?',
    plain: 'The usual finding is not a bad starting position — it is a good '
         + 'one that comes apart once the spring or the body weight goes on.',
    low: 'goes as soon as there is any load', high: 'holds through everything',
  }, {
    key: 'stack', title: 'Does the movement pass through it, or stop at it?',
    plain: 'A bone is only ever in a relationship with the ones above and '
         + 'below. When one segment does the work of several, that is where '
         + 'things get sore.',
    low: 'the whole movement hinges right here',
    high: 'shares it evenly with its neighbours',
  }];

  /* One question per joint the camera actually measured. The joint is where a
   * bone's behaviour becomes visible, and naming the measured angle puts the
   * coach's judgement beside the instrument's. */
  for (const joint of joints.slice(0, 2)) {
    if (typeof joint?.value !== 'number') continue;
    const label = String(joint.name ?? '').replace(/_/g, ' ');
    axes.push({
      key: `joint:${joint.name}`,
      title: `How much of the ${label} movement is controlled?`,
      plain: `The camera measured ${joint.value.toFixed(1)}° here this class. `
           + 'Range is not the question — control through it is.',
      low: 'the range is there but nothing controls it',
      high: 'every bit of it under control',
      bridge: true,
    });
  }

  return { axes, why: `These are about ${name}: where it starts, whether it `
                    + 'stays there, how it works with the segments either side, '
                    + 'and any angle the camera measured here.' };
}

/* ------------------------------------------------------------------- nerve */

function forNerve(record, context) {
  const name = record?.name?.en ?? 'this nerve';
  return {
    axes: [{
      key: 'symptom', title: 'Did they feel anything in this area?',
      plain: `Tingling, numbness, burning, pins and needles, or weakness — `
           + `anywhere ${name} reaches. Their words, not a conclusion.`,
      low: 'nothing at all today', high: 'it is what ended the class',
      inverted: true,
    }, {
      key: 'lasted', title: 'How long did it last?',
      plain: 'Gone within ten minutes of stopping is usually nothing. Still '
           + 'there when they left, spreading, or happening away from class '
           + 'is not, and is not yours to manage.',
      low: 'gone the moment they moved',
      high: 'still there when they left, or they get it at home',
      inverted: true,
    }],
    decision: {
      key: 'action', title: 'What did you do?',
      plain: 'The decision matters more than the score.',
      options: [
        ['carried', 'carried on'],
        ['modified', 'changed the exercise'],
        ['stopped', 'stopped the exercise'],
        ['referred', 'told them to get it checked'],
      ],
    },
    why: 'A nerve is not scored on how well it works — nothing here measures '
       + 'that. This is a record of what they reported, how long it lasted, '
       + 'and what you decided. It is not a diagnosis.',
  };
}
