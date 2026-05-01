/**
 * EventFeed — reusable event list component.
 * Returns a <ul> element and an append(event, isGeneric) function.
 */
export function createEventFeed() {
  const ul = document.createElement("ul");
  ul.className = "event-list";
  ul.style.listStyle = "none";

  function severityClass(severity, isGeneric) {
    if (isGeneric) return "sev-generic";
    switch ((severity || "").toUpperCase()) {
      case "CRITICAL": return "sev-critical";
      case "HIGH":     return "sev-high";
      case "MEDIUM":   return "sev-medium";
      default:         return "sev-low";
    }
  }

  function formatTs(ms) {
    const s = (ms / 1000).toFixed(1);
    return `${s}s`;
  }

  function append(event, isGeneric = false, onClick = null) {
    const li = document.createElement("li");
    li.className = "event-item";

    const sevClass = severityClass(event.severity, isGeneric);
    const label = isGeneric ? "GENERIC" : (event.severity || "LOW").toUpperCase();
    const entities = (event.entity_ids || []).join(", ");

    li.innerHTML = `
      <span class="event-ts">${formatTs(event.timestamp_ms)}</span>
      <span class="severity-badge ${sevClass}">${label}</span>
      <span class="event-rule">${event.rule_id}</span>
      <span class="event-entities">${entities}</span>
    `;

    if (onClick) {
      li.style.cursor = "pointer";
      li.addEventListener("click", () => onClick(event));
    }

    ul.appendChild(li);
    ul.scrollTop = ul.scrollHeight;
    return li;
  }

  function clear() {
    ul.innerHTML = "";
  }

  return { el: ul, append, clear };
}
