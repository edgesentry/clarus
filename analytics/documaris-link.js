const DOCUMARIS_URL = "https://documaris.edgesentry.io";

export function updateDocumarisLink(mmsi) {
  const el = document.getElementById("sc-documaris-link");
  if (!el) return;
  el.href = `${DOCUMARIS_URL}?mmsi=${mmsi}`;
  el.style.display = "inline";
}
