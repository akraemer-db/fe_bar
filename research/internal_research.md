# FE Bar Research: Frac Pump Predictive Maintenance (Oilfield Services)

Status: PARTIAL. Internal sources (Glean, Confluence) were unavailable during this run. Sections 1 and 4 are not populated from internal docs. Sections 2 and 3 come from public web search results, not from internal Databricks docs.

## Access status

| Source | Result |
|---|---|
| Glean (search, glean_chat, get_document_content) | Failed on every call: OAuth `invalid_grant`, refresh token invalid or expired. Fix: revoke and re-login to the UC connection at https://dbc-a5d4177a-49dc.cloud.databricks.com/explore/connections/glean-mcp |
| Confluence (search_confluence_pages) | Failed on every call: OAuth `unauthorized_client`, refresh token invalid. Fix: `/mcp reconnect`, or revoke and re-login at https://dbc-a5d4177a-49dc.cloud.databricks.com/explore/connections/confluence-mcp |
| Slack (search.messages for "FE Bar" rubric) | Ran without error, returned 0 matches. Not a reliable negative given the query form. |
| Public web search | Working. Results below are summaries and need link-level verification before use in a deck. |

Once the Glean and Confluence connections are re-authenticated, the next pass should target:
- FE Bar rubric, scoring domains, and pass tips (Glean `glean_chat` plus search on "FE Bar", "FE Bar evaluation", "FE bar submission")
- Official Industry Outcome Map for Energy and Utilities (internal Confluence or Glean; the public copy noted below is third-party)
- POC and DOC templates (`fe-workflows:fe-poc-doc` plugin and the internal POC/DOC Confluence space)

## 1. FE Bar evaluation (NOT RETRIEVED)

No rubric, scoring domains, evaluator guidance, failure reasons, or deck guidance were retrieved. Do not treat any of the following as sourced FE Bar guidance. Items the user listed (Build domain, Customer Skills domain, tell-show-tell, leading with value, exec sponsor vs domain owner framing) remain unverified.

## 2. Industry Outcome Map: Energy / Oil and Gas (PUBLIC, SECONDARY)

Source: web search summary of the Databricks Energy and Utilities Data Intelligence Outcome Map, FY26 Industry Data Intelligence Outcome Maps.

- Public copy (third party, not verified as the current approved version): https://www.scribd.com/document/993322469/Fy26-Industry-Data-Intelligence-Outcome-Mapspartner-Facing-1 (high-level Energy and Utilities map on slide 28, detailed map on slide 30)
- Event page referencing the Energy and Utilities outcome map: https://answers.databricks.com/energy-utilities-industry-forum-sponsored-by-deloitte-aws-wLcwFueRZFo

Three outcome pillars and oil and gas use cases, as summarized:

| Pillar | Business objectives | O&G use cases |
|---|---|---|
| Optimize operations | Asset management and safety; process and operations efficiency | Predictive maintenance, equipment condition tracking, workplace safety, subsurface analysis, field development, drilling and completions, production optimization, well abandonment, CO2 capture and storage |
| Streamline functions | Compliance and reporting; enterprise BI | Sustainability reporting, regulatory filings, supply-chain analytics, finance and legal analytics, demand-supply and risk analysis, transaction management |
| Collaborate and protect data/IP | Customer experience; data sovereignty and cybersecurity | Data-provider collaboration, contract management, customer 360, contact-center automation, data privacy, industrial control-system security |

KPIs and value metrics listed on the map: asset uptime, mean time between failures (MTBF), mean time to repair (MTTR), asset turnover, inventory levels, cost per BOE ($/BOE), carbon intensity, daily P&L, time saved through automation.

Relevant for this demo: the predictive maintenance use case under "Optimize operations," with uptime, MTBF, and MTTR as the primary KPIs. NPT (non-productive time) is not named on the public summary; it should be mapped to uptime and MTTR, or confirmed against the internal map.

Public Databricks examples on the same theme (from answers.databricks.com and databricks.com summaries):
- Asset health and predictive maintenance, pipeline monitoring to reduce downtime: https://answers.databricks.com/transforming-energy-asset-health-predictive-maintenance-databricks-8wTxKQVaT3A
- Chevron, refinery KPIs and real-time margin insights, and Shell, natural-gas market analysis: https://answers.databricks.com/operational-intelligence-energy-databricks-at-scale-across-chevron-shell-constel-tJ11pu97hUo
- Shell, spare-parts inventory simulation: https://www.databricks.com/customers/shell

## 3. Assets for predictive maintenance (PUBLIC)

