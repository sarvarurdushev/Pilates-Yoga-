import test from "node:test";
import assert from "node:assert/strict";

globalThis.location = {hash: "#page=client&client=client-one", search: ""};
const { state } = await import("../src/platform/core.js");
const { anatomy, scans } = await import("../src/platform/anatomy.js");
const { library } = await import("../src/platform/library.js");

const client = {
  id: "client-one", name: "Avery", programs: [], program_history: [],
  sessions: [], analyses: [], progress: [], notes: [], observations: [], scans: [],
};

test("the body-map client picker gives an action when the role has no clients", async () => {
  const root = {innerHTML: ""};
  state.client = null;
  state.me = {role: "student", students: [], regions: []};
  await anatomy(root);
  assert.match(root.innerHTML, /Your client record is not linked/);
  assert.match(root.innerHTML, /Ask your coach or studio administrator/);
  assert.doesNotMatch(root.innerHTML, /Open clients/);

  state.me = {role: "coach", students: [], regions: []};
  await anatomy(root);
  assert.match(root.innerHTML, /No clients available here/);
  assert.match(root.innerHTML, /href="#page=clients"/);
});

test("empty scan records direct Students to their Coach and staff to the upload action", async () => {
  const root = {innerHTML: ""};
  const detail = {innerHTML: ""};
  const upload = {};
  const priorDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      if (selector === "#scan-detail") return detail;
      if (selector === "#scan-upload" && root.innerHTML.includes('id="scan-upload"')) return upload;
      return null;
    },
  };
  state.client = client;
  try {
    state.me = {role: "student", regions: []};
    await scans(root);
    assert.match(root.innerHTML, /No imaging records have been shared with you yet/);
    assert.match(detail.innerHTML, /Ask your coach/);
    assert.doesNotMatch(root.innerHTML, /id="scan-upload"/);
    assert.doesNotMatch(detail.innerHTML, /Upload an existing/);

    state.me = {role: "coach", regions: []};
    await scans(root);
    assert.match(root.innerHTML, /id="scan-upload"/);
    assert.match(root.innerHTML, /No scans saved for this client/);
    assert.match(detail.innerHTML, /Upload an existing image or DICOM file/);
  } finally {
    globalThis.document = priorDocument;
    state.client = null;
  }
});

test("an unavailable assigned program is not presented as an unassigned client", async () => {
  const root = {
    innerHTML: "",
    querySelector(selector) {
      return selector === "#pd-retry-program" && this.innerHTML.includes('id="pd-retry-program"')
        ? {onclick: null} : null;
    },
    querySelectorAll() { return []; },
  };
  const priorFetch = globalThis.fetch;
  state.me = {role: "student", regions: []};
  state.client = {...client, programs: [{program_id: "missing-program", starts_on: "2026-09-01"}]};
  globalThis.fetch = async (url) => ({
    ok: !String(url).includes("/record?"),
    status: String(url).includes("/record?") ? 404 : 200,
    json: async () => String(url).includes("/record?") ? {error: "Program not found"} : {items: []},
  });
  try {
    await library(root, "programs");
    assert.match(root.innerHTML, /Assigned program could not be opened/);
    assert.match(root.innerHTML, /Ask your coach to check the plan/);
    assert.match(root.innerHTML, /Retry loading program/);
    assert.match(root.innerHTML, /tab=sessions/);
    assert.doesNotMatch(root.innerHTML, /No program assigned yet|Create program/);

    state.me = {role: "coach", regions: []};
    await library(root, "programs");
    assert.match(root.innerHTML, /Check the program record or ask an administrator to restore it/);
    assert.match(root.innerHTML, /Review client visits/);
    assert.doesNotMatch(root.innerHTML, /No program assigned yet|Create program|Use for Avery/);
  } finally {
    globalThis.fetch = priorFetch;
    state.client = null;
  }
});

