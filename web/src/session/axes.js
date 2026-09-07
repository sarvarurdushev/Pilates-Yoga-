/**
 * What to ask about *this* structure, derived from *this* structure's anatomy.
 *
 * The mistake made twice before was a fixed list of questions: first five for
 * every class, then five per kind of structure. Both guessed, and both were
 * wrong almost everywhere, because the semimembranosus and the transversus
 * abdominis do not fail in the same way and asking them the same question
 * produces an answer about neither.
 *
 * Nothing here is invented. Every axis is built from a fact the atlas already
 * holds about that one structure:
 *
 * | Axis        | Comes from                                                |
 * |-------------|-----------------------------------------------------------|
 * | its job     | `actions` -- what this muscle is for, in its own words     |
 * | cover       | `synergists` -- who specifically takes over when it does not |
 * | release     | `antagonists` -- who has to let go for it to work          |
 * | what it feels like | `feels` -- where the student should notice it       |
 * | the known one | `dysfunction` -- the documented failure mode, for the 25 muscles that have one |
 * | against the number | the quantity the camera measured at this structure |
 *
 * So the psoas is asked about hip flexion and about whether the rectus femoris
 * is covering; the multifidus is asked about segmental stiffness and about the
 * erector spinae. Different muscles, different questions, and the difference
 * comes from the anatomy rather than from an opinion in this file.
 *
 * **Every axis is scored 0-10.** That is what makes it chartable, which is the
 * whole point of scoring it at all -- a verdict cannot be drawn as a line. The
 * scale is anchored per axis so that the number means something: 0 and 10 are
 * both written out, in the structure's own terms, wherever the atlas gives
 * enough to write them.
 */

/** 0 to 10, and both ends named. A number nobody can anchor is a number. */
export const SCALE = 10;

const first = (list, n = 2) => (Array.isArray(list) ? list.slice(0, n) : []);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/**
 * @param {object} record   the registry entry: kind, name, muscle, fma
 * @param {object} [context] {measured: {value, unit, from}, joints: [...]}
 * @returns {{axes: array, why: string}}
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
  const name = record?.name?.en ?? '';
  const axes = [];

  const actions = m?.actions?.en ?? '';
  if (actions) {
    axes.push({
      key: 'job', label: 'Its own job',
      ask: cap(actions) + '.',
      low: 'not contributing to it at all',
      high: 'doing all of it, cleanly, every rep',
    });
  }

  /* Named substitution. "Is something covering for it" is a useless question;
   * "is the gluteus maximus covering for it" is one a coach can answer by
   * looking, and the atlas already knows which muscles those are. */
  for (const other of first(m?.synergists, 2)) {
    axes.push({
      key: `cover:${other}`, label: `${cap(other)} covering`,
      ask: `Is ${other} doing this muscle's share as well as its own?`,
      low: 'it has taken over completely',
      high: 'each doing its own part',
    });
  }

  const anta = first(m?.antagonists, 1)[0];
  if (anta) {
    axes.push({
      key: `release:${anta}`, label: `${cap(anta)} releasing`,
      ask: `${cap(anta)} has to let go for this to work. Does it?`,
      low: 'held on throughout — nothing can move',
      high: 'lets go cleanly every rep',
    });
  }

  const feels = m?.en?.feels ?? '';
  if (feels) {
    axes.push({
      key: 'feel', label: 'Where they feel it',
      ask: feels,
      low: 'feels it somewhere else entirely',
      high: 'finds it there without being told',
    });
  }

  /* The documented failure mode, for the muscles that have one. Quoted rather
   * than paraphrased, so a coach can see what is being claimed and on whose
   * authority -- the same rule the rest of this application follows. */
  const known = m?.dysfunction?.en ?? '';
  if (known) {
    axes.push({
      key: 'known', label: 'The documented one',
      ask: known,
      low: 'exactly as described',
      high: 'no sign of it',
      cited: true,
    });
  }

  const measured = context.measured;
  if (measured) {
    axes.push({
      key: 'matches', label: 'Against the number',
      ask: `The camera measured ${measured.value} ${measured.unit} here this `
         + 'class. Does what you saw agree with it?',
      low: 'the number and the movement disagree completely',
      high: 'the number is telling the truth about what I saw',
      bridge: true,
    });
  }

  return {
    axes,
    why: m
      ? `Asked of ${name} specifically: its own actions, the muscles the atlas `
        + 'names as its synergists and antagonists, and what the camera '
        + 'measured here.'
      : 'The atlas has no entry for this one, so there is nothing specific to '
        + 'ask. Write what you saw.',
  };
}

