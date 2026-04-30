import { createEventFeed } from "./EventFeed.js";
import { createEventDetail } from "./EventDetail.js";

const SVG_W = 380;
const SVG_H = 180;
// Scale: 1 metre = N pixels in SVG
const SCALE = 12;
const CENTER_Y = SVG_H / 2;
const ORIGIN_X = 40;

function metresToX(m) {
  return ORIGIN_X + m * SCALE;
}

function clampX(x) {
  return Math.max(8, Math.min(SVG_W - 8, x));
}

/**
 * Build a simple SVG entity visualizer.
 * @param {string} side - "generic" | "physics"
 */
function makeSvg(side) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", SVG_W);
  svg.setAttribute("height", SVG_H);
  svg.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);

  // Ground line
  const ground = document.createElementNS(ns, "line");
  ground.setAttribute("x1", "0");
  ground.setAttribute("y1", String(CENTER_Y + 24));
  ground.setAttribute("x2", String(SVG_W));
  ground.setAttribute("y2", String(CENTER_Y + 24));
  ground.setAttribute("stroke", "#2d3142");
  ground.setAttribute("stroke-width", "1");
  svg.appendChild(ground);

  // Threshold circle (dashed, on the forklift)
  const threshCircle = document.createElementNS(ns, "circle");
  threshCircle.setAttribute("cy", String(CENTER_Y));
  threshCircle.setAttribute("stroke-dasharray", "4 3");
  threshCircle.setAttribute("fill", "none");
  threshCircle.setAttribute("stroke-width", "1");
  if (side === "generic") {
    threshCircle.setAttribute("stroke", "#ff6b6b");
  } else {
    threshCircle.setAttribute("stroke", "#ffa94d");
  }
  svg.appendChild(threshCircle);

  // Forklift dot
  const fl = document.createElementNS(ns, "circle");
  fl.setAttribute("r", "9");
  fl.setAttribute("cy", String(CENTER_Y));
  fl.setAttribute("fill", "#e67e22");
  fl.setAttribute("stroke", "#f39c12");
  fl.setAttribute("stroke-width", "1.5");
  svg.appendChild(fl);

  // Forklift label
  const flLabel = document.createElementNS(ns, "text");
  flLabel.setAttribute("y", String(CENTER_Y - 14));
  flLabel.setAttribute("fill", "#e67e12");
  flLabel.setAttribute("font-size", "9");
  flLabel.setAttribute("text-anchor", "middle");
  flLabel.textContent = "Forklift";
  svg.appendChild(flLabel);

  // Worker dot
  const wk = document.createElementNS(ns, "circle");
  wk.setAttribute("r", "7");
  wk.setAttribute("cy", String(CENTER_Y));
  wk.setAttribute("fill", "#3498db");
  wk.setAttribute("stroke", "#5dade2");
  wk.setAttribute("stroke-width", "1.5");
  svg.appendChild(wk);

  // Worker label
  const wkLabel = document.createElementNS(ns, "text");
  wkLabel.setAttribute("y", String(CENTER_Y - 14));
  wkLabel.setAttribute("fill", "#5dade2");
  wkLabel.setAttribute("font-size", "9");
  wkLabel.setAttribute("text-anchor", "middle");
  wkLabel.textContent = "Worker";
  svg.appendChild(wkLabel);

  function update(entities) {
    if (!entities || entities.length === 0) return;

    const forklift = entities.find((e) =>
      e.class && e.class.toLowerCase().includes("forklift")
    );
    const worker = entities.find((e) =>
      e.class &&
      (e.class.toLowerCase().includes("person") ||
        e.class.toLowerCase().includes("worker"))
    );

    if (forklift) {
      const fx = clampX(metresToX(forklift.x));
      fl.setAttribute("cx", String(fx));
      flLabel.setAttribute("x", String(fx));
      threshCircle.setAttribute("cx", String(fx));

      const speed = Math.sqrt(forklift.vx ** 2 + forklift.vy ** 2);
      if (side === "generic") {
        const r = 8 * SCALE;
        threshCircle.setAttribute("r", String(r));
      } else {
        // Braking distance radius: v²/(2*1.5) for forklift decel=1.5
        const bd = speed > 0 ? (speed * speed) / (2 * 1.5) : 1.0;
        const r = Math.max(8, Math.min(SVG_W / 2, bd * SCALE));
        threshCircle.setAttribute("r", String(r));
      }
    }

    if (worker) {
      const wx = clampX(metresToX(worker.x));
      wk.setAttribute("cx", String(wx));
      wkLabel.setAttribute("x", String(wx));
    }
  }

  return { el: svg, update };
}

