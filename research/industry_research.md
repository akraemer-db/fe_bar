# Industry Research: Frac Pump Predictive Maintenance

Compiled 2026-10-28 from public sources. Every number carries a source and a confidence rating. Treat "assumption" rows as values to confirm in customer discovery.

## 1. Headline numbers

| # | Metric | Value | Source | Confidence |
|---|---|---|---|---|
| 1 | Full-spread frac downtime cost | ~$14,500/hr (2015): $10,400 pumping + $4,200 other services | SLB/Cameron, "Achieving operational efficiency in unconventional stimulations" (2015) https://www.slb.com/resource-library/industry-article/sur/achieving-operational-efficiency-in-unconventional-stimulations-ia | Med (dated) |
| 2 | Revenue per active fleet | ~$70-80M/yr, ~$200k per calendar day | ProPetro 2025 10-Q/10-K, calculated https://ir.propetroservices.com | High (calc) |
| 3 | Frac segment adj. EBITDA per fleet | ~$15-21M/yr (ProPetro); ProFrac margins 6-12% in 2025 | ProPetro Q1-Q4 2025; ProFrac Q2/Q3 2025 8-K https://www.sec.gov/Archives/edgar/data/1881487/000110465925074901/tm2522742d1_ex99-1.htm | High (calc) |
| 4 | Liberty Energy scale | ~40 active fleets, $4.0B revenue FY2025 | Liberty FY2025 10-K https://www.sec.gov/Archives/edgar/data/1694028/000169402826000006/lbrt-20251231.htm | High |
| 5 | Permian fleet size | 50,000-80,000 HHP | ProPetro FY2025 10-K https://www.sec.gov/Archives/edgar/data/1680247/000168024726000028/pump-20251231.htm | High |
| 6 | Stages per day | 8.9-9.8 (continuous pumping); 19-23 simul-frac | AADE 2025 https://www.aade.org/download_file/4967/664 | High |
| 7 | Share of frac lost time from pumps | ~33% | DMS Solutions patent US12006805B2 https://patents.google.com/patent/US12006805B2/en | Low-Med |
| 8 | Stainless fluid end life | ~1,600 pumping hrs (industry average); premium 2,500+ | SPM https://www.spmoilandgas.com/en_US/resources/news/spm-exl-fluid-ends-2500-hours.html | Med (OEM) |
| 9 | Carbon steel fluid end life | 100-500 pumping hrs | Kerr Pumps https://kerrpumps.com/5failures | Med (OEM) |
| 10 | Valve seat life | 40-100 pumping hrs | Kerr Pumps https://kerrpumps.com/5failures | Med (OEM) |
| 11 | Condition monitoring extends valve life | 22 hrs (scheduled) to 28 hrs avg (condition-based), +27% | Baker Hughes Bently Nevada Orbit https://www.bakerhughes.com/bently-nevada/orbit-home/orbit-article/reciprocating-pumps-condition-monitoring | Med (vendor) |
| 12 | Replacement fluid end | $40-90k (planning $65k) | Kerr techbook; supplier listings | Med |
| 13 | Fluid end consumables overhaul | $3,300-5,200 | Supplier estimate (QPA2500) | Low-Med |
| 14 | Major power end rebuild | $45-100k (planning $70k); FTSI benchmark $45k (2020) | FTSI investor deck 2020 https://s22.q4cdn.com/750521035/files/doc_presentations/2020/03/FTSI-Credit-Suisse-25th-Annual-Energy-Summit_03.02.2020.pdf | Med |
| 15 | Complete 2,500 HHP pump unit (used) | $375-610k | Dealer listings | Med |
| 16 | PdM in upstream O&G | 20-30% less unplanned downtime | McKinsey, "Harnessing volatility" https://www.mckinsey.com/capabilities/operations/our-insights/harnessing-volatility-technology-transformation-in-oil-and-gas | High (analyst) |
| 17 | PdM maintenance cost | 5-10% lower (cross-industry); >10% (McKinsey offshore) | Deloitte PdM position paper https://www.deloitte.com/content/dam/assets-zone2/de/de/docs/about/2024/Deloitte_Predictive-Maintenance_PositionPaper.pdf | High (analyst) |
| 18 | Evolution Well Services | +63% fluid end life (root-cause analytics, not a PdM model) | Canary case study https://www.canarylabs.com/resources/case-studies/evolution-well-services | Med |
| 19 | Evolution / ifm PdM | 85% initial accuracy predicting consumable/component failures | ifm https://www.ifm.com/us/en/shared/successstories/reports/evolution-well-services-enables-predictive-maintenance | Med |
| 20 | Raw sensor data volume | ~1 TB/day per 20-pump fleet (6 vib ch @ 25.6 kHz + 2 pressure @ 2 kHz) | Calculated from published sampling rates | Med (calc) |
| 21 | Databricks reference: Beusa Energy (frac) | 6,000+ devices, ~250 assets, 1 Hz, ~22M rows/day, ~3 s latency; ingestion 689 to 0.29 DBU/GB (>99% lower) after replacing SQL Statement API writes with Zerobus | https://www.databricks.com/customers/beusa-energy/zerobus-ingest (verified 2026-10-28) | High (public) |