test("a never-assigned program gives role-specific next steps", async () => {
  const root = {
    innerHTML: "",
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const priorFetch = globalThis.fetch;
  state.client = {...client};
  globalThis.fetch = async () => ({ok: true, status: 200, json: async () => ({items: []})});
  try {
    state.me = {role: "student", regions: []};
    await library(root, "programs");
    assert.match(root.innerHTML, /No program assigned yet/);
    assert.match(root.innerHTML, /View your sessions/);
    assert.doesNotMatch(root.innerHTML, /id="pd-retry-program"|Create program/);

    state.me = {role: "coach", regions: []};
    await library(root, "programs");
    assert.match(root.innerHTML, /Build a plan for this client/);
    assert.match(root.innerHTML, /data-edit="programs"/);
    assert.doesNotMatch(root.innerHTML, /Assigned program could not be opened/);
  } finally {
    globalThis.fetch = priorFetch;
    state.client = null;
  }
});

test("a filtered exercise search offers a working clear-filters action", async () => {
  const controls = new Map([
    ["[name=repertoire-search]", {value: "unmatched"}],
    ["[name=region]", {value: "right_shoulder"}],
    ["[name=category]", {value: "Pilates"}],
    ["#repertoire-count", {textContent: ""}],
    ["#repertoire-list", {innerHTML: ""}],
    ["#repertoire-prev", {disabled: false}],
    ["#repertoire-next", {disabled: false}],
  ]);
  const root = {
    innerHTML: "",
    isConnected: true,
    querySelector(selector) {
      if (selector === "#repertoire-clear" &&
          controls.get("#repertoire-list").innerHTML.includes('id="repertoire-clear"'))
        return controls.get("#repertoire-clear");
      return controls.get(selector) || null;
    },
    querySelectorAll(selector) {
      return selector === "input,select"
        ? [controls.get("[name=repertoire-search]"), controls.get("[name=region]"), controls.get("[name=category]")]
        : [];
    },
  };
  const clear = {onclick: null};
  controls.set("#repertoire-clear", clear);
  const priorFetch = globalThis.fetch;
  const calls = [];
  state.me = {role: "coach", regions: []};
  state.client = null;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {ok: true, status: 200, json: async () => ({items: [], total: 0})};
  };
  try {
    await library(root, "exercises");
    assert.match(controls.get("#repertoire-list").innerHTML, /Clear filters/);
    assert.equal(typeof clear.onclick, "function");
    clear.onclick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(controls.get("[name=repertoire-search]").value, "");
    assert.equal(controls.get("[name=region]").value, "");
    assert.equal(controls.get("[name=category]").value, "");
    assert.equal(calls.length, 2);
    assert.match(calls[0], /q=unmatched/);
    assert.match(calls[1], /q=&region=&category=/);
    assert.match(controls.get("#repertoire-list").innerHTML, /No exercises have been added here yet/);
  } finally {
    globalThis.fetch = priorFetch;
  }
});

test("historical feedback exposes its absent visit and the staff repair action without borrowing a date", async () => {
  const { feedbackVisitDisclosure } = await import("../src/platform/feedback-source.js");
  const notesHTML = (notes) => notes.map((n) => feedbackVisitDisclosure(n, {role:state.me.role, clientId:state.client.id, inlineEdit:true})).join("");
  const { linkedNotes, markerVisitHTML } = await import("../src/platform/anatomy.js");
  const note = {id:"old-note",region_id:"right_shoulder",author_id:"coach-1",
    created_at:"2026-09-30T10:00:00Z",text:"Supported practice",visibility:"student",detail:{source:"coach_entered"}};
  state.client = {...client, observations:[], sessions:[{id:"same-time-visit",performed_at:note.created_at}]};
  state.me = {role:"coach",user:{id:"coach-1",name:"Casey"},coaches:[],regions:[]};
  for (const html of [notesHTML([note]), linkedNotes([note],state.client)]) {
    assert.match(html,/Source visit not recorded/);
    assert.match(html,/connect.*(?:exact|known) visit/);
    assert.doesNotMatch(html,/session=same-time-visit/);
  }
  state.me.role = "student";
  for (const html of [notesHTML([note]), linkedNotes([note],state.client)]) {
    assert.match(html,/Source visit not recorded/);
    assert.doesNotMatch(html,/Edit feedback|connect (?:the exact|a known) visit/);
  }
  for (const linked of [{...note,session_id:"exact-visit"},{...note,analysis_id:"exact-assessment"}]) {
    assert.equal(notesHTML([linked]), "");
    const html = linkedNotes([linked],state.client);
    assert.doesNotMatch(html,/Source visit not recorded/);
    assert.match(html,linked.session_id ? /session=exact-visit/ : /assessment=exact-assessment/);
  }
  assert.match(markerVisitHTML({id:"old-marker",scan_id:"linked-scan",created_at:note.created_at}),/Visit not recorded · general annotation/);
  assert.doesNotMatch(markerVisitHTML({scan_id:"linked-scan"}),/href/);
  assert.match(markerVisitHTML({session_id:"marker-own-visit",scan_id:"linked-scan"}),/session=marker-own-visit/);
});
