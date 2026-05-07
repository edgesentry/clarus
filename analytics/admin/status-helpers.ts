// Pure helpers for status.ts — extracted so they can be unit-tested without a DOM.

export function ageStr(ms: number): string {
  if (ms === 0) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function ageClass(ms: number): "green" | "amber" | "red" {
  if (ms === 0) return "red";
  const s = (Date.now() - ms) / 1000;
  if (s < 120)  return "green";
  if (s < 600)  return "amber";
  return "red";
}

export function dotClass(ms: number): "dot-green" | "dot-amber" | "dot-red" {
  if (ms === 0) return "dot-red";
  const s = (Date.now() - ms) / 1000;
  if (s < 120)  return "dot-green";
  if (s < 600)  return "dot-amber";
  return "dot-red";
}
