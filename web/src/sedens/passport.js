// The customer's Fitness Passport pages (#/passport/...). Each function is a page module for app.js: it loads the
// customer's own data from /sedens/passport/..., draws it with passport-render.js and wires the few buttons.
// The server decides who may read it (a student account, about themself only); this file only explains a refusal.
import { sedens, ApiError } from "./api.js";
import { t, lang, setLang } from "./i18n.js";
import { $, esc, problem } from "./ui.js";
import * as view from "./passport-render.js";

const withLang = (route) => `${route}${route.includes("?") ? "&" : "?"}lang=${lang()}`;
const get = (route) => sedens(withLang(route));
const isStudent = (me) => me?.role === "student";
const isCustomerOnly = (error) => error instanceof ApiError && error.status === 403 && error.code === "passport_customer_only";

/** Load, draw and bind one section. Signed-out visitors and staff accounts get a plain explanation instead. */
async function open(ctx, { title, active, load, draw, bind }) {
  const back = ctx.backLink();
  if (!ctx.me) return ctx.page(view.gate("signin", { back }));
  if (!isStudent(ctx.me)) return ctx.page(view.gate("staff", { back }));
  let data;
  try {
    data = await load();
  } catch (error) {
    if (ctx.stale()) return;
    if (isCustomerOnly(error)) return ctx.page(view.gate("staff", { back }));
    ctx.page(view.shell({
      title, active, back,
      body: `${ctx.notice(problem(error), "error")}<p><button id="pp-retry">${esc(t("pp.retry"))}</button></p>`,
    }));
    $("#pp-retry")?.addEventListener("click", () => ctx.refresh());
    return;
  }
  if (ctx.stale()) return;
  ctx.page(draw(data, { back: active === "overview" ? back : "", facility: ctx.me.organization?.display_name || "" }));
  // On a phone the section bar scrolls sideways: bring the current section into view inside it.
  const bar = $(".pp-nav ul");
  const here = bar?.querySelector("[aria-current]");
  if (bar && here) bar.scrollLeft = here.offsetLeft - (bar.clientWidth - here.offsetWidth) / 2;
  bind?.(data);
}

/** Announce a result in the page's polite status line and move the reading position to it. */
function say(text, { focus = true } = {}) {
  const status = $("#pp-status");
  if (!status) return;
  status.textContent = text;
  if (focus) status.focus({ preventScroll: false });
}

// -- #/passport -------------------------------------------------------------------------------

export const overview = (ctx) =>
  open(ctx, {
    title: t("pp.title"),
    active: "overview",
    load: () => get("passport/overview"),
    draw: (data, { back, facility }) => view.overview(data, { facility, back }),
  });

// -- #/passport/history -----------------------------------------------------------------------

export const history = (ctx) =>
  open(ctx, {
    title: t("pp.hist_title"),
    active: "history",
    load: () => get("passport/history?limit=20"),
    draw: (data, { back, facility }) => view.shell({ title: t("pp.hist_title"), active: "history", body: view.historyPage(data, { facility }), data, back }),
    bind: () => bindMore(ctx),
  });

function bindMore(ctx) {
  const button = $("#pp-more");
  if (!button) return;
  const facility = ctx.me.organization?.display_name || "";
  button.addEventListener("click", async () => {
    button.disabled = true;
    say(t("pp.hist_loading"), { focus: false });
    try {
      const data = await get(`passport/history?limit=20&before=${encodeURIComponent(button.dataset.before)}`);
      if (ctx.stale()) return;
      const list = $("#pp-history-list");
      const before = list.children.length;
      list.insertAdjacentHTML("beforeend", data.items.map((c) => view.historyCard(c, { facility })).join(""));
      list.children[before]?.querySelector("h2")?.focus();
      say(t("pp.hist_added"), { focus: false });
      if (data.next_before) {
        button.dataset.before = data.next_before;
        button.disabled = false;
      } else {
        button.insertAdjacentHTML("afterend", `<p class="pp-muted" id="pp-end">${esc(t("pp.hist_end"))}</p>`);
        button.remove();
      }
    } catch (error) {
      button.disabled = false;
      say(problem(error));
    }
  });
}

// -- #/passport/workout/:id -------------------------------------------------------------------

export async function workout(ctx) {
  const back = `<a class="sd-back" href="#/passport/history">← ${esc(t("pp.back_history"))}</a>`;
  if (!ctx.me) return ctx.page(view.gate("signin", { back: ctx.backLink() }));
  if (!isStudent(ctx.me)) return ctx.page(view.gate("staff", { back: ctx.backLink() }));
  let data;
  try {
    data = await get(`passport/workout?id=${encodeURIComponent(ctx.params.id)}`);
  } catch (error) {
    if (ctx.stale()) return;
    if (isCustomerOnly(error)) return ctx.page(view.gate("staff", { back: ctx.backLink() }));
    const missing = error instanceof ApiError && error.status === 404;
    ctx.page(view.shell({ title: t("pp.wk_title"), active: "history", back, body: ctx.notice(missing ? t("pp.wk_missing") : problem(error), "error") }));
    return;
  }
  if (ctx.stale()) return;
  ctx.page(view.workoutDetail(data, { back }));
}

