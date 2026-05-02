# clarus — User Personas

There are four users. Each has a different problem. clarus does not solve "we have no records." It solves "our records are not trusted."

---

## Persona 1 — Kenny Lim, Port Safety Manager

- **Company:** PSA Singapore, Pasir Panjang Terminal
- **Role:** Safety & Health Manager
- **Age:** 44
- **Experience:** 15 years in port safety management

### Background

Kenny's terminal runs hundreds of forklifts and thousands of workers in the same space every month. The rules are clear — MPA Port Safety Circular 2024-07 mandates 5m clearance between powered vehicles and pedestrians. But no human operator can verify that in real time, every second, across every zone.

Last year a near-miss incident occurred. MOM requested a report. Kenny stated that the monitoring system was active at the time. He had logs. But he could not prove those logs were written when the events happened — not after the fact. MOM noted the gap.

### Goal

> "The next time MOM arrives, I want to produce a tamper-proof record — timestamped by a third party, sealed against editing — showing exactly what monitoring was active, in which zone, during which shift, and what violations were recorded."

### How Kenny uses the demo

1. Opens `/live` Operations Monitor — sees site status VALID, calibration drift stable
2. Sees a `RESTRICTED_ZONE_APPROACH HIGH` alert fire in real time
3. Clicks the alert — reads the AI-generated explanation with regulation citation
4. Sees `Evidence quality: CERTIFIED (CV confidence 0.92) — this record carries full evidential weight and is admissible in insurance claims`
5. *(coming: #55)* Opens `/audit` — sees "Chain intact — N records, 0 gaps ✅"
6. Understands: "these records are in WORM storage — Object Lock means I cannot delete them even if I wanted to"

### The moment his goal is achieved

> "I can hand this to MOM. The timestamp is in the record. The regulation clause is cited. The measured values are there. And I didn't write any of it — the system generated and signed it automatically. This is evidence I didn't produce myself."

---

## Persona 2 — Sarah Tan, Senior H&M Underwriter

**Company:** Britannia P&I Club, Singapore branch
**Role:** Senior Underwriter, Marine
**Age:** 38
**Experience:** 12 years in marine insurance underwriting

### Background

Sarah reprices terminal operator policies every renewal cycle. The data she has is almost nothing — incident counts and industry-average loss ratios. Every operator tells her their safety management is excellent. None of them can prove it with numbers.

Singapore's MOM WSH penalties have tightened. P&I claims after serious incidents are increasing. Sarah believes that if she had pre-loss behavioural data — actual near-miss frequencies from actual sites — she could price risk differently. Right now that data does not exist anywhere.

### Goal

> "I want to see how many near-misses this terminal actually generates, in a time series. If I have two years of data showing their rate is below the industry average, I have a defensible basis for a premium reduction. Right now I'm pricing on guesswork."

### How Sarah uses the demo

1. Opens `/live` — watches alert table showing rule, severity, evidence quality, confidence score
2. Understands: "if this accumulates monthly, I can calculate a near-miss frequency"
3. Clicks `RESTRICTED_ZONE_APPROACH` alert → sees "View V-001 vessel risk profile →"
4. Navigates to `/` Risk Intelligence — MV Fortune Star auto-selected
5. Reads behavioral score 74.3/100, sees AIS gaps, STS transfers, sanctions proximity
6. **Premium Impact section**: Traditional $180,000 → With EdgeSentry $340,000 (+89%)
7. Sees "Blind spot" in the traditional column for all behavioral signals
8. Understands: "the $160k gap is exactly what I'm missing in my current underwriting"

### The moment her goal is achieved

> "If a site has two years of this data — structured, timestamped, tamper-proof — I can compute their near-miss rate, compare it to my portfolio average, and put a number on the discount. That's an actuarially defensible premium reduction. I can take that to the chief underwriter. No one has brought me this before."

---

## Persona 3 — David Wong, Terminal Operations Manager

**Company:** Jurong Port, Singapore
**Role:** Terminal Operations Manager
**Age:** 51
**Experience:** 20 years in terminal operations

### Background

David has deployed three safety systems. All three failed. For the first six months, operators follow the alerts. Then false alarms accumulate — the system fires every time two entities are within 8 metres, including hundreds of safe passes per shift. Operators stop responding. Within a year the system is disabled, and the only thing left is the management report that says it was deployed.

David's reaction to "new AI safety system" is reflexive scepticism. He has heard the pitch. He knows the total cost of ownership. He knows the change management required to embed a new alert system on the floor. His standing response: "Show me something that works."

### Goal

> "I need a system that operators won't ignore. If there are no false alarms, the real alert gets attention. That's the entire requirement."

### How David uses the demo

1. Opens `/live` — filters alerts to `PROXIMITY_ALERT`
2. Sees that alerts fire only when `confidence_cv` is high and calibration is VALID
3. Expands an alert — reads "braking distance 4.1m exceeds remaining gap 3.2m — collision window: 2.3 seconds"
4. Understands: "this is physics, not pattern-matching — false alarms on a safe pass are physically impossible"
5. Checks the Evidence Quality chart — Certified (green) dominates; Rejected only during calibration degradation
6. Concludes: "operators will respond to this because it will never cry wolf"

### The moment his goal is achieved

> "If the rule is physics — braking distance versus remaining gap — then false alarms are physically impossible on a safe pass. The operator only hears the alarm when the system cannot be wrong. Six months from now the system will still be running. That's what I've been trying to buy for the last decade."

---

## Persona 4 — Inspector James Ng, MOM WSH Officer

**Company:** Ministry of Manpower, Singapore
**Role:** Workplace Safety & Health Inspector
**Age:** 35
**Experience:** 6 years in WSH Act enforcement

### Background

James conducts dozens of inspections per year. After a serious incident his primary task is to establish whether the operator's safety management system was genuinely active at the time — not installed, not licensed, but running and recording.

In most cases the operator asserts the system was active. The only evidence available is logs held by the operator themselves. James has seen the pattern: operators produce logs that cannot be verified as contemporaneous. "Having a log" and "having a log that was written when the events happened" are not the same thing. James has flagged this distinction in several enforcement proceedings.

### Goal

> "I need to verify that safety monitoring was active at the time of the incident — not from a record the operator controls, but from a record held by an independent third party that the operator cannot modify."

### How James uses the demo

1. *(coming: #55)* Opens `/audit` — sees records listed in sequence order
2. Reads "Chain intact — N records, 0 gaps ✅ — Object Lock: deletion not possible"
3. Clicks a record — sees `timestamp_ms`, `rule_id`, `severity`, `prev_hash`, `signature`
4. Understands: prev_hash linkage means any deletion or modification is detectable
5. Confirms: "the operator cannot edit this chain — it is in WORM storage and the hash chain is independently verifiable"

### The moment his goal is achieved

> "The operator cannot edit this chain. It is held in clarus's append-only cloud store. The hash linkage means any deletion or modification is cryptographically detectable. I can verify independently — without asking the operator — that the record for the day of the incident was generated on that day. This is admissible evidence."

---

## Demo feature × persona matrix

| Feature | Kenny (Safety Manager) | Sarah (Underwriter) | David (Ops Manager) | James (MOM Inspector) |
|---|---|---|---|---|
| `/live` site status + drift chart | ✓ Sees monitoring is active | — | ✓ Sees calibration quality | — |
| `/live` alert table with evidence quality | ✓ Reads regulation citation | ✓ Sees structured data fields | ✓ Confirms physics-based firing | — |
| `/live` LLM explanation | ✓ Reads plain-language alert | — | ✓ Understands physics basis | — |
| `/` vessel risk scorecard | — | ✓ Sees behavioral indicators | — | — |
| `/` premium impact (Blind spot → $340k) | — | ✓ **Core feature** | — | — |
| `/audit` chain verification *(coming: #55)* | ✓ Understands tamper-evidence | ✓ Confirms operator cannot edit | — | ✓ **Core feature** |

---

## What "goal achieved" means across all four

Every persona shares one sentence:

> **"I didn't create this record."**

Kenny: "It wasn't written by me — the system generated and signed it."
Sarah: "The operator cannot edit it — it's independent of the party with a stake in the outcome."
David: "Physics computed it — no human judgement, no threshold tuning by the operator."
James: "A third party holds it — I can verify it independently of the operator's claim."

This is the core of clarus's value. Not the existence of a record. **The independence of the record.**