### Demos and accelerators
- dbdemos `lakehouse-iot-platform` (wind turbine predictive maintenance). Covers streaming sensor ingestion, Unity Catalog governance, dashboards, AutoML fault detection, workflow orchestration, and a GenAI maintenance agent.
  - Demo page: https://www.databricks.com/resources/demos/tutorials/lakehouse-platform/iot-and-predictive-maintenance
  - Notebook browser: https://notebooks.databricks.com/demos/lakehouse-iot-platform/
  - Install: `%pip install dbdemos` then `dbdemos.install("lakehouse-iot-platform")`. Notebooks: `04.1-automl-iot-turbine-predictive-maintenance`, `04.3-running-inference-iot-turbine`, `05.1-ai-tools-iot-turbine-prescriptive-maintenance`, `05.2-agent-creation-guide`.
  - Caveat: installs create billable resources (clusters, pipelines, SQL warehouses). Demos are unsupported as-is. Source: https://github.com/databricks-demos/dbdemos
- Adaptation note: this is a wind turbine demo. For frac pumps, reuse the pattern (sensor ingestion, AutoML, inference, agent) and swap in pressure, vibration, temperature, and fluid-end or power-end failure labels.

### Customer references (public, verifiable)
- Beusa Energy, hydraulic fracturing telemetry with Zerobus Ingest: https://www.databricks.com/customers/beusa-energy/zerobus-ingest
  - Use case: high-frequency equipment telemetry with maintenance history to forecast remaining useful life of frac assets and high-wear components.
  - Scale: more than 6,000 devices, about 250 remote assets, about 22 million rows per day.
  - Reported results: over 99% lower ingestion cost, about 3 second sensor-to-query latency.
  - Caveat: predictive maintenance is described as in progress. Do not cite a pump-failure reduction from this story.
- Canary Labs and Evolution Well Services (NOT a Databricks story): https://www.canarylabs.com/resources/case-studies/evolution-well-services
  - Reports 63% longer fluid-end life, attributed to Canary-based analysis, with a mention of feeding data to Databricks. Cite only as a partner or third-party story, and verify the Databricks role before use.
- Shell and Chevron stories above are useful for enterprise O&G context, not for predictive maintenance outcomes specifically.

### Reference architecture (proposed, not a packaged Databricks solution)
Public guidance supports this split. Verify against internal Lakebase and Apps reference docs before the deck.
- Lakehouse (Delta, Unity Catalog): bronze raw telemetry, silver validated signals with asset context, gold features, health, risk, and maintenance KPIs.
- ML: MLflow-managed models producing failure probability or RUL estimates; predictions persisted in gold.
- Lakebase: synced tables as read-only serving projections (asset health, asset risk); separate writable workflow tables (alert, alert_action, work_order_request, integration_outbox).
- Databricks App: asset health and risk queue, asset detail and trends, acknowledge, assign, approve. Writes workflow state and an outbox event in one transaction.
- Genie: conversational analytics over curated gold datasets via a SQL warehouse. Keep it analytical; route maintenance actions through app APIs with validation and approval.
- Integration worker: idempotent submission to CMMS/EAM; record external work-order ID.
- Feedback loop: confirmed failures and outcomes returned to Delta for evaluation and retraining.

Production notes from the same source:
- Apps identity: connecting Lakebase as an app resource creates an app service principal Postgres role. Design user-level authorization separately if needed.
- Lakebase change data feed (CDF) to Delta is Public Preview. Confirm availability before depending on it: https://docs.databricks.com/aws/en/oltp/projects/lakebase-cdf
- Synced tables: https://docs.databricks.com/aws/en/oltp/projects/sync-tables
- Apps with Lakebase: https://docs.databricks.com/aws/en/oltp/projects/databricks-apps
- Apps auth: https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth
- Position as decision support, not the equipment's protective shutdown or safety control.

Public architecture overview: https://developers.databricks.com/perspectives/databricks-supports-predictive-maintenance-iot-analytics-for-energy-operations

## 4. POC / DOC templates (NOT RETRIEVED)

No internal POC or DOC template was retrieved. Suggested next step: fetch `fe-workflows:fe-poc-doc` output format and the internal POC/DOC template once Confluence is re-authenticated. Until then, the deck's next-steps slide should use a generic structure (scope, success criteria with baseline and target KPI, data sources, timeline, exit or DOC criteria) and be checked against the internal template.

## 5. Gaps and follow-ups

1. Re-authenticate Glean (glean-mcp) and Confluence (confluence-mcp) connections, then rerun sections 1 and 4.
2. Confirm the approved internal Energy and Utilities Outcome Map. The Scribd copy is third-party.
3. Confirm whether NPT is a named KPI on the internal map or should be mapped to uptime and MTTR.
4. Verify all public links before citing them in the deck.
5. No customer data was used. All references are public.
