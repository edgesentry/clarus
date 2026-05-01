import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { createSplitScreen } from "./panels/SplitScreen.js";
import { createCanvasPanel } from "./panels/CanvasPanel.js";
import { createEventFeed } from "./panels/EventFeed.js";
import { createVerifyPanel } from "./panels/VerifyPanel.js";

// Paths are relative to the user's clarus checkout.
// Production: sealed chain pulled from Cloudflare R2 — same pipeline, no local CSV.
const FIXTURES_BASE = "/Users/yoheionishi/work/edgesentry/clarus/fixtures";
const PROFILES_BASE = "/Users/yoheionishi/work/edgesentry/clarus/profiles";

const SCENARIOS = [
  {
    id: "A",
    label: "A — Safe Pass",
    title: "Forklift FL-01 approaches Worker W-03",
    story: [
      "FL-01 enters at 1 m/s. Generic AI fires 4 alerts during the safe approach.",
      "clarus stays silent — braking distance (0.3 m) is well within the remaining gap.",
      "At t = 6 s, FL-01 accelerates to 3 m/s. TTC drops to 2.0 s → clarus fires once.",
      "Result: 4 false alarms vs 1 correct alert.",
    ],
    regulation: "MPA Port Safety Circular 2024-07 §3.1 — 5 m minimum clearance",
    csvPath: `${FIXTURES_BASE}/forklift_approach.csv`,
    profileDir: `${PROFILES_BASE}/demo`,
  },
  {
    id: "B",
    label: "B — High Speed",
    title: "Forklift FL-01 entering at 14 km/h (4 m/s)",
    story: [
      "At 4 m/s, braking distance = 5.3 m. Physics detects danger from 11.5 m — before the 8 m generic zone.",
      "clarus fires at t = 2 s. Generic doesn't fire until t = 3 s — 1 second later, gap only 7.5 m remaining.",
      "A system that waits for 8 m clearance gives insufficient warning at high speed.",
      "Result: physics warns 1 s earlier, with physics rationale attached.",
    ],
    regulation: "MPA Port Safety Circular 2024-07 §3.1 — braking distance exceeds gap",
    csvPath: `${FIXTURES_BASE}/high_speed_entry.csv`,
    profileDir: `${PROFILES_BASE}/demo`,
  },
  {
    id: "C",
    label: "C — Fleet Coverage",
    title: "Two forklifts converging on Worker W-03 from opposite sides",
    story: [
      "FL-01 approaches from the left, FL-02 from the right. W-03 is in the centre.",
      "Generic AI fires independently for each entity pair as they enter 8 m — producing many alerts.",
      "clarus evaluates all 3 entity pairs simultaneously: FL-01 ↔ W-03, FL-02 ↔ W-03, FL-01 ↔ FL-02.",
      "Result: 3 targeted physics alerts at the moment all three pairs are simultaneously dangerous.",
    ],
    regulation: "MPA Port Safety Circular 2024-07 §3.1 — all powered vehicle / pedestrian pairs",
    csvPath: `${FIXTURES_BASE}/dual_forklift.csv`,
    profileDir: `${PROFILES_BASE}/demo`,
  },
  {
    id: "D",
    label: "D — Maritime Zone",
    title: "Vessel V-001 approaching Singapore restricted zone",
    story: [
      "Vessel V-001 approaches from the west at 2 m/s toward a restricted zone in Singapore port waters.",
      "clarus monitors vessel position against the zone polygon defined in the sg-maritime-security profile.",
      "RESTRICTED_ZONE_APPROACH fires when V-001 crosses the zone boundary at x = 300 m (t ≈ 152 s).",
      "Regulation: Singapore Infrastructure Protection Act (Cap. 136A) §18.",
    ],
    regulation: "Singapore Infrastructure Protection Act (Cap. 136A) §18 — entry to protected areas",
    csvPath: `${FIXTURES_BASE}/vessel_zone_approach.csv`,
    profileDir: `${PROFILES_BASE}/sg-maritime-security`,
    useCanvas: true,
    canvasOptions: {
      zonePolygon: [[300,200],[600,200],[600,500],[300,500]],
      worldW: 720,
      worldH: 700,
    },
  },
];