/* -------------------------------------------------------------------- bone */

function forBone(record, context) {
  const name = record?.name?.en ?? 'this bone';
  const joints = context.joints ?? [];
  const axes = [{
    key: 'place', label: 'Where it sits',
    ask: `Position of ${name} at the start of the movement, and whether it `
       + 'stays there once load goes on.',
    low: 'never in position, and drifts further under load',
    high: 'in position and holds it under everything',
  }, {
    key: 'stack', label: 'Against its neighbours',
    ask: 'A bone is only ever in a relationship. Does the movement pass '
       + 'through it, or hinge at it?',
    low: 'the whole movement hinges here',
    high: 'shares the movement evenly with the segments either side',
  }];

  /* One axis per joint the camera actually measured an angle at. The joint is
   * where a bone's behaviour becomes visible, and naming the measured angle
   * puts the coach's judgement beside the instrument's. */
  for (const joint of joints.slice(0, 2)) {
    axes.push({
      key: `joint:${joint.name}`,
      label: `${cap(joint.name.replace(/_/g, ' '))}`,
      ask: `The camera measured ${joint.value.toFixed(1)}° here this class. `
         + 'How much of that range was controlled?',
      low: 'range is there but nothing controls it',
      high: 'every degree of it under control',
      bridge: true,
    });
  }

  axes.push({
    key: 'load', label: 'Under load',
    ask: 'What happens when the spring, the lever or the body weight goes on.',
    low: 'gives way, or they guard it',
    high: 'takes it without changing anything',
  });

  return { axes, why: `Asked of ${name}: placement, its relationship to the `
                    + 'segments either side, and any joint angle the camera '
                    + 'measured here.' };
}

/* ------------------------------------------------------------------- nerve */

function forNerve(record, context) {
  const name = record?.name?.en ?? 'this nerve';
  const roots = record?.muscle?.innervation?.roots ?? [];
  /* A nerve is not scored on performance. It is scored on how much it is
   * bothering the person, which is the only quantity a coach is in a position
   * to judge -- and the axis exists so the answer can be charted rather than
   * to invite a diagnosis. The decision is the point. */
  return {
    axes: [{
      key: 'symptom', label: 'How much it bothered them',
      ask: `Anything they reported in the area ${name} supplies${
        roots.length ? ` (${roots.join(', ')})` : ''} — tingling, numbness, `
        + 'burning, weakness. Their words, not a conclusion.',
      low: 'nothing at all today',
      high: 'the thing that ended the class',
      inverted: true,
    }, {
      key: 'lasted', label: 'How long it lasted',
      ask: 'Cleared within about ten minutes of stopping is generally '
         + 'unremarkable. Persisting, spreading, or happening away from class '
         + 'is not.',
      low: 'gone within seconds of changing position',
      high: 'still there when they left, or they get it away from class',
      inverted: true,
    }],
    decision: {
      key: 'action', label: 'What you did',
      options: [
        ['carried', 'carried on'],
        ['modified', 'modified the exercise'],
        ['stopped', 'stopped the exercise'],
        ['referred', 'told them to get it looked at'],
      ],
    },
    why: 'A nerve is not scored on performance. This records what they '
       + 'reported, how long it lasted, and what you decided — carry on, '
       + 'modify, or refer. It is a symptom record, not a diagnosis.',
  };
}
