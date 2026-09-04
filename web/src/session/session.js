/**
 * What this application can say about the person in front of it.
 *
 * The anatomy model knows what every structure is and what every exercise is
 * claimed to do. Until now it has never known who was doing them. A session
 * bundle is one person's recorded class, and this turns it into answers to the
 * questions the application already asks: click a muscle, what did *you* do
 * with it; open the lab, what worked hardest; open a brain region, which of the
 * exercises you actually did carry claims about it.
 *
 * **Four kinds of answer, and they are not interchangeable.**
 *
 * 1. `measured` -- a number computed from this person's video this session. Only
 *    muscles, and only through the joint moment of the group they belong to.
 * 2. `reference` -- a bone that articulates a measured joint, a nerve that
 *    supplies a measured muscle. Navigation, not observation.
 * 3. `research` -- a claim about exercise and the brain, carrying the tier,
 *    citation, effect size, population and caveat the anatomy side already
 *    holds. It is about the *exercises this person did*, never about their
 *    brain, and every sentence here says so.
 * 4. nothing -- the honest answer for most of four hundred and fifty-one
 *    structures, and it must not be dressed up as a zero.
 *
 * The third is the new one. It is the only thing in either project that could
 * not exist in one of them alone: the anatomy side has the evidence and no idea
 * who did what, and the measurement side watched somebody do it and has no
 * evidence table. Joining them is a lookup, not a finding, and the wording is
 * built so that a reader cannot mistake it for one.
 */
import { EXERCISE_BRAIN, TIERS, TIER_ORDER } from '../content/evidence.js';
import { EXERCISE } from '../content/exercises.js';
import { load, resolve } from './bundle.js';

export const MEASURED = 'measured';
export const REFERENCE = 'reference';
export const RESEARCH = 'research';

/** One person's session, indexed for the questions this application asks. */
export class Session {
  /**
   * @param {object} bundle   a `pilates-session-bundle`, already parsed
   * @param {object} registry the anatomy registry, for id lookups
   */
  constructor(bundle, registry) {
    this.bundle = load(bundle);
    this.registry = registry;

    /** structure id -> the bundle entry that lights it. */
    this.byId = new Map();
    /** structures the bundle names that this model does not have. */
    this.missing = [];
    for (const structure of this.bundle.structures ?? []) {
      const { record, via } = resolve(registry, structure);
      if (!record) { this.missing.push(structure); continue; }
      this.byId.set(record.id, { ...structure, id: record.id, via });
    }

    /** muscle group -> its one measured moment. */
    this.groups = new Map();
    for (const entry of this.byId.values()) {
      if (entry.tier !== MEASURED || !entry.from) continue;
      const group = entry.from.replace(/ peak moment$/, '');
      const existing = this.groups.get(group);
      if (!existing || entry.value > existing.value) {
        this.groups.set(group, { group, value: entry.value, unit: entry.unit,
                                 level: entry.level, share: entry.share ?? 0,
                                 members: [] });
      }
    }
    /* Membership is every muscle that acts at the group, not the ones whose
     * largest effort happened to be this group. Several cross two measured
     * joints -- the hamstrings are hip extensors and knee flexors both -- and
     * the bundle records the group that won in `from` and the rest in `also`.
     * Reading only `from` left the knee flexors listed as "gastrocnemius", the
     * one member that belongs to nothing else. */
    for (const entry of this.byId.values()) {
      if (entry.tier !== MEASURED || !entry.from) continue;
      for (const source of [entry.from, ...(entry.also ?? [])]) {
        this.groups.get(source.replace(/ peak moment$/, ''))?.members.push(entry);
      }
    }
    for (const group of this.groups.values()) {
      group.members.sort((a, b) => a.name.localeCompare(b.name));
    }

    /** quantity name -> the measured row, for the joints a bone articulates. */
    this.quantities = new Map();
    for (const q of this.bundle.quantities ?? []) this.quantities.set(q.name, q);

    this.claims = this.#claims();
  }

  get person() { return this.bundle.person; }
  get date() { return this.bundle.session?.date ?? ''; }
  get key() { return this.bundle.session?.key ?? ''; }
  get score() { return this.bundle.score ?? null; }
  get lighting() { return this.bundle.lighting ?? {}; }
  /** Present only on a bundle nobody was recorded for. Never inferred. */
  get synthetic() { return this.bundle.synthetic ?? null; }

  /**
   * The exercises this person did, as the anatomy library knows them.
   *
   * An exercise the bundle names and the library does not is kept, with
   * `known: false`. Dropping it would quietly shorten the list of what somebody
   * did to the list of what this application happens to have a record for.
   */
  exercises() {
    return (this.bundle.exercises ?? []).map((row) => {
      const record = EXERCISE[row.key] ?? null;
      return {
        ...row,
        known: !!record,
        name: record?.en?.name ?? row.key.replace(/[_-]/g, ' '),
        brain: record?.brain ?? [],
      };
    });
  }

