const DOCUMARIS_URL = "https://documaris.edgesentry.io";

export function updateDocumarisLink(mmsi: string | number): void {
  const el = document.getElementById("sc-documaris-link") as HTMLAnchorElement | null;
  if (!el) return;
  el.href = `${DOCUMARIS_URL}?mmsi=${mmsi}`;
  el.style.display = "inline";
}
