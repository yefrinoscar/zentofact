# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# Build Tools
- Use Vite for building. Confidence: 0.85
- Do not use pnpm. Confidence: 0.85

# UI/UX
See [ui/ux/taste.md](ui/ux/taste.md)
- In the individual emission form, when the user switches company, also update the correlative to match the selected company's correlatives — do not keep stale correlative data from the previous company. Confidence: 0.70
- For the individual emission form, auto-default client document type to RUC ("6") for both boletas and facturas — do not let the user manually toggle between document types. Remove the client document type dropdown. Confidence: 0.70
- In the individual emission form, auto-select the first branch by default and hide the branch selector from the UI — the user should not need to manually pick a branch. Confidence: 0.70
- Use shadcn/ui components by default (Select, DatePicker with Range Calendar, etc.) — prefer shadcn over custom or alternative UI components. Confidence: 0.75
- For the individual emission form, use a step-by-step stepper/wizard pattern instead of a flat grid layout — show one section at a time with click-to-progress progression. Confidence: 0.70
- The individual emission form must let the user choose between document types (boleta/factura) — do not hardcode it to only factura or only boleta. Provide a selector for tipo de documento (e.g., 03 for boleta, 01 for factura) at the start of the flow. Confidence: 0.70
- When the user provides a total/con-IGV price per item, auto-calculate the base (sin IGV) and IGV automatically — do not ask the user to enter IGV or base prices manually. IGV is always 18% unless specified otherwise. Confidence: 0.75
- Do not ask the user to enter the correlative (it's auto-generated from the database correlatives table). The form only needs: company, branch, serie, client data, and items with total prices. Confidence: 0.70
- Display errors in red text with precise indication of where the error occurred (which step, which element, what operation was being attempted). Confidence: 0.80
- For number inputs in forms (quantity, amount), do not use `min` attribute values that prevent clearing the field — prefer allowing empty/zero values so users can freely type and edit. Confidence: 0.70
- Don't ship broken or blank UI sections/screens — either fix them to work properly or remove them from the UI entirely. Confidence: 0.70
- After scraper extraction completes, surface the export/download button in the workflow execution/results area (not in the preflight section). Make it clearly visible as a call-to-action. Confidence: 0.75
# Architecture
- Prioritize simplicity and avoid over-engineering. Confidence: 0.85
- User-configured output directories must be respected by all internal file-saving functions; do not bypass configured paths with hardcoded environment variable defaults like `STORAGE_PATH || './storage'`. Confidence: 0.80

# Workflow
- Use plan mode to show design/flow before implementing. Confidence: 0.80
- Date ranges are passed as parameters; default to last 7 days. Confidence: 0.80
- Include the current workflow step name/number in error logs when a multi-step process fails; always show workflow step context so the user knows exactly where it broke. Confidence: 0.80

# Falabella API
See [falabella-api/taste.md](falabella-api/taste.md)
# Desktop App
- Place beta/production mode toggle in the header, well-organized. Confidence: 0.70
- Place output directory configuration in Settings/Ajustes, not inside workflow steps (e.g., not in Paso 3: Emitir). Confidence: 0.75

# Development Badge
- Do not use "Beta" tags inside form UIs — instead, add a "Desarrollo" (Development) badge in the sidebar above the user info to indicate the app is in development mode. Confidence: 0.70

# Scraper
See [scraper/taste.md](scraper/taste.md)
- When importing JSON files, accept multiple structural formats: direct array `[...]`, `{ orders: [...] }`, `{ data: [...] }`, or auto-detect any array property in the object. Don't assume a single hardcoded field name. Confidence: 0.70
# strong-soap / SUNAT
See [strong-soap-/-sunat/taste.md](strong-soap-/-sunat/taste.md)
# Falabella Testing
- Do not test the Falabella scraper in headless mode — the site behaves differently (modals may not appear) and testing requires headed/visible browser. Confidence: 0.70

# Scraper Session
- Detect and reuse existing Falabella sessions (localStorage/cookies) instead of re-authenticating. If a valid session exists, skip login and go directly to "buscar órdenes sin documento". Confidence: 0.75
- Inject localStorage data to suppress modals/coachmarks/tours on Falabella (e.g., `tour_storage`, `common-coach-mark`, `settlement-invoice-columns`, `ngTempFbsOrders`). Confidence: 0.70
- Split Falabella workflow into two distinct tracked steps: (1) "buscar órdenes sin documento" (filter pending orders) and (2) leer detalle de cada orden/venta (read each order detail). Confidence: 0.80
- When a modal appears during Falabella scraping, detect it and click the cancel/close button. For settlement modals, target `.settlement-invoice-btn-color-default.settlement-invoice-btn-variant-outlined` containing "Cancelar". During pagination (filtrar_ventas), use aggressive modal dismissal: run dismissModals before page.goto, after page.goto, on a fast 200ms interval, and proactively target the "experiencia de carga de documentos tributarios" feedback modal by its `.settlement-invoice-modal-content` wrapper. Confidence: 0.85

# Debugging
- On scraper/SUNAT error, capture a screenshot automatically and show a "Ver screenshot" button to view it — do not embed the screenshot directly in the UI. Confidence: 0.80
- Provide an HTML viewer button to inspect the current page DOM when debugging scraper issues, so the user can identify what modals/elements are present. Confidence: 0.75

# PDF Styling
- Use larger font sizes in generated PDFs. Confidence: 0.80
- Do not use red text in PDFs; use the same blue color scheme used for customer info sections throughout the entire document. Confidence: 0.80
- Place the company address directly below the logo in generated PDFs. Confidence: 0.80

# Resumen Diario
- Track and display the resumen diario (daily summary) with its individual boletas in a dedicated tab. Show summary status, boleta list with order numbers, and a consult/refresh button per summary. Confidence: 0.80
- When registering a resumen in the database, include the order number for each boleta so PDFs can be generated later using `{orderNumber}_{serie}-{documentoCliente}.pdf` format. Confidence: 0.80
- Generate PDFs for all boletas in a summary with a single "Generar PDFs" button. Show a loading indicator during generation and enable "Abrir carpeta" button once complete. Use the summary ID as the output folder name. Confidence: 0.80

# SUNAT Boleta Values
- When calculating SUNAT boleta values from Falabella grand totals: the grand total already includes 18% IGV. Calculate `mtoValorUnitario` by dividing the item's grand total amount by 1.18 (removing IGV), never by adding 18% on top. Verify that the sum of all base values plus IGV matches the original grand total. Confidence: 0.70

# PDF Generation
- Use Puppeteer (HTML-to-PDF) for PDF generation instead of pdfmake. Confidence: 0.85
- Export boleta PDFs with the naming format `{orderNumber}_{serie}-{documentoCliente}.pdf` (e.g., `3235236725_B001-10134529.pdf`). Confidence: 0.92
- Display monetary amounts using the S/ symbol instead of the currency code (e.g., `S/ 3,138.80` not `PEN 3,138.80`). Confidence: 0.65
- pdfmake in Node.js does NOT auto-load `vfs_fonts.js` (that's browser-only). In Node.js, pass font data as Buffers: read `vfs_fonts.js`, extract base64-encoded TTF strings, convert with `Buffer.from(data, 'base64')`, and pass to `new PdfPrinter({ Roboto: { normal: buffer, bold: buffer, ... } })`. Passing string paths like `'Roboto-Medium.ttf'` causes pdfmake to try `fs.readFileSync()` on those paths, resulting in ENOENT. Confidence: 0.70
- Use the system's default font instead of extracting Roboto from pdfmake's VFS. Confidence: 0.70

# Communication
- When asked about a feature or component, provide context first (what it is, its purpose, where it fits in the app) before diving into technical details or bug fixes. Confidence: 0.80

# React
- Use React Flow for wizard/step-flow visualizations showing the emission process steps (crear boleta, enviar a SUNAT, generar PDF, etc.) for the current boleta being processed — NOT a grid of all boletas. Confidence: 0.75
- Show the JSON/SOAP payload being sent to SUNAT in the workflow step so the user can inspect it. Confidence: 0.70
- When an error occurs during the emission workflow, keep the user on the workflow view showing the React Flow with the failed step highlighted — do NOT skip to the resultados phase on error. Confidence: 0.85

# Companies Database
- RUC column in companies table must NOT have a UNIQUE constraint — the user manages multiple companies sharing the same RUC, distinguished by an internal company ID. When copying/cloning companies, allow duplicate RUCs. Confidence: 0.85
- When adding a new database field, wire it through ALL layers: DB schema → migration → core service (create+update) → IPC handler/bridge → renderer form submit → display components. The renderer-side IPC bridge may whitelist fields, so a field added to the form but not the IPC bridge will be silently dropped on save. Confidence: 0.65

# Pagination
- Default pagination to 20 items per page. Confidence: 0.65

# Monorepo
- Decouple backend and frontend into separate packages within a monorepo. Use common ports like 3010/3011. Confidence: 0.80
- Use a root-level command to run both backend and frontend simultaneously without custom shell scripts. Confidence: 0.70

# Tailwind
- Migrate to Tailwind CSS v4. Confidence: 0.70

# Naming
- The project is named "ZentoFact" — never "boletas sunat" or "zentofacto". Confidence: 0.80

# App Platform
- The app is web-only; do not reference desktop or Electron concepts. All UI is browser-based. Confidence: 0.80

# Database
- Use PostgreSQL as the database, not SQLite or local file-based storage. Confidence: 0.75

# Communication
- Respond in Spanish (the user is a Spanish speaker). Confidence: 0.75

# Credit Notes
- When generating credit notes by monto, randomize the boleta selection list rather than using sequential correlatives. Confidence: 0.70
- Default the beta/production switch to beta in the credit notes section. Confidence: 0.70
- When annulling boletas via credit notes, show a modal with progress tracking for each boleta being annulled. Update/refresh the list after completion. In beta mode, still persist the changes locally. Confidence: 0.70

# Beta Mode
- Beta mode must never consume or increment correlativos. Beta is for testing only — correlativos should only advance in production mode. When emitting in beta, skip correlativo assignment entirely. Confidence: 0.75
- Default all emisiones (boletas, facturas, credit notes, etc.) to beta mode — the production switch should be opt-in, not default. Confidence: 0.75

# SUNAT Operations
- Never register or persist a failed SUNAT operation (boleta, credit note, summary). If SUNAT returns an error, do not save anything to the database — only persist on successful acceptance. Confidence: 0.70

# File Storage
- Store XML firmados and CDRs (constancias de recepción) in Cloudflare R2, not local filesystem. PDFs stay local. Daily summaries (resúmenes diarios) also go to R2. Confidence: 0.70
- Do not persist any generated documents (XML, PDF, CDR) to local filesystem. All documents go to database or R2. PDFs should be regenerated on-demand when the user wants to upload them, not stored locally. Confidence: 0.65

# Webhooks
- When creating webhooks, auto-generate the secret instead of asking the user to provide one. The system should generate a secure random secret and display it to the user after creation. Confidence: 0.60

# File Management
- Never upload .DS_Store, thumbs.db, or other OS-generated files to R2 or any storage. Only upload the intended document files (XML, CDR, PDF). Confidence: 0.65

# Loading States
- Use skeleton loading components (with animated placeholders) instead of raw "loading" text or empty states when fetching data. Confidence: 0.70

# Performance
- Cache the selected company in localStorage to avoid repeated API calls on load. Fetch from API only if localStorage is empty. Confidence: 0.70

# UI Components
- Use shadcn's month picker component for date/month selection in filters and reports. Confidence: 0.70
- Prefer clean form-like layouts without card-based UI containers — avoid nesting cards or using bordered card sections for form inputs; use shadcn/ui form components directly for a cleaner, more open feel. Confidence: 0.75
