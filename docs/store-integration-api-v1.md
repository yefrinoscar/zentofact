# Zentofact Store Integration API v1 — contract (shared by Zentofact and Limbo)

Both sides MUST implement exactly this. Copy this file into each repo as `docs/store-integration-api-v1.md`.

## Conventions
- Base: `{ZENTOFACT_API_URL}/api/v1`. JSON, UTF-8. Money = number in PEN with 2 decimals, IGV included. Dates = ISO-8601 UTC.
- Errors: RFC 9457 `application/problem+json`: `{ "type": "https://zentofact.app/problems/<code>", "title": "...", "status": 409, "detail": "...", "code": "<code>", "retryable": false }`.
  Codes: `unauthorized`(401), `forbidden_scope`(403), `not_found`(404), `validation_failed`(400, plus `errors: [{path, message}]`), `stale_update`(409, retryable:false — ignore, newer data exists), `document_already_issued`(409), `order_already_shipped`(409), `idempotency_key_reused`(422), `idempotency_in_progress`(409, retryable:true), `internal`(500, retryable:true).
- Auth: `Authorization: Bearer zf_<env>_<keyId>_<secret>`; `<env>` is `live` in production, `test` elsewhere; a key whose env doesn't match the server env → 401. Keys are bound to one order channel account (the store). Scopes: `orders:write`, `orders:read`, `documents:read`, `inventory:read`, `policy:read`.
- Body limit 256 KB.

## Endpoints

### GET /policy  (policy:read)
```json
{ "version": "2026-11-28T15:00:00Z#3",
  "issuance": { "mode": "on_request" },              // "on_request" | "always"
  "documentTypes": ["boleta", "factura"],
  "boletaIdRequired": false, "anonymousMaxAmount": 700,
  "creditNoteOnCancel": "auto",                       // "auto" | "manual"
  "series": { "boleta": "B001", "factura": "F001" } }
```

### PUT /orders/{externalId}  (orders:write)
`externalId` = store's immutable order id (Medusa `order_...`). Create or update. Versioned by `updatedAt`: if `updatedAt` is older than the stored one → 409 `stale_update`. Response 201 (created) / 200 (updated) with the Order resource (see GET).
Store owns: orderNumber, customer, document request, items, amounts, payment, fulfillment type/address. Zentofact owns fulfillment progress and documents; PUT never changes them. After a document is issued/accepted, changes to items/amounts/document → 409 `document_already_issued` (contact/address changes still allowed).
```jsonc
{
  "orderNumber": "L-DHZ2A7",            // human number, persisted once by the store, never recomputed
  "orderedAt": "2026-11-28T15:00:00Z",
  "updatedAt": "2026-11-28T15:00:05Z",
  "currency": "PEN",
  "payment": { "status": "paid", "paidAt": "2026-11-28T15:00:00Z", "method": "card", "provider": "mercado_pago", "reference": "123456789" },
  "customer": { "name": "Ana Pérez", "email": "ana@example.com", "phone": "999999999" },
  "document": null,                      // or { "type": "boleta"|"factura", "customer": { "docType": "DNI"|"CE"|"PASSPORT"|"RUC", "docNumber": "...", "name": "...", "address": "..." } }
  "fulfillment": {
    "type": "delivery",                  // "delivery" | "pickup"
    "zone": "lima",                      // "lima" | "provincia" | null (pickup)
    "address": { "recipient": "Ana Pérez", "line1": "...", "line2": "...", "district": "...", "department": "cusco", "reference": "...", "phone": "..." }
  },
  "items": [ { "id": "ordli_...", "sku": "ABC-1", "description": "Producto X - Rojo", "quantity": 2, "unitPrice": 59.90, "discount": 10.00, "total": 109.80 } ],
  "shipping": { "description": "Envío Provincia", "total": 15.00 },   // total 0 allowed (free/pickup)
  "discountTotal": 10.00,                // informational
  "total": 124.80                        // MUST equal Σ items[].total + shipping.total (±0.005)
}
```
Rules: items with total ≤ 0 → 400. Unknown SKU → accepted, line flagged unmatched (never 4xx). Stock is committed in Zentofact on ingest (negative allowed for the store account).

