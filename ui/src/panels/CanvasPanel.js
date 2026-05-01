// CanvasPanel.js — top-down 2D canvas for zone/vessel scenarios

const CANVAS_W = 560;
const CANVAS_H = 380;
const PAD = 44;

export function createCanvasPanel({ zonePolygon = null, worldW = 800, worldH = 700 } = {}) {
  const container = document.createElement("div");
  container.className = "canvas-panel";

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.style.cssText =
    "display:block;border-radius:6px;border:1.5px solid #1a3a3a;" +
    "background:#040d0e;transition:border-color 0.25s,box-shadow 0.25s";
  container.appendChild(canvas);

  const statusEl = document.createElement("div");
  statusEl.className = "canvas-status";
  statusEl.style.cssText =
    "font-family:monospace;font-size:11px;padding:5px 8px;color:#4a5068";
  statusEl.textContent = "Waiting for demo…";
  container.appendChild(statusEl);

  const ctx = canvas.getContext("2d");

  const scaleX = (CANVAS_W - 2 * PAD) / worldW;
  const scaleY = (CANVAS_H - 2 * PAD) / worldH;
  const scale  = Math.min(scaleX, scaleY);

  const wx = (x) => PAD + x * scale;
  const wy = (y) => CANVAS_H - PAD - y * scale;

  let alertIds = new Set();

  function drawBackground() {
    ctx.fillStyle = "#040d0e";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 0.5;
    const step = worldW > 400 ? 100 : 5;
    for (let x = 0; x <= worldW; x += step) {
      ctx.beginPath(); ctx.moveTo(wx(x), PAD); ctx.lineTo(wx(x), CANVAS_H - PAD); ctx.stroke();
    }
    for (let y = 0; y <= worldH; y += step) {
      ctx.beginPath(); ctx.moveTo(PAD, wy(y)); ctx.lineTo(CANVAS_W - PAD, wy(y)); ctx.stroke();
    }

    // Axis labels
    ctx.font = "8px monospace";
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.textAlign = "center";
    const xStep = worldW > 400 ? 200 : 5;
    for (let x = 0; x <= worldW; x += xStep) {
      ctx.fillText(`${x}m`, wx(x), CANVAS_H - PAD + 13);
    }
    ctx.textAlign = "right";
    const yStep = worldH > 400 ? 200 : 5;
    for (let y = 0; y <= worldH; y += yStep) {
      ctx.fillText(`${y}m`, PAD - 4, wy(y) + 3);
    }
  }

  function drawZone(alertActive) {
    if (!zonePolygon || zonePolygon.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(wx(zonePolygon[0][0]), wy(zonePolygon[0][1]));
    for (let i = 1; i < zonePolygon.length; i++) {
      ctx.lineTo(wx(zonePolygon[i][0]), wy(zonePolygon[i][1]));
    }
    ctx.closePath();
    ctx.fillStyle = alertActive ? "rgba(255,50,50,0.14)" : "rgba(255,50,50,0.06)";
    ctx.fill();
    ctx.strokeStyle = alertActive ? "#ff4444" : "#882222";
    ctx.lineWidth = alertActive ? 2 : 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    const cx = zonePolygon.reduce((s, p) => s + p[0], 0) / zonePolygon.length;
    const cy = zonePolygon.reduce((s, p) => s + p[1], 0) / zonePolygon.length;
    ctx.font = "bold 10px monospace";
    ctx.fillStyle = alertActive ? "rgba(255,80,80,0.9)" : "rgba(255,80,80,0.45)";
    ctx.textAlign = "center";
    ctx.fillText("RESTRICTED ZONE", wx(cx), wy(cy) - 6);
  }

  function drawEntity(e) {
    const px = wx(e.x);
    const py = wy(e.y);
    const isAlert = alertIds.has(e.id);
    const cls = (e.class || "").toLowerCase();

    if (cls.includes("vessel")) {
      // Triangle pointing in direction of travel
      const angle = Math.atan2(-(e.vy || 0), e.vx || 0);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(13, 0); ctx.lineTo(-9, -7); ctx.lineTo(-9, 7);
      ctx.closePath();
      ctx.fillStyle   = isAlert ? "#ff4444" : "#4a9fd4";
      ctx.strokeStyle = isAlert ? "#ff9999" : "#70c0f0";
      ctx.lineWidth   = 1.5;
      ctx.fill(); ctx.stroke();
      ctx.restore();

      // Wake line
      const spd = Math.sqrt((e.vx || 0) ** 2 + (e.vy || 0) ** 2);
      if (spd > 0) {
        const angle2 = Math.atan2(e.vy || 0, e.vx || 0);
        ctx.beginPath();
        ctx.moveTo(px - Math.cos(angle2) * 14, py + Math.sin(angle2) * 14);
        ctx.lineTo(px - Math.cos(angle2) * 36, py + Math.sin(angle2) * 36);
        ctx.strokeStyle = isAlert ? "rgba(255,68,68,0.3)" : "rgba(70,160,212,0.25)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (cls.includes("forklift")) {
      ctx.save();
      ctx.translate(px, py);
      ctx.fillStyle   = isAlert ? "#ff4444" : "#c0620f";
      ctx.strokeStyle = isAlert ? "#ff9999" : "#e67e22";
      ctx.lineWidth = 1.5;
      ctx.fillRect(-10, -7, 20, 14);
      ctx.strokeRect(-10, -7, 20, 14);
      // Arrow
      ctx.fillStyle = isAlert ? "#ffcccc" : "#f8c39a";
      ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("→", 0, 4);
      ctx.restore();
    } else {
      // Worker / default: circle
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle   = isAlert ? "#ff4444" : "#1a6ea8";
      ctx.strokeStyle = isAlert ? "#ff9999" : "#4a9fd4";
      ctx.lineWidth = 1.5;
      ctx.fill(); ctx.stroke();
      ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
      ctx.fillStyle = "#c9d1d9";
      ctx.fillText("P", px, py + 4);
    }

    // ID label
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = isAlert ? "#ff9999" : "#c9d1d9";
    ctx.textAlign = "center";
    ctx.fillText(e.id, px, py - 17);

    if (isAlert) {
      ctx.font = "bold 10px monospace";
      ctx.fillStyle = "#ff4444";
      ctx.fillText("⚠", px, py - 27);
    }
  }

  function draw(entities, events) {
    alertIds = new Set((events || []).flatMap(e => e.entity_ids || []));
    const hasAlert = alertIds.size > 0;

    drawBackground();
    drawZone(hasAlert);
    (entities || []).forEach(drawEntity);

    if (hasAlert) {
      canvas.style.borderColor = "#ff4444";
      canvas.style.boxShadow = "0 0 14px rgba(255,68,68,0.4)";
      const reg = events[0].regulation;
      statusEl.textContent = `🚨 ${events[0].rule_id} — ${reg.length > 70 ? reg.slice(0, 70) + "…" : reg}`;
      statusEl.style.color = "#ff8787";
    } else {
      canvas.style.borderColor = "#1a3a3a";
      canvas.style.boxShadow = "";
      statusEl.textContent = (entities || []).length > 0
        ? `✓ Monitoring ${entities.length} entity — no alerts`
        : "Waiting for demo…";
      statusEl.style.color = "#69db7c";
    }
  }

  function reset() {
    alertIds = new Set();
    ctx.fillStyle = "#070a14";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    canvas.style.borderColor = "#1a3a3a";
    canvas.style.boxShadow = "";
    statusEl.textContent = "Waiting for demo…";
    statusEl.style.color = "#4a5068";
  }

  return { el: container, draw, reset };
}
