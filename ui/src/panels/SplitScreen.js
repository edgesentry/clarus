import { createEventFeed } from "./EventFeed.js";
import { createEventDetail } from "./EventDetail.js";

const SVG_W = 380;
const SVG_H = 170;
const SCALE = 14;       // pixels per metre
const ENTITY_Y = 85;    // vertical centre of entities
const ORIGIN_X = 28;    // left margin in pixels

function mToPx(m) {
  return ORIGIN_X + m * SCALE;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function makeSvg(side) {
  const ns = "http://www.w3.org/2000/svg";

  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);
  svg.style.cssText = "display:block;border-radius:6px;border:1.5px solid #2d3142;background:#0a0c12;transition:border-color 0.25s";

  // Floor/ground strip
  const floor = document.createElementNS(ns, "rect");
  floor.setAttribute("x", "0");
  floor.setAttribute("y", String(ENTITY_Y + 16));
  floor.setAttribute("width", SVG_W);
  floor.setAttribute("height", "2");
  floor.setAttribute("fill", "#1e2233");
  svg.appendChild(floor);

  // Aisle shading — the corridor they share
  const aisle = document.createElementNS(ns, "rect");
  aisle.setAttribute("x", "0");
  aisle.setAttribute("y", String(ENTITY_Y - 24));
  aisle.setAttribute("width", SVG_W);
  aisle.setAttribute("height", "40");
  aisle.setAttribute("fill", "rgba(255,255,255,0.015)");
  svg.appendChild(aisle);

  // --- Threshold zone (shaded background) ---
  const zoneRect = document.createElementNS(ns, "rect");
  zoneRect.setAttribute("y", "0");
  zoneRect.setAttribute("height", SVG_H);
  zoneRect.setAttribute("fill", side === "generic" ? "rgba(255,107,107,0.055)" : "rgba(255,169,77,0.055)");
  svg.appendChild(zoneRect);

  // Threshold boundary line
  const threshLine = document.createElementNS(ns, "line");
  threshLine.setAttribute("y1", String(ENTITY_Y - 24));
  threshLine.setAttribute("y2", String(ENTITY_Y + 16));
  threshLine.setAttribute("stroke", side === "generic" ? "#ff6b6b" : "#ffa94d");
  threshLine.setAttribute("stroke-width", "1.5");
  threshLine.setAttribute("stroke-dasharray", "4 3");
  threshLine.setAttribute("opacity", "0.6");
  svg.appendChild(threshLine);

  // Threshold label (inline, below threshold line)
  const threshLabelEl = document.createElementNS(ns, "text");
  threshLabelEl.setAttribute("y", String(ENTITY_Y + 34));
  threshLabelEl.setAttribute("font-size", "8");
  threshLabelEl.setAttribute("font-family", "monospace");
  threshLabelEl.setAttribute("fill", side === "generic" ? "#ff6b6b" : "#ffa94d");
  threshLabelEl.setAttribute("opacity", "0.8");
  svg.appendChild(threshLabelEl);

  // --- Distance line between entities ---
  const distLine = document.createElementNS(ns, "line");
  distLine.setAttribute("y1", String(ENTITY_Y));
  distLine.setAttribute("y2", String(ENTITY_Y));
  distLine.setAttribute("stroke", "#3a3f55");
  distLine.setAttribute("stroke-width", "1");
  distLine.setAttribute("stroke-dasharray", "3 3");
  svg.appendChild(distLine);

  // Distance label (above midpoint)
  const distLabelEl = document.createElementNS(ns, "text");
  distLabelEl.setAttribute("y", String(ENTITY_Y - 9));
  distLabelEl.setAttribute("font-size", "12");
  distLabelEl.setAttribute("text-anchor", "middle");
  distLabelEl.setAttribute("font-weight", "700");
  distLabelEl.setAttribute("font-family", "monospace");
  distLabelEl.setAttribute("fill", "#c9d1d9");
  svg.appendChild(distLabelEl);

  // --- Forklift (rect body) ---
  const flBody = document.createElementNS(ns, "rect");
  flBody.setAttribute("width", "30");
  flBody.setAttribute("height", "18");
  flBody.setAttribute("y", String(ENTITY_Y - 9));
  flBody.setAttribute("rx", "3");
  flBody.setAttribute("fill", "#c0620f");
  flBody.setAttribute("stroke", "#e67e22");
  flBody.setAttribute("stroke-width", "1.5");
  svg.appendChild(flBody);

  // Forklift arrow (→ direction indicator)
  const flArrow = document.createElementNS(ns, "text");
  flArrow.setAttribute("y", String(ENTITY_Y + 5));
  flArrow.setAttribute("font-size", "12");
  flArrow.setAttribute("text-anchor", "middle");
  flArrow.setAttribute("fill", "#f8c39a");
  svg.appendChild(flArrow);
  flArrow.textContent = "→";

  // Forklift ID label (above)
  const flLabel = document.createElementNS(ns, "text");
  flLabel.setAttribute("y", String(ENTITY_Y - 13));
  flLabel.setAttribute("font-size", "9");
  flLabel.setAttribute("font-weight", "700");
  flLabel.setAttribute("text-anchor", "middle");
  flLabel.setAttribute("fill", "#e67e22");
  flLabel.textContent = "FL-01";
  svg.appendChild(flLabel);

  // Forklift speed (below floor)
  const flSpeedEl = document.createElementNS(ns, "text");
  flSpeedEl.setAttribute("y", String(ENTITY_Y + 32));
  flSpeedEl.setAttribute("font-size", "8");
  flSpeedEl.setAttribute("text-anchor", "middle");
  flSpeedEl.setAttribute("font-family", "monospace");
  flSpeedEl.setAttribute("fill", "#6a7080");
  svg.appendChild(flSpeedEl);

  // --- Worker (circle) ---
  const wkCircle = document.createElementNS(ns, "circle");
  wkCircle.setAttribute("r", "11");
  wkCircle.setAttribute("cy", String(ENTITY_Y));
  wkCircle.setAttribute("fill", "#1a6ea8");
  wkCircle.setAttribute("stroke", "#4a9fd4");
  wkCircle.setAttribute("stroke-width", "1.5");
  svg.appendChild(wkCircle);

  // Worker figure (simple stick person as text)
  const wkFigure = document.createElementNS(ns, "text");
  wkFigure.setAttribute("y", String(ENTITY_Y + 5));
  wkFigure.setAttribute("font-size", "13");
  wkFigure.setAttribute("text-anchor", "middle");
  wkFigure.setAttribute("fill", "#c9d1d9");
  wkFigure.textContent = "P";
  svg.appendChild(wkFigure);

  // Worker ID label (above)
  const wkLabel = document.createElementNS(ns, "text");
  wkLabel.setAttribute("y", String(ENTITY_Y - 16));
  wkLabel.setAttribute("font-size", "9");
  wkLabel.setAttribute("font-weight", "700");
  wkLabel.setAttribute("text-anchor", "middle");
  wkLabel.setAttribute("fill", "#4a9fd4");
  wkLabel.textContent = "W-03";
  svg.appendChild(wkLabel);

  // --- Status bar (bottom of SVG) ---
  const statusBg = document.createElementNS(ns, "rect");
  statusBg.setAttribute("x", "0");
  statusBg.setAttribute("y", String(SVG_H - 22));
  statusBg.setAttribute("width", SVG_W);
  statusBg.setAttribute("height", "22");
  statusBg.setAttribute("fill", "#070910");
  svg.appendChild(statusBg);

  const statusEl = document.createElementNS(ns, "text");
  statusEl.setAttribute("x", String(SVG_W / 2));
  statusEl.setAttribute("y", String(SVG_H - 7));
  statusEl.setAttribute("font-size", "10");
  statusEl.setAttribute("font-weight", "600");
  statusEl.setAttribute("text-anchor", "middle");
  statusEl.setAttribute("font-family", "monospace");
  statusEl.setAttribute("fill", "#4a5068");
  statusEl.textContent = "Waiting for demo…";
  svg.appendChild(statusEl);

  let flashTimeout = null;

  function flashDanger() {
    svg.style.borderColor = "#ff4444";
    svg.style.boxShadow = "0 0 12px rgba(255,68,68,0.4)";
    clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => {
      svg.style.borderColor = "#2d3142";
      svg.style.boxShadow = "";
    }, 1200);
  }

  function update(entities, hasAlert) {
    if (!entities || entities.length === 0) return;

    const forklift = entities.find(e =>
      e.class && e.class.toLowerCase().includes("forklift")
    );
    const worker = entities.find(e =>
      e.class && (
        e.class.toLowerCase().includes("person") ||
        e.class.toLowerCase().includes("worker")
      )
    );
    if (!forklift || !worker) return;

    const fx = clamp(mToPx(forklift.x), 20, SVG_W - 20);
    const wx = clamp(mToPx(worker.x), 20, SVG_W - 20);
    const gapM = Math.abs(worker.x - forklift.x);
    const mid = (fx + wx) / 2;
    const speed = Math.sqrt((forklift.vx || 0) ** 2 + (forklift.vy || 0) ** 2);

    // Forklift
    flBody.setAttribute("x", String(fx - 15));
    flArrow.setAttribute("x", String(fx));
    flLabel.setAttribute("x", String(fx));
    flSpeedEl.setAttribute("x", String(fx));
    flSpeedEl.textContent = `${speed.toFixed(1)} m/s`;

    // Worker
    wkCircle.setAttribute("cx", String(wx));
    wkFigure.setAttribute("x", String(wx));
    wkLabel.setAttribute("x", String(wx));

    // Distance line
    const lineX1 = fx + 15;
    const lineX2 = wx - 11;
    if (lineX2 > lineX1 + 6) {
      distLine.setAttribute("x1", String(lineX1));
      distLine.setAttribute("x2", String(lineX2));
      distLine.setAttribute("visibility", "visible");
    } else {
      distLine.setAttribute("visibility", "hidden");
    }
    distLabelEl.setAttribute("x", String(mid));

    const gapColor = gapM <= 2.5 ? "#ff4444" : gapM <= 5 ? "#ffa94d" : "#c9d1d9";
    distLabelEl.setAttribute("fill", gapColor);
    distLabelEl.textContent = `${gapM.toFixed(1)} m`;

    // Threshold zone + line
    if (side === "generic") {
      const threshM = 8.0;
      const threshPx = clamp(mToPx(worker.x - threshM), 0, SVG_W);
      zoneRect.setAttribute("x", String(threshPx));
      zoneRect.setAttribute("width", String(Math.max(0, wx - threshPx)));
      threshLine.setAttribute("x1", String(threshPx));
      threshLine.setAttribute("x2", String(threshPx));
      threshLabelEl.setAttribute("x", String(threshPx + 3));
      threshLabelEl.textContent = "← 8m zone";
    } else {
      // Physics: brake distance zone ahead of forklift
      const bd = speed > 0 ? (speed * speed) / (2 * 1.5) : 0.3;
      const bdPx = bd * SCALE;
      const bdEdgePx = clamp(fx + 15 + bdPx, 0, SVG_W);
      zoneRect.setAttribute("x", String(fx + 15));
      zoneRect.setAttribute("width", String(Math.max(0, bdEdgePx - fx - 15)));
      threshLine.setAttribute("x1", String(bdEdgePx));
      threshLine.setAttribute("x2", String(bdEdgePx));
      const labelX = clamp(bdEdgePx - 52, fx + 16, SVG_W - 60);
      threshLabelEl.setAttribute("x", String(labelX));
      threshLabelEl.textContent = `brake: ${bd.toFixed(1)}m →`;
    }

    // Status
    if (hasAlert) {
      if (side === "generic") {
        statusEl.setAttribute("fill", "#ff8787");
        statusEl.textContent = `⚠ ALERT — gap ${gapM.toFixed(1)}m is within 8m threshold`;
      } else {
        const ttc = speed > 0 ? gapM / speed : 999;
        statusEl.setAttribute("fill", "#ff4444");
        statusEl.textContent = `🚨 STOP — TTC ${ttc.toFixed(1)}s — forklift cannot stop in time`;
      }
      flashDanger();
    } else if (side === "generic") {
      statusEl.setAttribute("fill", "#69db7c");
      statusEl.textContent = gapM <= 8
        ? `⚠ Inside 8m zone — gap ${gapM.toFixed(1)}m`
        : `Gap: ${gapM.toFixed(1)}m — approaching`;
    } else {
      const ttc = speed > 0 ? gapM / speed : 999;
      const ttcStr = ttc > 99 ? "∞" : `${ttc.toFixed(1)}s`;
      statusEl.setAttribute("fill", "#69db7c");
      statusEl.textContent = `✓ Monitoring — TTC ${ttcStr} — can stop safely`;
    }
  }

  return { el: svg, update };
}