### POST /orders/{externalId}/cancel  (orders:write)  — header `Idempotency-Key` required
Body `{ "reason": "customer_request" | "payment_issue" | "out_of_stock" | "other", "note": "..." }`.
- 200 → order cancelled in Zentofact, stock released; if a document was accepted and policy creditNoteOnCancel=auto → credit note emitted (async; `document.voided` event follows).
- 409 `order_already_shipped` if fulfillment is shipped/delivered (store must NOT cancel/refund).
- Same key + same body → replay of the stored response; same key + different body → 422.

### GET /orders/{externalId}  (orders:read)
```jsonc
{ "externalId": "order_...", "orderNumber": "L-DHZ2A7", "zentofactId": 123,
  "fulfillment": { "status": "pending"|"confirmed"|"ready"|"shipped"|"delivered"|"cancelled",
                   "confirmedAt": null, "readyAt": null, "shippedAt": null, "deliveredAt": null,
                   "carrier": "shalom"|null, "trackingNumber": null, "trackingUrl": null },
  "documents": [ { "id": "boleta:456", "kind": "boleta"|"factura"|"credit_note", "number": "B001-123",
                   "status": "issued"|"accepted"|"rejected"|"voided", "issuedAt": "...", "total": 124.80,
                   "affects": null /* for credit_note: "boleta:456" */ } ],
  "updatedAt": "..." }
```

### GET /documents/{id}/pdf  (documents:read)
`id` as in `documents[].id` (`boleta:456`, `factura:7`, `credit_note:9`). Returns `application/pdf`. Only for documents belonging to the key's account.

### GET /inventory?sku=A,B&cursor=&limit=200  (inventory:read)
`{ "items": [ { "sku": "ABC-1", "available": 12, "updatedAt": "..." } ], "nextCursor": null }`. Without `sku` → all products with a main SKU, paginated. `available` = on_hand − reserved − pending_return (can be negative; store should clamp to 0).

## Webhooks (Zentofact → store), Standard Webhooks v1.0
- POST to the endpoint registered for the account. Headers: `webhook-id` (unique event id), `webhook-timestamp` (unix seconds), `webhook-signature: v1,<base64(HMAC-SHA256(secret, "{id}.{timestamp}.{rawBody}"))>` (space-separated list during rotation). Secret format `whsec_<base64>`; HMAC key = base64-decoded part.
- Receiver: verify against raw body, reject |now − timestamp| > 300 s, dedupe by `webhook-id`, respond 2xx fast (process async). Non-2xx → retries at 5s, 5m, 30m, 2h, 5h, 10h, 14h, 20h, 24h; 410 disables the endpoint.
- Body (thin): `{ "type": "order.shipped", "timestamp": "2026-11-28T15:00:00Z", "data": { "externalId": "order_...", "orderNumber": "L-DHZ2A7", "sequence": 42, ... } }`. Receiver should GET the resource for current state; events may arrive out of order (use GET + monotonic transitions).

| type | when | extra data |
|---|---|---|
| order.received | first successful PUT | — |
| order.confirmed | Bandeja "Confirmar" (fulfillment → confirmed) | — |
| order.ready | Bandeja "Listo" (ready to ship / ready for pickup) | — |
| order.shipped | Bandeja "Enviado" (delivery only) | carrier, trackingNumber, trackingUrl |
| order.delivered | Bandeja "Entregado"/"Recogido" | — |
| order.cancelled | cancel accepted | — |
| document.issued | boleta/factura created and sent (not yet accepted) | documentId, kind, number |
| document.accepted | SUNAT accepted | documentId, kind, number |
| document.rejected | SUNAT rejected (operator must act) | documentId, kind, number, reason |
| document.voided | credit note accepted for a document | documentId, creditNoteId, number |
| inventory.updated | available changed for a SKU | sku, available |

Store email rule: send the comprobante to the customer once per document: boleta on `document.issued` (or accepted if issued was missed), factura on `document.accepted`.

## Key/endpoint provisioning (Zentofact)
CLI `npm run integration:provision -- --account <channelAccountId> --webhook-url <url>` creates the key (printed once) and the endpoint secret (printed once). Store sets env `ZENTOFACT_API_URL`, `ZENTOFACT_API_KEY`, `ZENTOFACT_WEBHOOK_SECRET`.
