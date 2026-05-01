MPA Port Marine Notice — AIS Carriage and Transmission Requirements in Singapore Port Waters

All vessels of 300 GT and above, and all vessels engaged in international voyages, are required to maintain continuous AIS transmission while within Singapore port limits (SOLAS Chapter V, Regulation 19; MPA Port Marine Circular No. 1 of 2023).

An AIS track gap — defined as an absence of AIS position reports for a period exceeding 8 minutes from a vessel whose last known position was within port limits — is treated as a potential regulatory violation and a maritime security indicator. Common causes include:

- Deliberate AIS switch-off (potential shadow fleet behaviour or evasion of port state control)
- Technical failure of the AIS transponder (reportable under MPA regulations)
- GNSS jamming or spoofing affecting position fix (reportable)

The MPA Vessel Traffic Information System (VTIS) monitors AIS continuity for all vessels within the Traffic Separation Scheme and Singapore Strait. Vessels that cannot account for a track gap are subject to inspection on arrival and may be referred to the Port Master for investigation under the Maritime and Port Authority of Singapore Act (Cap. 170A), Section 43.

--- ENGINE SUPPORT NOTE ---

AIS_TRACK_GAP detection requires a stateful evaluator that tracks the last-seen timestamp per entity across consecutive EntityFrames. The current clarus physics engine evaluates each frame independently (stateless).

This rule will be added to rules.json once the stateful track-gap condition type (`track_gap > 480000` in milliseconds) is implemented in the engine. Planned rule format:

  {
    "rule_id": "AIS_TRACK_GAP",
    "condition": "track_gap > 480000",
    "severity": "HIGH",
    "regulation": "MPA Port Marine Circular No. 1 of 2023 — AIS carriage and transmission; SOLAS Chapter V Regulation 19"
  }

See: edgesentry-rs issue — feat(evaluate): stateful track-gap condition for AIS silence detection.