document.addEventListener("DOMContentLoaded", () => {
  const app = document.getElementById("app");

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.id = "toolbar";
  toolbar.innerHTML = `
    <h1>clarus</h1>
    <span class="toolbar-label">LLM URL</span>
    <input class="toolbar-input" id="llm-url" type="text"
           placeholder="http://localhost:8080"
           value="http://localhost:8080"
           style="min-width:170px" />
    <span class="toolbar-label" style="color:#4a5068;font-size:10px">
      LLM off? run <code style="color:#8b949e">./scripts/run_llama.sh</code>
    </span>
    <div style="flex:1"></div>
    <span class="toolbar-label">Speed</span>
    <select class="speed-select" id="speed-select">
      <option value="600">0.2×</option>
      <option value="300" selected>0.5×</option>
      <option value="150">1×</option>
      <option value="75">2×</option>
    </select>
    <button class="run-btn" id="run-btn">▶ Run Demo</button>
  `;
  app.appendChild(toolbar);

  // ── Main tab bar ──────────────────────────────────────────────────────────
  const tabBar = document.createElement("div");
  tabBar.id = "tab-bar";
  ["Demo", "Verify"].forEach((label, i) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (i === 0 ? " active" : "");
    btn.dataset.tab = label.toLowerCase();
    btn.textContent = label;
    tabBar.appendChild(btn);
  });
  app.appendChild(tabBar);

  // ── Content area ──────────────────────────────────────────────────────────
  const content = document.createElement("div");
  content.id = "content";
  app.appendChild(content);

  // Status bar
  const statusBar = document.createElement("div");
  statusBar.id = "status-bar";
  statusBar.textContent = "Select a scenario and press Run Demo.";
  app.appendChild(statusBar);

  function setStatus(msg) { statusBar.textContent = msg; }

  // ── Demo panel (contains scenario sub-tabs + split-screens) ───────────────
  const demoPanel = document.createElement("div");
  demoPanel.className = "tab-panel active";
  demoPanel.style.flexDirection = "column";

  // Scenario sub-tab bar
  const scenarioBar = document.createElement("div");
  scenarioBar.id = "scenario-bar";

  // Group label: Port Safety
  const portLabel = document.createElement("span");
  portLabel.className = "scenario-group-label";
  portLabel.textContent = "PORT SAFETY";
  scenarioBar.appendChild(portLabel);

  SCENARIOS.forEach((s, i) => {
    // Group divider before first canvas scenario
    if (s.useCanvas) {
      const divider = document.createElement("span");
      divider.className = "scenario-group-divider";
      scenarioBar.appendChild(divider);
      const maritimeLabel = document.createElement("span");
      maritimeLabel.className = "scenario-group-label scenario-group-label--maritime";
      maritimeLabel.textContent = "MARITIME SECURITY";
      scenarioBar.appendChild(maritimeLabel);
    }
    const btn = document.createElement("button");
    btn.className = "scenario-btn" + (i === 0 ? " active" : "") + (s.useCanvas ? " scenario-btn--maritime" : "");
    btn.dataset.sid = s.id;
    btn.textContent = s.label;
    scenarioBar.appendChild(btn);
  });
  demoPanel.appendChild(scenarioBar);

  // Create one panel per scenario (SplitScreen or CanvasPanel depending on scenario type)
  const scenarioPanels = {};
  const splitScreens  = {};
  const canvasPanels  = {};

  SCENARIOS.forEach((s, i) => {
    const panel = document.createElement("div");
    panel.className = "scenario-panel" + (i === 0 ? " active" : "");
    panel.dataset.sid = s.id;

    // Use-case badge + story card
    const storyCard = document.createElement("div");
    storyCard.className = "story-card" + (s.useCanvas ? " story-card--maritime" : "");
    storyCard.innerHTML = `
      <div class="usecase-badge ${s.useCanvas ? "usecase-badge--maritime" : "usecase-badge--safety"}">
        ${s.useCanvas ? "⚓ Maritime Security · PIER71-07 / CAP Vista Tier-2" : "🏗 Port Safety · PIER71-14"}
      </div>
      <div class="story-title">${s.title}</div>
      <ul class="story-bullets">
        ${s.story.map(line => `<li>${line}</li>`).join("")}
      </ul>
      <div class="story-meta">
        <div class="story-reg">${s.regulation}</div>
        <div class="story-source">Demo: local replay · Production: edge-signed → R2</div>
      </div>
    `;
    panel.appendChild(storyCard);

    if (s.useCanvas) {
      // ── Canvas scenario (zone / vessel) ──────────────────────────────────
      const canvasHeader = document.createElement("div");
      canvasHeader.className = "canvas-header";
      canvasHeader.innerHTML = `
        <span class="canvas-header-title">Top-down vessel track · Singapore port waters</span>
        <span class="canvas-header-sub">Zone polygon from <code>sg-maritime-security/rules.json</code> · Reg: IPA Cap. 136A §18</span>
      `;
      panel.appendChild(canvasHeader);

      const canvasWrapper = document.createElement("div");
      canvasWrapper.style.cssText = "display:flex;gap:16px;align-items:flex-start;margin-top:8px";

      const cp = createCanvasPanel(s.canvasOptions || {});
      canvasWrapper.appendChild(cp.el);

      // Event feed on the right
      const feedWrapper = document.createElement("div");
      feedWrapper.style.cssText = "flex:1;min-width:0";
      const feedTitle = document.createElement("div");
      feedTitle.style.cssText = "font-size:11px;color:#4a5068;margin-bottom:6px;font-family:monospace";
      feedTitle.textContent = "clarus — Maritime Security Events";
      feedWrapper.appendChild(feedTitle);
      const feed = createEventFeed();
      feedWrapper.appendChild(feed.el);
      canvasWrapper.appendChild(feedWrapper);

      panel.appendChild(canvasWrapper);

      // Zone rule explanation (replaces slider for maritime scenario)
      const zoneNote = document.createElement("div");
      zoneNote.className = "threshold-bar threshold-bar--zone";
      zoneNote.innerHTML = `
        <div class="threshold-rule-label">
          <span class="threshold-rule-prefix">RESTRICTED_ZONE_APPROACH fires when</span>
          <code class="threshold-rule-expr">vessel position ∈ zone polygon</code>
        </div>
        <div class="threshold-result" style="color:#4a8068">
          Zone boundary defined in <code>sg-maritime-security/rules.json</code> —
          not a distance threshold. Edit the polygon coordinates to change which area is restricted.
        </div>
      `;
      panel.appendChild(zoneNote);
      canvasPanels[s.id] = { cp, feed };
    } else {
      // ── Split-screen scenario (forklift / proximity) ──────────────────
      const ss = createSplitScreen();
      panel.appendChild(ss.el);
      splitScreens[s.id] = ss;

      // Threshold slider — disabled until Run Demo completes
      const sliderBar = document.createElement("div");
      sliderBar.className = "threshold-bar threshold-bar--locked";
      sliderBar.id = `thresh-bar-${s.id}`;
      sliderBar.innerHTML = `
        <div class="threshold-rule-label">
          <span class="threshold-rule-prefix">PROXIMITY_ALERT fires when</span>
          <code class="threshold-rule-expr">distance &lt; <span id="thresh-val-${s.id}">5.0</span> m</code>
        </div>
        <div class="threshold-controls">
          <span class="threshold-min">1 m</span>
          <input class="threshold-slider" type="range"
                 min="1" max="12" step="0.5" value="5"
                 data-sid="${s.id}" disabled />
          <span class="threshold-max">12 m</span>
        </div>
        <div class="threshold-result" id="thresh-hint-${s.id}">Run Demo first to enable</div>
      `;
      panel.appendChild(sliderBar);
    }

    // Per-scenario PDF button (shown after demo runs)
    const pdfBar = document.createElement("div");
    pdfBar.className = "pdf-bar";
    pdfBar.style.display = "none";
    pdfBar.innerHTML = `
      <button class="pdf-btn" data-sid="${s.id}">Generate PDF Report</button>
      <span class="pdf-status" id="pdf-status-${s.id}"></span>
    `;
    panel.appendChild(pdfBar);

    pdfBar.querySelector(".pdf-btn").addEventListener("click", async () => {
      const btn = pdfBar.querySelector(".pdf-btn");
      const statusEl = pdfBar.querySelector(".pdf-status");
      btn.disabled = true;
      btn.textContent = "Generating…";
      statusEl.textContent = "";
      try {
        const eventsJson = JSON.stringify(scenarioPanels[s.id]._events || []);
        const explanationsJson = JSON.stringify(
          splitScreens[s.id] ? splitScreens[s.id].getExplanations() : []
        );
        const pdfPath = await invoke("generate_pdf_report", {
          eventsJson,
          siteName: s.title,
          explanationsJson,
        });
        statusEl.textContent = `✓ Saved: ${pdfPath}`;
      } catch (err) {
        statusEl.textContent = `Error: ${err}`;
      } finally {
        btn.disabled = false;
        btn.textContent = "Generate PDF Report";
      }
    });

    scenarioPanels[s.id] = panel;
    demoPanel.appendChild(panel);
  });

  content.appendChild(demoPanel);

  // ── Verify panel ──────────────────────────────────────────────────────────
  const verifyPanel = document.createElement("div");
  verifyPanel.className = "tab-panel";
  const verifyComp = createVerifyPanel();
  verifyPanel.appendChild(verifyComp.el);
  content.appendChild(verifyPanel);

  // ── Tab switching ─────────────────────────────────────────────────────────
  const mainPanels = {
    demo: demoPanel,
    verify: verifyPanel,
  };
  tabBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    tabBar.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    Object.values(mainPanels).forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    mainPanels[btn.dataset.tab].classList.add("active");
  });

  // ── Scenario sub-tab switching ────────────────────────────────────────────
  let activeScenarioId = SCENARIOS[0].id;

  scenarioBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".scenario-btn");
    if (!btn) return;
    const sid = btn.dataset.sid;
    scenarioBar.querySelectorAll(".scenario-btn").forEach(b => b.classList.remove("active"));
    Object.values(scenarioPanels).forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    scenarioPanels[sid].classList.add("active");
    activeScenarioId = sid;
  });

  // ── Threshold slider wiring ───────────────────────────────────────────────
  let sliderDebounce = null;

  demoPanel.addEventListener("input", (e) => {
    const slider = e.target.closest(".threshold-slider");
    if (!slider || slider.disabled) return;
    const sid = slider.dataset.sid;
    const val = parseFloat(slider.value);
    document.getElementById(`thresh-val-${sid}`).textContent = val.toFixed(1);

    clearTimeout(sliderDebounce);
    sliderDebounce = setTimeout(async () => {
      const scenario = SCENARIOS.find(s => s.id === sid);
      if (!scenario || scenario.useCanvas) return;
      const hintEl = document.getElementById(`thresh-hint-${sid}`);
      hintEl.textContent = "calculating…";
      hintEl.style.color = "#4a5068";

      const rulesJson = JSON.stringify([
        { rule_id: "PROXIMITY_ALERT", condition: `distance < ${val}`,
          severity: "HIGH", regulation: `Site Safety §3.1 — ${val.toFixed(1)} m minimum clearance` },
        { rule_id: "TTC_ALERT", condition: "ttc < 3.0",
          severity: "HIGH", regulation: "Site Safety §3.2 — 3.0 s TTC emergency stop" },
        { rule_id: "EXCLUSION_ZONE_BREACH", condition: "zone_member",
          severity: "CRITICAL", regulation: "Site Safety §4.1 — Exclusion zone",
          zone: [[0,0],[10,0],[10,10],[0,10]] },
      ]);

      try {
        const result = await invoke("run_replay_with_rules", {
          csvPath: scenario.csvPath,
          rulesJson,
        });
        const p = result.total_physics_alerts;
        // Find first alert frame and its measured distance
        const firstAlertFrame = result.frames.find(f =>
          f.physics_events.some(ev => ev.rule_id === "PROXIMITY_ALERT")
        );
        if (firstAlertFrame) {
          const evt = firstAlertFrame.physics_events.find(ev => ev.rule_id === "PROXIMITY_ALERT");
          hintEl.textContent =
            `→ ${p} alert${p !== 1 ? "s" : ""} · first fires at ${evt.measured_value.toFixed(2)} m`;
          hintEl.style.color = p > 0 ? "#ffa94d" : "#69db7c";
        } else {
          hintEl.textContent = `→ 0 alerts — rule never triggers on this trajectory`;
          hintEl.style.color = "#69db7c";
        }
      } catch (err) {
        hintEl.textContent = `Error: ${err}`;
        hintEl.style.color = "#ff8787";
      }
    }, 350);
  });

  // ── Run Demo ──────────────────────────────────────────────────────────────
  let animHandle = null;
  let collectedPhysicsEvents = [];

  document.getElementById("run-btn").addEventListener("click", async () => {
    const scenario = SCENARIOS.find(s => s.id === activeScenarioId);
    const llmUrl = document.getElementById("llm-url").value.trim();
    const speedMs = parseInt(document.getElementById("speed-select").value, 10);
    const ss = splitScreens[activeScenarioId] || null;

    if (animHandle !== null) {
      clearTimeout(animHandle);
      animHandle = null;
    }

    collectedPhysicsEvents = [];

    const runBtn = document.getElementById("run-btn");
    runBtn.disabled = true;
    runBtn.textContent = "Running…";
    setStatus(`Scenario ${scenario.id}: loading replay…`);

    // Reset whichever panel is active
    if (scenario.useCanvas) {
      canvasPanels[activeScenarioId].cp.reset();
      canvasPanels[activeScenarioId].feed.clear();
    } else {
      ss.reset();
      ss.setConfig(scenario.profileDir, llmUrl);
    }

    try {
      const result = await invoke("run_replay", {
        csvPath: scenario.csvPath,
        profileDir: scenario.profileDir,
      });

      setStatus(`Scenario ${scenario.id}: ${result.frames.length} frames loaded — playing at ${(1000 / speedMs).toFixed(1)}× speed…`);

      let frameIndex = 0;
      function nextFrame() {
        if (frameIndex >= result.frames.length) {
          const g = result.total_generic_alerts;
          const p = result.total_physics_alerts;
          if (scenario.useCanvas) {
            setStatus(
              `Scenario ${scenario.id} done — clarus: ${p} alert${p !== 1 ? "s" : ""}`
            );
          } else {
            setStatus(
              `Scenario ${scenario.id} done — Generic AI: ${g} alert${g !== 1 ? "s" : ""} · clarus: ${p} alert${p !== 1 ? "s" : ""} · Click any clarus event for physics explanation`
            );
          }
          runBtn.disabled = false;
          runBtn.textContent = "▶ Run Demo";

          // Unlock threshold slider after first successful run
          if (!scenario.useCanvas) {
            const bar = document.getElementById(`thresh-bar-${activeScenarioId}`);
            const sl  = bar && bar.querySelector(".threshold-slider");
            const hint = document.getElementById(`thresh-hint-${activeScenarioId}`);
            if (sl) sl.disabled = false;
            if (bar) bar.classList.remove("threshold-bar--locked");
            if (hint) {
              hint.textContent = "← drag to change the rule and see how alert behaviour changes";
              hint.style.color = "#4a8068";
            }
          }

          const panel = scenarioPanels[activeScenarioId];
          panel._events = collectedPhysicsEvents;
          panel.querySelector(".pdf-bar").style.display = "flex";
          return;
        }
        const frame = result.frames[frameIndex++];
        if (scenario.useCanvas) {
          const { cp, feed } = canvasPanels[activeScenarioId];
          cp.draw(frame.entities, frame.physics_events);
          for (const evt of frame.physics_events || []) {
            collectedPhysicsEvents.push(evt);
            feed.append(evt, false);
          }
        } else {
          ss.applyFrame(frame);
          for (const evt of frame.physics_events || []) {
            collectedPhysicsEvents.push(evt);
          }
        }
        animHandle = setTimeout(nextFrame, speedMs);
      }
      nextFrame();

    } catch (err) {
      setStatus(`Error: ${err}`);
      runBtn.disabled = false;
      runBtn.textContent = "▶ Run Demo";
    }
  });
});