  /**
   * Brain claims carried by the exercises this person actually did.
   *
   * **Counted, never summed into a level.** The obvious next move is to light
   * regions in proportion to how many claims name each one, and that would be a
   * fabrication in the shape of an instrument reading -- the anatomy side
   * already refuses it for exactly this reason, and doing it here because a
   * person is attached would be worse, not better. A count of claims is a fact
   * about a library. It is not a measurement of a brain, and there is no
   * measurement of a brain anywhere in either project.
   */
  #claims() {
    const out = new Map();       // region id -> claims, with who raised them
    for (const exercise of this.exercises()) {
      for (const key of exercise.brain) {
        const claim = EXERCISE_BRAIN[key];
        if (!claim) continue;
        for (const region of claim.structures) {
          if (!out.has(region)) out.set(region, new Map());
          const seen = out.get(region);
          if (!seen.has(key)) seen.set(key, { key, ...claim, from: [] });
          seen.get(key).from.push(exercise);
        }
      }
    }
    const flat = new Map();
    for (const [region, seen] of out) {
      const claims = [...seen.values()].sort(
        (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
      flat.set(region, claims);
    }
    return flat;
  }

  /**
   * Everything this session says about one structure, or null.
   *
   * Null is a real and common answer. Four hundred and fifty-one structures, of
   * which a good session lights about thirty.
   */
  about(id) {
    const record = this.registry.byId.get(+id);
    if (!record) return null;

    const claims = this.claims.get(+id);
    if (record.layer === 'brain') {
      if (!claims?.length) return null;
      return {
        kind: 'brain', tier: RESEARCH, record, claims,
        tiers: tierCounts(claims),
      };
    }

    const entry = this.byId.get(+id);
    if (!entry) return null;

    if (entry.tier === MEASURED) {
      const group = entry.from.replace(/ peak moment$/, '');
      return {
        kind: 'muscle', tier: MEASURED, record, entry,
        group: this.groups.get(group) ?? null,
        rank: this.rankOf(group),
        also: (entry.also ?? []).map((s) => s.replace(/ peak moment$/, '')),
      };
    }
    // A bone or a nerve: reference. It carries the joint or the group it is
    // attached to, and never a number of its own.
    const joint = entry.from && !entry.from.endsWith(' peak moment')
      ? entry.from : null;
    return {
      kind: record.kind === 'nerve' ? 'nerve' : 'bone', tier: REFERENCE,
      record, entry,
      joint: joint ? { name: joint, quantity: this.quantities.get(joint) ?? null }
                   : null,
      group: entry.from?.endsWith(' peak moment')
        ? this.groups.get(entry.from.replace(/ peak moment$/, '')) ?? null : null,
    };
  }

  /**
   * One quantity's line across every session this person has.
   *
   * Computed on the measurement side and carried in the file, verdict and noise
   * floor included, so the sparkline here, the chart on the printable page and
   * the sentence in the written report are the same rule rather than three
   * implementations of "did this change".
   */
  history(subject) {
    return this.bundle.history?.[subject] ?? null;
  }

  /** Every quantity measured at the joints a muscle group acts across. */
  jointsOf(source) {
    const group = source.replace(/ peak moment$/, '');
    const word = group.split(' ')[0];
    return [...this.quantities.values()].filter(
      (q) => q.valid && q.name.includes(word) && /^(left|right)_/.test(q.name));
  }

  /** Both sides of a joint, given one of them. */
  jointPair(name) {
    const bare = name.replace(/^(left|right)_/, '');
    return [...this.quantities.values()].filter(
      (q) => q.valid && q.name.replace(/^(left|right)_/, '') === bare
             && /^(left|right)_/.test(q.name));
  }

  /** Where a group sits among the ones measured this session, hardest first. */
  rankOf(group) {
    const order = [...this.groups.values()].sort((a, b) => b.value - a.value);
    const at = order.findIndex((g) => g.group === group);
    return at < 0 ? null : { place: at + 1, of: order.length };
  }

  /** Every measured group, hardest first. The lab's "what worked" panel. */
  ranked() {
    return [...this.groups.values()].sort((a, b) => b.value - a.value);
  }

  /** Every structure this session lights, for the lab's tables. */
  lit() { return [...this.byId.values()]; }

  /** Region ids the session's exercises carry claims about. */
  brainRegions() { return [...this.claims.keys()]; }
}

/** How many claims sit at each tier, strongest first. */
export function tierCounts(claims) {
  const counts = new Map();
  for (const claim of claims) counts.set(claim.tier, (counts.get(claim.tier) ?? 0) + 1);
  return TIER_ORDER.filter((t) => counts.has(t))
    .map((t) => ({ tier: t, n: counts.get(t), ...TIERS[t] }));
}