Caveats to carry into the deck:
- One failed pump is not automatically full-spread NPT. Standby pumps absorb many failures, but the spread still slows or stops while it swaps, and losing a second pump on a stage often forces a shutdown.
- The $14,500/hr figure is from 2015 and includes the operator's other services. For the pumper's own P&L, use about $10,400/hr of lost pumping revenue, which matches $250k per operating day.

## 2. Failure modes and sensor signatures

| Failure mode | Mechanism | Leading signals (what the synthetic data will encode) | Typical lead time | Cost if missed vs caught |
|---|---|---|---|---|
| Valve / seat wear leading to washout | Abrasive proppant erodes the sealing face; debris or spring failure; a leak path erodes the seat deck | Rising cylinder-local high-frequency vibration (valve impact energy), shifting valve event timing, growing discharge pressure pulsation, falling volumetric efficiency (rate per RPM) | 2-10 pumping hrs (1-4 stages) | Seat deck washout retires the fluid end ($65k + NPT) vs a $3-5k valve/seat change in a stage gap |
| Packing leak / jetting | The leak cuts a channel and erodes the packing bore | Rising packing-area temperature, more lube consumption, small loss of rate per RPM | 4-20 hrs | Bore erosion means fluid end repair vs a packing change |
| Packing overheat (lube failure) | Blocked lube line or overcompressed packing | Packing temperature spikes, lube pressure drops at the point of delivery | 1-6 hrs | Plunger and bore damage |
| Cavitation (low suction / boost) | Suction pressure below NPSH requirement, often at high HHP demand | Low suction pressure, broadband vibration with high kurtosis, pressure spikes | Continuous; damage builds up | Shortens fluid end life (the Evolution root cause) |
| Power end bearing wear | Fatigue, lube degradation | Rising low-frequency vibration RMS on the crank, rising lube oil temperature, falling lube pressure, rising iron ppm | 20-100 hrs | $70k rebuild + 4 hrs NPT vs a $6-10k bearing overhaul |
| Fluid end fatigue crack | Cyclic pressure at intersecting bores | Hard to detect from vibration; correlates with cumulative high-pressure hours and pressure cycles | Life-based | Retirement; NDE inspection |

Instrumentation pattern: fluid-end accelerometers with a crank-angle reference, plus suction and discharge pressure synchronized to RPM (Bently Nevada). For packing, monitor leaks, packing temperature, and per-point lube delivery (GD Energy Products).

## 3. Operations and personas

- **Exec sponsor:** VP Operations or COO. Cares about fleet utilization, revenue per fleet, EBITDA per fleet, NPT %, and safety (people in the red zone).
- **Domain owner:** Director of Fleet Maintenance or Reliability Engineering. Cares about MTBF, MTTR, maintenance cost per stage, fluid end life in pumping hours, consumables spend, and parts inventory.
- **Field service supervisor and technicians:** need a ranked list of which pump to touch in the next stage gap, the parts kit, and the work order.
- **Frac supervisor (on location):** needs to know whether the spread can finish the stage with N pumps online, and when to bring a standby pump online.
- **How maintenance works on location:** short windows between stages for valve and seat changes, hot-swapping standby units, a field service crew per fleet, and a central shop for power end and fluid end rebuilds.

## 4. Data scale

- **Vibration:** about 25.6 kS/s per channel. Dynamic pressure: 1-2 kS/s. Process trends: 1-10 Hz.
- **Volume:** up to about 1 TB/day raw per fleet (20 pumps, 24/7, 4-byte samples). The realistic pattern is edge feature extraction: crank-angle-synced valve impact energy, band RMS, and kurtosis computed from the waveform at the edge. The demo ingests **5-minute edge-computed features**, which matches how pumpers backhaul data over cellular or satellite links.

## 5. Operating-hours benchmarks (added cycle 2)

| Metric | Value | Source | Confidence |
|---|---|---|---|
| On-pad pumping hours per day | ~21 hrs (2024) to ~22 hrs (2025) | Patterson-UTI Feb 2026 investor presentation, slide 11 https://s202.q4cdn.com/927518908/files/doc_presentation/12/February-2026_PTEN_Investor_Presentation_.pdf | Med (company estimate) |
| Continuous pumping comparison | 19.5-19.9 pumping hrs/day | AADE-25-NTCE-033 https://www.aade.org/download_file/4967/664 | High |
| Single-fleet record | 7,143 pumping hrs/yr (fleet level, not per pump) | Liberty 2024 annual report | High |
| Non-pumping time is not NPT | Non-pumping includes stage transitions; NPT must come from coded delay events | AADE 2025 | High |
