# Scraper
- Split "abrir falabella" into two separate tracked steps: browser launch + login/authentication, each with their own timing in the React Flow visualization. Confidence: 0.75
- Always use the currently selected/active company's credentials when running the scraper. Confidence: 0.70
- When `page.waitForResponse` times out, log the URL/resource being waited for and the current page URL. Confidence: 0.70
- Run scraper in headless mode. Confidence: 0.75
- Extract grand total from Falabella order detail API (`seller-platforms.falabella.services/manage-orders/v1/order/number/{orderNumber}`) for each pending order. Confidence: 0.70
- Include `orderNumber` (from `deliveryOrderNumber`, starts with 3) in `VentaItem` JSON output — the workflow uses it for PDF filenames in `{orderNumber}_{serie}-{documentoCliente}.pdf` format. Confidence: 0.70
- Pass `orderNumber` through to the SUNAT conversion step — it should be available when converting to SUNAT format, not just for PDF naming. Confidence: 0.75
- Prefer `page.waitForURL` or `page.waitForNavigation` over `page.waitForTimeout` for login/authentication flows — fixed delays cause unnecessary slowness (30s+); wait for actual URL changes instead. Keep all individual timeout values at 2-3 seconds maximum. Confidence: 0.85
