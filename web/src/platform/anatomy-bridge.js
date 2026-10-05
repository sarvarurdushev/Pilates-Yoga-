import { relatedRegion } from "./core.js";
import { feedbackMarkerRegions, feedbackMarkerPosition, feedbackMarkerLayout, feedbackSourceURL } from "./feedback-markers.js";

export function fullscreenRegionURL(pathname, search, hash, regionId) {
  const next = new URLSearchParams(search);
  next.set("region", regionId);
  next.set("layer", "region");
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
    feedback: client.notes,
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
  const markerLayer = document.createElement("div");
  markerLayer.id = "client-feedback-markers";
  markerLayer.setAttribute("aria-label", "Coach feedback marked on the body");
  document.querySelector("#stage")?.append(markerLayer);
  const leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.classList.add("client-feedback-leaders");
  leaders.setAttribute("aria-hidden", "true");
  let markedRegions = [];
  const currentFeedback = (context) => context.feedback || [];
  const markerSource = (context) => ({
    id: context.client?.id,
    notes: currentFeedback(context),
  });
  const placeMarkers = () => {
    if (!ready || !atlas || !currentContext || !markerLayer.isConnected) return;
    const stage = document.querySelector("#stage");
    const bounds = stage?.getBoundingClientRect();
    const camera = atlas.gfx?.camera;
    if (!bounds?.width || !bounds?.height || !camera) return;
    const focused = currentContext.layer === "region" || !currentContext.layer;
    const positions = [];
    markerLayer.querySelectorAll(".client-feedback-leader").forEach(line => { line.style.display = "none"; });
    for (const marked of markedRegions) {
      const button = markerLayer.querySelector(`[data-feedback-region="${marked.id}"]`);
      if (!button) continue;
      if (focused && marked.id !== currentContext.region?.id) {
        button.hidden = true;
        continue;
      }
      let projected = null;
      const joints = atlas.app.explode === 0
        ? marked.jointCoordinates.map(coord => atlas.jointCentre(coord)).filter(Boolean) : [];
      const jointAnchor = joints.length && joints.length === marked.jointCoordinates.length
        ? joints.reduce((sum, point) => sum.add(point), joints[0].clone().set(0, 0, 0)).divideScalar(joints.length) : null;
      const anchors = marked.anchorIds.map(id => atlas.structureAnchorOf(id)).filter(Boolean);
      const candidates = jointAnchor ? [jointAnchor] : marked.pairedAnchor
        ? [anchors.length === 2 ? anchors[0].clone().add(anchors[1]).multiplyScalar(0.5) : null]
        : anchors;
      for (const point of candidates) {
        if (!point) continue;
        point.project(camera);
        const position = feedbackMarkerPosition(point, bounds.width, bounds.height);
        if (position) {
          projected = position;
          break;
        }
      }
      button.hidden = true;
      if (projected) positions.push({ id: marked.id, ...projected });
    }
    for (const position of feedbackMarkerLayout(positions, bounds.width, bounds.height)) {
      const button = markerLayer.querySelector(`[data-feedback-region="${position.id}"]`);
      button.hidden = false;
      button.style.left = `${position.x.toFixed(1)}px`;
      button.style.top = `${position.y.toFixed(1)}px`;
      button.dataset.anchorX = position.anchorX.toFixed(1);
      button.dataset.anchorY = position.anchorY.toFixed(1);
      const leader = leaders.querySelector(`[data-feedback-leader="${position.id}"]`);
      if (leader && Math.hypot(position.x - position.anchorX, position.y - position.anchorY) > 1) {
        leader.setAttribute("x1", position.anchorX);
        leader.setAttribute("y1", position.anchorY);
        leader.setAttribute("x2", position.x);
        leader.setAttribute("y2", position.y);
        leader.style.display = "";
      }
    }
  };
  const markerTimer = window.setInterval(placeMarkers, 120);
  window.addEventListener("pagehide", () => window.clearInterval(markerTimer), { once: true });
  const markFeedback = async (context) => {
    markedRegions = feedbackMarkerRegions(markerSource(context), regionCatalog);
    await atlas.ensureStructureAnchors(markedRegions.flatMap(region => region.anchorIds));
    leaders.replaceChildren();
    markerLayer.replaceChildren(leaders);
    for (const marked of markedRegions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.feedbackRegion = marked.id;
      button.dataset.noteId = marked.noteId || "";
      button.className = "client-feedback-marker";
      button.hidden = true;
      const leader = document.createElementNS("http://www.w3.org/2000/svg", "line");
      leader.classList.add("client-feedback-leader");
      leader.dataset.feedbackLeader = marked.id;
      leader.style.display = "none";
      leaders.append(leader);
      button.textContent = String(marked.count);
      button.title = `${marked.name}: ${marked.count} coach feedback note${marked.count === 1 ? "" : "s"}`;
      button.setAttribute("aria-label", `Open ${marked.name}, ${marked.count} coach feedback note${marked.count === 1 ? "" : "s"}`);
      button.onclick = async () => {
        if (parent !== window) {
          tell("motion-atlas-feedback-region", { region_id: marked.id, note_id: marked.noteId });
          return;
        }
        const region = regionCatalog.find((entry) => entry.id === marked.id);
        if (!region) return;
        const client = await selectedClient();
        const next = new URLSearchParams(location.search);
        next.set("region", region.id);
        next.set("layer", "region");
        history.replaceState(null, "", location.pathname + "?" + next + location.hash);
        query.set("region", region.id);
        query.set("layer", "region");
        syncReturnLinks(region.id);
        apply(contextForRegion(currentContext, client, region, null));
      };
      markerLayer.append(button);
    }
    placeMarkers();
  };
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
    ...(currentContext?.analysis_id ? { id: currentContext.analysis_id } : {}),
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
    syncReturnLinks(context.region.id);
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
      } else if (context.layer === "feedback") {
        await atlas.setIsolate(null);
        for (const name of [
          "bones_full", "muscles_full", "connective", "nervous",
        ]) await atlas.setLayer(name, false);
        await atlas.setLayer("skeleton", true);
        await atlas.setLayer("muscles_superficial", true);
        atlas.fitView();
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
        const sourced = (context.feedback || []).filter((note) =>
          relatedRegion(note.region_id, r.id));
        if (sourced.length) {
          const sources = document.createElement("div");
          sources.className = "client-feedback-sources";
          for (const note of sourced) {
            const sourceURL = feedbackSourceURL(context.client.id, note);
            if (!sourceURL) {
              const absent = document.createElement("p");
              absent.textContent = "Source visit not recorded for this feedback.";
              sources.append(absent);
            }
            const link = document.createElement("a");
            link.href = sourceURL || "/#" + new URLSearchParams({
              page: "client", client: context.client.id, tab: "notes", region: r.id,
              ...(note.id ? { note: note.id } : {}),
            });
            link.target = "_top";
            link.textContent = (sourceURL ? "Source visit for “" : "Open feedback “") + note.text.slice(0, 48) + (note.text.length > 48 ? "…" : "") + "” →";
            sources.append(link);
          }
          panel.append(sources);
        }
        if (context.layer !== "feedback" && (context.feedback || []).some((note) => note.region_id)) {
          const showAll = document.createElement("button");
          showAll.type = "button";
          showAll.textContent = "Show all feedback on body";
          showAll.onclick = () => {
            const next = new URLSearchParams(location.search);
            next.set("layer", "feedback");
            history.replaceState(null, "", location.pathname + "?" + next + location.hash);
            query.set("layer", "feedback");
            apply({ ...context, layer: "feedback", structure_id: null, exercise: null });
          };
          panel.append(showAll);
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
      await markFeedback(context);
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
        const sourceId = c.analyses.some((analysis) => analysis.id === query.get("analysis"))
          ? query.get("analysis") : null;
        const region =
          me.regions.find((r) => r.id === query.get("region")) || me.regions[0];
        await apply({
          client: { id: c.id, name: c.name },
          region,
          analysis_id: sourceId,
          exercise: query.get("exercise"),
          notes: c.notes
            .filter((n) => relatedRegion(n.region_id, region.id))
            .map((n) => n.text),
          feedback: c.notes,
          regions: me.regions,
          layer: query.get("layer") === "region" ? "region" : c.notes.length ? "feedback" : "region",
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