/**
 * SplitScreen — main demo panel.
 */
export function createSplitScreen() {
  const container = document.createElement("div");
  container.id = "split-screen";

  // --- Left column: Generic AI ---
  const leftCol = document.createElement("div");
  leftCol.className = "panel-col left-col";

  const leftHeader = document.createElement("div");
  leftHeader.innerHTML = `
    <div class="panel-title">Generic Proximity AI</div>
    <div class="panel-subtitle">Fires when any two entities are within 8m</div>
  `;
  const leftCounter = document.createElement("div");
  leftCounter.className = "alert-counter";
  leftCounter.textContent = "0 alerts fired";

  const leftFeed = createEventFeed();

  const leftSvg = makeSvg("generic");
  const leftVizWrap = document.createElement("div");
  leftVizWrap.className = "visualizer-wrap";
  leftVizWrap.style.flexDirection = "column";
  leftVizWrap.appendChild(leftSvg.el);
  const leftVizLabel = document.createElement("div");
  leftVizLabel.className = "viz-label";
  leftVizLabel.textContent = "Dashed circle = 8m generic threshold";
  leftVizWrap.appendChild(leftVizLabel);

  leftCol.appendChild(leftHeader);
  leftCol.appendChild(leftCounter);
  leftCol.appendChild(leftFeed.el);
  leftCol.appendChild(leftVizWrap);

  // --- VS divider ---
  const divider = document.createElement("div");
  divider.className = "vs-divider";
  divider.textContent = "vs";

  // --- Right column: clarus Physics ---
  const rightCol = document.createElement("div");
  rightCol.className = "panel-col";

  const rightHeader = document.createElement("div");
  rightHeader.innerHTML = `
    <div class="panel-title">clarus — Physics Engine</div>
    <div class="panel-subtitle">Fires only when braking distance &gt; remaining gap</div>
  `;
  const rightCounter = document.createElement("div");
  rightCounter.className = "alert-counter";
  rightCounter.textContent = "0 alerts fired";

  const rightFeed = createEventFeed();

  const rightSvg = makeSvg("physics");
  const rightVizWrap = document.createElement("div");
  rightVizWrap.className = "visualizer-wrap";
  rightVizWrap.style.flexDirection = "column";
  rightVizWrap.appendChild(rightSvg.el);
  const rightVizLabel = document.createElement("div");
  rightVizLabel.className = "viz-label";
  rightVizLabel.textContent = "Dashed circle = physics brake-distance threshold";
  rightVizWrap.appendChild(rightVizLabel);

  const eventDetail = createEventDetail();

  rightCol.appendChild(rightHeader);
  rightCol.appendChild(rightCounter);
  rightCol.appendChild(rightFeed.el);
  rightCol.appendChild(rightVizWrap);
  rightCol.appendChild(eventDetail.el);

  container.appendChild(leftCol);
  container.appendChild(divider);
  container.appendChild(rightCol);

  let genericCount = 0;
  let physicsCount = 0;
  let currentProfileDir = "";
  let currentLlmUrl = "";

  function setConfig(profileDir, llmUrl) {
    currentProfileDir = profileDir;
    currentLlmUrl = llmUrl;
  }

  function reset() {
    genericCount = 0;
    physicsCount = 0;
    leftFeed.clear();
    rightFeed.clear();
    leftCounter.textContent = "0 alerts fired";
    rightCounter.textContent = "0 alerts fired";
    eventDetail.hide();
  }

  function applyFrame(frame) {
    // Update visualizers
    leftSvg.update(frame.entities);
    rightSvg.update(frame.entities);

    // Generic events
    for (const evt of frame.generic_events || []) {
      genericCount++;
      leftFeed.append(evt, true);
      leftCounter.textContent = `${genericCount} alerts fired`;
    }

    // Physics events
    for (const evt of frame.physics_events || []) {
      physicsCount++;
      rightFeed.append(evt, false, (e) => {
        eventDetail.show(e, currentProfileDir, currentLlmUrl);
      });
      rightCounter.textContent = `${physicsCount} alerts fired`;
    }
  }

  return { el: container, reset, applyFrame, setConfig };
}
