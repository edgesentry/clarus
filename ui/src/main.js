import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { createSplitScreen } from "./panels/SplitScreen.js";
import { createReportPanel } from "./panels/ReportPanel.js";
import { createVerifyPanel } from "./panels/VerifyPanel.js";

document.addEventListener("DOMContentLoaded", () => {
  const app = document.getElementById("app");

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = document.createElement("div");
  toolbar.id = "toolbar";
  toolbar.innerHTML = `
    <h1>clarus</h1>
    <span class="toolbar-label">CSV path</span>
    <input class="toolbar-input" id="csv-path" type="text"
           placeholder="/path/to/forklift_approach.csv"
           value="/Users/yoheionishi/work/edgesentry/clarus/fixtures/forklift_approach.csv" />
    <span class="toolbar-label">Profile dir</span>
    <input class="toolbar-input" id="profile-dir" type="text"
           placeholder="/path/to/profiles/demo"
           value="/Users/yoheionishi/work/edgesentry/clarus/profiles/demo" />
    <span class="toolbar-label">LLM URL</span>
    <input class="toolbar-input" id="llm-url" type="text"
           placeholder="http://localhost:8080"
           value="http://localhost:8080"
           style="min-width:160px" />
    <button class="run-btn" id="run-btn">Run Demo</button>
    <span class="toolbar-label">Speed</span>
    <select class="speed-select" id="speed-select">
      <option value="200">0.5x</option>
      <option value="100" selected>1x</option>
      <option value="50">2x</option>
    </select>
  `;
  app.appendChild(toolbar);

  // ── Tab bar ──────────────────────────────────────────────────────────────
  const tabBar = document.createElement("div");
  tabBar.id = "tab-bar";

  const tabs = [
    { id: "tab-demo",   label: "Demo" },
    { id: "tab-report", label: "Report" },
    { id: "tab-verify", label: "Verify" },
  ];

  const tabBtns = {};
  tabs.forEach(({ id, label }, i) => {
    const btn = document.createElement("button");
    btn.className = "tab-btn" + (i === 0 ? " active" : "");
    btn.id = id;
    btn.textContent = label;
    tabBar.appendChild(btn);
    tabBtns[id] = btn;
  });
  app.appendChild(tabBar);

  // ── Content area ─────────────────────────────────────────────────────────
  const content = document.createElement("div");
  content.id = "content";
  app.appendChild(content);

  // Demo tab panel
  const demoPanel = document.createElement("div");
  demoPanel.className = "tab-panel active";
  demoPanel.id = "panel-demo";
  content.appendChild(demoPanel);

  // Report tab panel
  const reportPanel = document.createElement("div");
  reportPanel.className = "tab-panel";
  reportPanel.id = "panel-report";
  content.appendChild(reportPanel);

  // Verify tab panel
  const verifyPanel = document.createElement("div");
  verifyPanel.className = "tab-panel";
  verifyPanel.id = "panel-verify";
  content.appendChild(verifyPanel);

  // Tab switching
  const panels = {
    "tab-demo":   demoPanel,
    "tab-report": reportPanel,
    "tab-verify": verifyPanel,
  };

  Object.entries(tabBtns).forEach(([id, btn]) => {
    btn.addEventListener("click", () => {
      Object.values(tabBtns).forEach((b) => b.classList.remove("active"));
      Object.values(panels).forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      panels[id].classList.add("active");
    });
  });

  // ── Mount panels ─────────────────────────────────────────────────────────
  const splitScreen = createSplitScreen();
  demoPanel.appendChild(splitScreen.el);

  const reportPanelComp = createReportPanel();
  reportPanel.appendChild(reportPanelComp.el);

  const verifyPanelComp = createVerifyPanel();
  verifyPanel.appendChild(verifyPanelComp.el);

  // ── Status bar ───────────────────────────────────────────────────────────
  const statusBar = document.createElement("div");
  statusBar.id = "status-bar";
  statusBar.textContent = "Ready — load a CSV to start the demo.";
  app.appendChild(statusBar);

  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  // ── Run Demo ─────────────────────────────────────────────────────────────
  let animHandle = null;
  let collectedPhysicsEvents = [];

  document.getElementById("run-btn").addEventListener("click", async () => {
    const csvPath = document.getElementById("csv-path").value.trim();
    const profileDir = document.getElementById("profile-dir").value.trim();
    const llmUrl = document.getElementById("llm-url").value.trim();
    const speedMs = parseInt(document.getElementById("speed-select").value, 10);

    if (!csvPath) {
      setStatus("Error: CSV path is required.");
      return;
    }

    // Cancel any running animation
    if (animHandle !== null) {
      clearTimeout(animHandle);
      animHandle = null;
    }

    splitScreen.reset();
    splitScreen.setConfig(profileDir, llmUrl);
    collectedPhysicsEvents = [];

    const runBtn = document.getElementById("run-btn");
    runBtn.disabled = true;
    setStatus("Running replay…");

    try {
      const result = await invoke("run_replay", {
        csvPath,
        profileDir,
      });

      setStatus(
        `Loaded ${result.frames.length} frames — animating at ${1000 / speedMs}x speed…`
      );

      // Animate frames
      let frameIndex = 0;

      function nextFrame() {
        if (frameIndex >= result.frames.length) {
          setStatus(
            `Done — Generic AI: ${result.total_generic_alerts} alerts | clarus Physics: ${result.total_physics_alerts} alerts`
          );
          runBtn.disabled = false;
          // Update report panel with collected events
          reportPanelComp.updateEvents(collectedPhysicsEvents, "Demo Site");
          return;
        }

        const frame = result.frames[frameIndex++];
        splitScreen.applyFrame(frame);

        // Collect physics events
        for (const evt of frame.physics_events || []) {
          collectedPhysicsEvents.push(evt);
        }

        animHandle = setTimeout(nextFrame, speedMs);
      }

      nextFrame();
    } catch (err) {
      setStatus(`Error: ${err}`);
      runBtn.disabled = false;
    }
  });
});
