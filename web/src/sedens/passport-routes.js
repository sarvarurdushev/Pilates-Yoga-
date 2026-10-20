// The Fitness Passport's hash routes and the module that draws each (see app.js, which merges these into its own
// tables). Kept apart from app.js, which starts the page when loaded, so tests can read them.
export const PASSPORT_ROUTES = [
  ["passport", "passport"],
  ["passport/history", "passport_history"],
  ["passport/workout/:id", "passport_workout"],
  ["passport/scans", "passport_scans"],
  ["passport/programs", "passport_programs"],
  ["passport/achievements", "passport_achievements"],
  ["passport/preferences", "passport_preferences"],
  ["passport/privacy", "passport_privacy"],
];

export const PASSPORT_MODULES = {
  passport: ["./passport.js", "overview"],
  passport_history: ["./passport.js", "history"],
  passport_workout: ["./passport.js", "workout"],
  passport_scans: ["./passport.js", "scans"],
  passport_programs: ["./passport.js", "programs"],
  passport_achievements: ["./passport.js", "achievements"],
  passport_preferences: ["./passport.js", "preferences"],
  passport_privacy: ["./passport.js", "privacy"],
};

/** The section bar: [id, route pattern]. Each id has a "pp.nav_<id>" label. */
export const PASSPORT_SECTIONS = [
  ["overview", "passport"],
  ["history", "passport/history"],
  ["scans", "passport/scans"],
  ["programs", "passport/programs"],
  ["achievements", "passport/achievements"],
  ["preferences", "passport/preferences"],
  ["privacy", "passport/privacy"],
];
