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

### How Kenny uses the demo app

1. **Presses Run Demo** — the forklift-approaches-worker scenario plays back
2. Sees the left panel fire 4 alerts on a safe pass — recognises "this is the problem with what I have now"
3. Sees the right panel stay silent until the real danger moment — "this is what I need"
4. Clicks the HIGH event — reads `"Forklift FL-01 is 3.2m from Worker W-03 — below the 5m minimum required under MPA Port Safety Circular 2024-07 §3.1. Braking distance 4.1m exceeds remaining gap. Collision window: 2.3 seconds."`
5. **Presses Generate MOM Report** — PDF opens automatically
6. Reads the PDF: timestamp, regulation citation, measured value, threshold — all present

### The moment his goal is achieved

> "I can hand this to MOM. The timestamp is in the PDF. The regulation clause is cited. The measured values are there. And I didn't write any of it — the system generated and signed it automatically. This is evidence I didn't produce myself."

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

### How Sarah uses the demo app

1. **Presses Run Demo** — watches the right panel event feed
2. Reads the structured data on each event: `rule_id: PROXIMITY_ALERT, severity: HIGH, measured_value: 3.2, threshold: 5.0, regulation: MPA §3.1`
3. Understands: "if this accumulates monthly across a site, I can calculate a near-miss frequency and compare it against my book"
4. **Opens the Verify Audit Chain tab** — pastes an AuditRecord JSON, presses Verify
5. Sees `"✓ Chain valid — 7 records, no tampering detected"` — understands the data cannot be edited by the operator

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

### How David uses the demo app

1. **Presses Run Demo** — sees the left panel fire 4 times on the same safe pass and grimaces: "that's what I have"
2. Watches the right panel: silent, silent, silent — then 🚨 STOP. Leans forward.
3. Clicks the HIGH event — reads `"braking distance 4.1m exceeds remaining gap 3.2m — collision window: 2.3 seconds"`
4. Realises: "this is physics, not pattern-matching. The system is asking 'can this forklift stop in time?' not 'are these two objects close?'"
5. Compares 4 false alarms on the left to 1 correct alert on the right — "operators will respond to this"

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

### How James uses the demo app

1. Receives an AuditRecord JSON from the operator
2. **Opens the Verify Audit Chain tab** — pastes the JSON, presses Verify Chain
3. Reads `"✓ Chain valid — 7 records, no tampering detected"`
4. Inspects individual records: `timestamp_ms`, `rule_id`, `severity`, `prev_record_hash`
5. Confirms the chain is continuous and each `prev_record_hash` links correctly to the previous record

### The moment his goal is achieved

> "The operator cannot edit this chain. It is held in clarus's append-only cloud store. The hash linkage means any deletion or modification is cryptographically detectable. I can verify independently — without asking the operator — that the record for the day of the incident was generated on that day. This is admissible evidence."

---

## Demo app feature × persona matrix

| Feature | Kenny (Safety Manager) | Sarah (Underwriter) | David (Ops Manager) | James (MOM Inspector) |
|---|---|---|---|---|
| Run Demo — split-screen | ✓ Recognises false alarm problem | ✓ Sees data structure | ✓ Confirms zero false alarms | — |
| Event Detail — explanation | ✓ Reads regulation citation | ✓ Reads structured fields | ✓ Understands physics basis | — |
| Generate MOM Report | ✓ **Core feature** | ✓ Sees monthly report format | — | ✓ Sees record format |
| Verify Audit Chain | ✓ Understands tamper-evidence | ✓ Confirms operator cannot edit | — | ✓ **Core feature** |

---

## What "goal achieved" means across all four

Every persona shares one sentence:

> **"I didn't create this record."**

Kenny: "It wasn't written by me — the system generated and signed it."
Sarah: "The operator cannot edit it — it's independent of the party with a stake in the outcome."
David: "Physics computed it — no human judgement, no threshold tuning by the operator."
James: "A third party holds it — I can verify it independently of the operator's claim."

This is the core of clarus's value. Not the existence of a record. **The independence of the record.**
