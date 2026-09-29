import { relatedRegion } from "./core.js";

export function fullscreenRegionURL(pathname, search, hash, regionId) {
  const next = new URLSearchParams(search);
  next.set("region", regionId);
  return pathname + "?" + next + hash;
}

export function contextForRegion(previous, client, region, structureId) {
  return {
    ...previous,
    client: { id: client.id, name: client.name },
    region,
    layer: "region",
    exercise: null,
    structure_id: structureId,
    notes: client.notes
      .filter((note) => relatedRegion(note.region_id, region.id))
      .map((note) => note.text),
  };
}

/** Same-origin client context, real atlas IDs, and bounded asynchronous loading. */
const query = new URLSearchParams(location.search);
if (query.get("platform") === "1") {
  let ready = false,
    pending = null,
    applying = false,
    atlas = null,
    regionCatalog = null,
    clientRecord = null,
    currentContext = null;
  const panel = document.createElement("aside");
  panel.id = "motion-context-panel";
  Object.assign(panel.style, {
    position: "absolute",
    left: "18px",
    bottom: "18px",
    maxWidth: "min(420px,80vw)",
    maxHeight: "25vh",
    overflow: "auto",
    zIndex: "40",
    background: "#081422ed",
    border: "1px solid #344e69",
    borderRadius: "8px",
    padding: "12px",
    color: "#dceaff",
    font: "12px/1.5 system-ui",
  });
  document.body.append(panel);
  panel.hidden = parent !== window;
  const returnLinks = [...document.querySelectorAll('a[href="/#home"]')];
  const returnURL = (regionId) => "/#" + new URLSearchParams({
    page: "client", client: query.get("client"), tab: "anatomy",
    region: regionId,
    ...(query.get("analysis") ? { id: query.get("analysis") } : {}),
  });
  const syncReturnLinks = (regionId) => returnLinks.forEach((link) => {
    link.href = returnURL(regionId);
    link.target = "_top";
    link.textContent = "← Return to client workspace";
  });
  syncReturnLinks(query.get("region"));

  const tell = (type, data = {}) => {
    if (parent !== window)
      parent.postMessage({ type, ...data }, location.origin);
  };
  const availableRegions = async () => {
    if (regionCatalog) return regionCatalog;
    const response = await fetch("/platform/me", { credentials: "same-origin" });
    if (!response.ok) throw Error("Sign in to select body regions.");
    regionCatalog = (await response.json()).regions || [];
    return regionCatalog;
  };
  const selectedClient = async () => {
    if (clientRecord) return clientRecord;
    const response = await fetch(
      "/platform/client?id=" + encodeURIComponent(query.get("client")),
      { credentials: "same-origin" },
    );
    if (!response.ok) throw Error("Sign in to view this client.");
    clientRecord = await response.json();
    return clientRecord;
  };
  document.addEventListener("motion-anatomy-selection", async (event) => {
    const structureId = Number(event.detail?.structure_id);
    if (!Number.isInteger(structureId)) return;
    try {
      const catalog = await availableRegions();
      const region = catalog.find((entry) =>
        (entry.structures || []).some((part) => Number(part.id) === structureId),
      );
      if (parent !== window) {
        tell("motion-atlas-selection", {
          structure_id: structureId,
          region_id: region?.id || null,
        });
      } else if (region) {
        const client = await selectedClient();
        history.replaceState(null, "", fullscreenRegionURL(
          location.pathname, location.search, location.hash, region.id,
        ));
        query.set("region", region.id);
        syncReturnLinks(region.id);
        apply(contextForRegion(currentContext, client, region, structureId));
      } else {
        panel.textContent = "This atlas structure has no mapped coaching region. Select a marked body area in the client workspace.";
      }
    } catch {
      if (parent !== window) {
        tell("motion-atlas-selection", {
          structure_id: structureId,
          region_id: null,
        });
      } else {
        panel.textContent = "This body region could not load. Return to the client workspace and try again.";
      }
    }
  });
  const error = (e) => {
    panel.textContent =
      "The 3D viewer could not open. Enable WebGL/hardware acceleration and reload. Your linked notes and scans remain available in the client workspace.";
    tell("motion-atlas-error", { message: panel.textContent });
    console.error(e);
  };
  async function apply(context) {
    currentContext = context;
    if (Array.isArray(context.regions)) regionCatalog = context.regions;
    pending = context;
    if (!ready || applying) return;
    applying = true;
    pending = null;
    const r = context.region;
    try {
      if (context.exercise) {
        await atlas.setExercise(context.exercise);
        atlas.setPlaying(true);
      } else if (context.layer === "whole") {
        await atlas.setIsolate(null);
        for (const name of [
          "bones_full",
          "muscles_full",
          "connective",
          "nervous",
        ])
          await atlas.setLayer(name, false);
        await atlas.setLayer("skeleton", true);
        await atlas.setLayer("muscles_superficial", true);
      } else if (context.layer && context.layer !== "region") {
        await atlas.setIsolate(null);
        for (const name of [
          "skeleton",
          "muscles_superficial",
          "muscles_deep",
          "organs",
          "arteries",
          "veins",
          "airways",
          "nerves_cranial",
          "heart_detail",
          "detail",
          "organs_full",
          "bones_full",
          "muscles_full",
          "connective",
          "nervous",
        ])
          await atlas.setLayer(name, name === context.layer);
      } else {
        const ids = context.structure_id
          ? [context.structure_id]
          : r.structures.map((s) => s.id);
        await atlas.setIsolate(ids);
        atlas.selectStructure(ids[0], { auto: true });
        atlas.flyToGroup(ids);
      }
      if (parent === window) {
        panel.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = context.client.name + " · " + r.name;
        panel.append(title);
        const p = document.createElement("p");
        p.textContent = r.explanation;
        panel.append(p);
        const notes = context.notes || [];
        if (notes.length) {
          const details = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = `Coach feedback (${notes.length})`;
          details.append(summary);
          for (const note of notes) {
            const n = document.createElement("p");
            n.textContent = note;
            details.append(n);
          }
          panel.append(details);
        }
        const back = document.createElement("a");
        back.href = "/#" + new URLSearchParams({
          page: "client", client: context.client.id, tab: "anatomy", region: r.id,
          ...(context.analysis_id ? { id: context.analysis_id } : {}),
        });
        back.textContent = "Return to this client’s workspace";
        back.style.color = "#7aceff";
        back.target = "_top";
        panel.append(back);
      }
      tell("motion-atlas-context", {
        client_id: context.client.id,
        region_id: r.id,
        structures: r.structures.map((s) => s.id),
      });
    } catch (e) {
      error(e);
    } finally {
      applying = false;
      if (pending) apply(pending);
    }
  }
  window.addEventListener("message", (e) => {
    if (
      e.origin === location.origin &&
      e.source === parent &&
      e.data?.type === "motion-context"
    )
      apply(e.data);
  });
  const start = async () => {
    try {
      atlas = await import("../main.js");
      if (!atlas.isAnatomyReady())
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("Atlas loading timed out")),
            90000,
          );
          document.addEventListener(
            "motion-anatomy-ready",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      ready = true;
      tell("motion-atlas-ready");
      if (pending) await apply(pending);
      else {
        const req = async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw Error("Sign in to view this client.");
          return r.json();
        };
        const me = await req("/platform/me");
        const c = await selectedClient();
        const region =
          me.regions.find((r) => r.id === query.get("region")) || me.regions[0];
        await apply({
          client: { id: c.id, name: c.name },
          region,
          analysis_id: query.get("analysis"),
          exercise: query.get("exercise"),
          notes: c.notes
            .filter((n) => relatedRegion(n.region_id, region.id))
            .map((n) => n.text),
        });
      }
    } catch (e) {
      error(e);
    }
  };
  start();
}

// A note belongs on a scan when it names that scan or its source assessment.
// Sharing only the same body region is not an evidence link.
export function scanLinkedNotes(notes, scan) {
  return (notes || []).filter((note) =>
    note.scan_id === scan.id
      ? (!note.analysis_id || !scan.analysis_id || note.analysis_id === scan.analysis_id)
      : !note.scan_id && Boolean(scan.analysis_id) && note.analysis_id === scan.analysis_id);
}