export function createSplitScreen() {
  const container = document.createElement("div");
  container.id = "split-screen";

  // ── Scenario banner ──────────────────────────────────────────────────────
  const banner = document.createElement("div");
  banner.id = "scenario-banner";
  banner.innerHTML = `
    <div class="scenario-title">Scenario: Forklift FL-01 approaching Worker W-03</div>
    <div class="scenario-reg">MPA Port Safety Circular 2024-07 §3.1 — 5m minimum clearance between powered vehicles and pedestrians</div>
  `;
  container.appendChild(banner);

  // ── Split area ────────────────────────────────────────────────────────────
  const splitArea = document.createElement("div");
  splitArea.id = "split-area";

  // Left column
  const leftCol = document.createElement("div");
  leftCol.className = "panel-col left-col";

  leftCol.innerHTML = `
    <div class="panel-title" style="color:#ff8787">Generic Proximity AI</div>
    <div class="panel-subtitle">Fires whenever any two entities are within 8m — regardless of speed</div>
  `;

  const leftSvg = makeSvg("generic");
  leftCol.appendChild(leftSvg.el);

  const leftCountEl = document.createElement("div");
  leftCountEl.className = "alert-counter counter-bad";
  leftCountEl.innerHTML = `<span class="counter-num" id="left-count">0</span> false alerts`;
  leftCol.appendChild(leftCountEl);

  const leftFeed = createEventFeed();
  leftCol.appendChild(leftFeed.el);

  // VS divider
  const divider = document.createElement("div");
  divider.className = "vs-divider";
  divider.textContent = "vs";

  // Right column
  const rightCol = document.createElement("div");
  rightCol.className = "panel-col";

  rightCol.innerHTML = `
    <div class="panel-title" style="color:#00d4aa">clarus — Physics Engine</div>
    <div class="panel-subtitle">Fires only when the forklift cannot stop before reaching the worker</div>
  `;

  const rightSvg = makeSvg("physics");
  rightCol.appendChild(rightSvg.el);

  const rightCountEl = document.createElement("div");
  rightCountEl.className = "alert-counter counter-good";
  rightCountEl.id = "right-count-el";
  rightCountEl.innerHTML = `<span style="color:#69db7c">✓ Monitoring — 0 alerts</span>`;
  rightCol.appendChild(rightCountEl);

  const rightFeed = createEventFeed();
  rightCol.appendChild(rightFeed.el);

  const eventDetail = createEventDetail();
  rightCol.appendChild(eventDetail.el);

  splitArea.appendChild(leftCol);
  splitArea.appendChild(divider);
  splitArea.appendChild(rightCol);
  container.appendChild(splitArea);

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
    document.getElementById("left-count").textContent = "0";
    leftCountEl.innerHTML = `<span class="counter-num" id="left-count">0</span> false alerts`;
    rightCountEl.innerHTML = `<span style="color:#69db7c">✓ Monitoring — 0 alerts</span>`;
    eventDetail.hide();
    leftSvg.el.style.borderColor = "#2d3142";
    leftSvg.el.style.boxShadow = "";
    rightSvg.el.style.borderColor = "#2d3142";
    rightSvg.el.style.boxShadow = "";
  }

  function applyFrame(frame) {
    const hasGeneric = (frame.generic_events || []).length > 0;
    const hasPhysics = (frame.physics_events || []).length > 0;

    leftSvg.update(frame.entities, hasGeneric);
    rightSvg.update(frame.entities, hasPhysics);

    for (const evt of frame.generic_events || []) {
      genericCount++;
      document.getElementById("left-count").textContent = String(genericCount);
      leftFeed.append(evt, true);
    }

    for (const evt of frame.physics_events || []) {
      physicsCount++;
      rightCountEl.innerHTML = `<span style="color:#ff6b6b">⚠ ${physicsCount} alert${physicsCount > 1 ? "s" : ""} — action required</span>`;
      rightFeed.append(evt, false, (e) => {
        eventDetail.show(e, currentProfileDir, currentLlmUrl);
      });
      // Auto-explain the first physics alert (LLM call fires automatically)
      if (physicsCount === 1) {
        eventDetail.show(evt, currentProfileDir, currentLlmUrl);
      }
    }
  }

  return { el: container, reset, applyFrame, setConfig };
}