// -- #/passport/scans -------------------------------------------------------------------------

export async function scans(ctx) {
  await open(ctx, {
    title: t("pp.scans_title"),
    active: "scans",
    load: async () => {
      const [list, comparison] = await Promise.all([get("passport/scans"), get("passport/scans/compare")]);
      return { list, comparison: comparison.comparison };
    },
    draw: ({ list, comparison }, { back }) => view.scansPage(list, comparison, { back }),
  });
  // A link from a workout opens the list at that scan.
  const target = ctx.query.scan ? document.getElementById(`scan-${ctx.query.scan}`) : null;
  if (target && !ctx.stale()) {
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  }
}

// -- #/passport/programs and #/passport/achievements ------------------------------------------

export const programs = (ctx) =>
  open(ctx, { title: t("pp.prog_title"), active: "programs", load: () => get("passport/programs"), draw: (data, { back }) => view.programsPage(data, { back }) });

export const achievements = (ctx) =>
  open(ctx, { title: t("pp.ach_title"), active: "achievements", load: () => get("passport/achievements"), draw: (data, { back }) => view.achievementsPage(data, { back }) });

// -- #/passport/preferences -------------------------------------------------------------------

export const preferences = (ctx) =>
  open(ctx, {
    title: t("pp.pref_title"),
    active: "preferences",
    load: () => get("passport/preferences"),
    draw: (data, { back }) => view.preferencesPage(data, { back }),
    bind: () => {
      const form = $("#pp-prefs");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button");
        const body = { lang: lang() };
        for (const [name] of view.PREFERENCE_KEYS) body[name] = form.elements[name].value || null;
        button.disabled = true;
        say(t("pp.pref_saving"), { focus: false });
        try {
          const saved = await sedens("passport/preferences", body);
          if (ctx.stale()) return;
          const chosen = saved.preferences?.language;
          // Choosing a language here also switches this page to it.
          if (chosen && chosen !== lang()) {
            setLang(chosen);
            ctx.refresh();
            return;
          }
          button.disabled = false;
          say(t("pp.pref_saved"));
        } catch (error) {
          button.disabled = false;
          say(problem(error));
        }
      });
    },
  });

// -- #/passport/privacy -----------------------------------------------------------------------

export const privacy = (ctx) =>
  open(ctx, {
    title: t("pp.priv_title"),
    active: "privacy",
    load: () => get("passport/privacy"),
    draw: (data, { back }) => view.privacyPage(data, { back }),
    bind: (data) => bindPrivacy(ctx, data),
  });

function bindPrivacy(ctx, first) {
  let data = first;
  const redraw = (patch = {}) => {
    data = { ...data, ...patch };
    const body = $("#pp-body");
    if (body) body.innerHTML = view.privacyBody(data);
    wire();
  };
  // Run an action; a failure is said in the status line and the buttons are left to try again.
  const run = async (button, action) => {
    if (button) button.disabled = true;
    try {
      await action();
    } catch (error) {
      if (button) button.disabled = false;
      say(problem(error));
    }
  };
  const reload = async () => {
    const fresh = await get("passport/privacy");
    if (!ctx.stale()) redraw(fresh);
  };
  function wire() {
    document.querySelectorAll("[data-withdraw]").forEach((button) =>
      button.addEventListener("click", () =>
        run(button, async () => {
          // The current wording's version, read now: a decision is stored with the text it was made on.
          const texts = await sedens("consent/texts");
          await sedens("consents", { kind: button.dataset.withdraw, text_version: texts[button.dataset.withdraw].version, granted: false });
          await reload();
          say(t("pp.consent_withdrawn_done"));
        }),
      ),
    );
    const confirmBox = $("#pp-photos-confirm");
    $("[data-photos-delete]")?.addEventListener("click", (event) => {
      confirmBox.hidden = false;
      event.currentTarget.hidden = true;
      $("#pp-photos-confirm-title").focus();
    });
    $("[data-photos-cancel]")?.addEventListener("click", () => {
      confirmBox.hidden = true;
      const open = $("[data-photos-delete]");
      open.hidden = false;
      open.focus();
    });
    $("[data-photos-confirm]")?.addEventListener("click", (event) =>
      run(event.currentTarget, async () => {
        const result = await sedens("passport/privacy/photos/delete", { lang: lang() });
        if (ctx.stale()) return;
        redraw({ photos: result.photos });
        say(t("pp.photos_deleted", { n: result.deleted_photos }));
      }),
    );
    $("#pp-erase")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      run(form.querySelector("button"), async () => {
        const result = await sedens("passport/privacy/request", { message: form.elements.message.value, lang: lang() });
        if (ctx.stale()) return;
        redraw({ requests: result.requests });
        say(t("pp.erase_sent"));
      });
    });
    document.querySelectorAll("[data-withdraw-request]").forEach((button) =>
      button.addEventListener("click", () =>
        run(button, async () => {
          const result = await sedens("passport/privacy/request/withdraw", { id: button.dataset.withdrawRequest, lang: lang() });
          if (ctx.stale()) return;
          redraw({ requests: result.requests });
          say(t("pp.erase_withdrawn"));
        }),
      ),
    );
  }
  wire();
}
