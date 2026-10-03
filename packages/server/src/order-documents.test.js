import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderDocumentInput,
  sunatReason,
  listOrderDocuments,
  orderBillingDefaults,
} from "./order-documents.js";
const order = {
  id: 1,
  companyId: 1,
  externalOrderNumber: "3251854382",
  documentRequirement: "required",
  itemsStatus: "complete",
  orderStatus: "completed",
  fulfillmentStatus: "delivered",
  total: 364.9,
  shippingAmount: 34.9,
  currency: "PEN",
  items: [{ id: 2, quantity: 15, total: 330, description: "Producto" }],
};
const input = {
  kind: "factura",
  branchId: 1,
  serie: "F001",
  client: { documentNumber: "20123456789", name: "Cliente", address: "Lima" },
};
test("SUNAT reason retains policy failure and decodes Spanish", () => {
  assert.equal(
    sunatReason(
      JSON.stringify({
        code: "0111",
        message:
          "[Paso 3/3 - Enviar a SUNAT] No tiene el perfil para enviar comprobantes electr&#243;nicos - Detalle: Rejected by policy.",
      }),
    ),
    "No tiene el perfil para enviar comprobantes electrónicos - Detalle: Rejected by policy.",
  );
});
test("emission preserves net paid amounts and shipping exactly", () => {
  const result = buildOrderDocumentInput(order, input);
  assert.equal(result.order_number, "3251854382");
  assert.deepEqual(
    result.detalles.map((d) => d.mto_bruto),
    [330, 34.9],
  );
  assert.equal(result.expected_total.total, 364.9);
});
test("incomplete items, amount mismatch, cancellation and missing RUC block before reserving a number", () => {
  for (const change of [
    { itemsStatus: "pending" },
    { total: 365 },
    { fulfillmentStatus: "cancelled" },
    { orderStatus: "cancelled" },
  ])
    assert.throws(() =>
      buildOrderDocumentInput({ ...order, ...change }, input),
    );
  assert.throws(() =>
    buildOrderDocumentInput(order, {
      ...input,
      client: { ...input.client, documentNumber: "123" },
    }),
  );
});
test("boleta without identity has a limit of 700 soles", () => {
  assert.throws(
    () =>
      buildOrderDocumentInput(
        { ...order, total: 701 },
        {
          ...input,
          kind: "boleta",
          serie: "B001",
          client: { documentType: "0", name: "Cliente" },
        },
      ),
    /700/,
  );
});
test("billing data and document type come from the order without operator input", () => {
  const defaults = orderBillingDefaults({
    ...order,
    customer: { name: "Comprador", documentNumber: "12345678" },
    snapshots: [
      {
        rawPayload: {
          InvoiceRequired: true,
          ExtraBillingAttributes: {
            ExtraBillingAttribute: [
              { Name: "LegalId", Value: "20123456789" },
              { Name: "ReceiverLegalName", Value: "CLIENTE SAC" },
              { Name: "ReceiverAddress", Value: "Lima" },
            ],
          },
        },
      },
    ],
  });
  assert.equal(defaults.kind, "factura");
  assert.equal(defaults.client.documentNumber, "20123456789");
  assert.equal(defaults.client.name, "CLIENTE SAC");
  assert.equal(defaults.client.address, "Lima");
  assert.equal(
    orderBillingDefaults({
      ...order,
      customer: { documentNumber: "12345678", name: "Cliente" },
    }).kind,
    "boleta",
  );
});
test("documents resolve live replacements and preserve linked history", async () => {
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return {
        rows: sql.includes("from facturas d")
          ? [
              {
                id: 9,
                numero_completo: "F001-000021",
                estado_sunat: "ACEPTADO",
                fecha_emision: "2026-10-03",
                mto_imp_venta: "364.9",
                client_name: "Cliente",
                xml_path: "archived.xml",
              },
            ]
          : [],
      };
    },
  };
  const docs = await listOrderDocuments(order, db);
  assert.equal(docs[0].number, "F001-000021");
  assert.equal(docs[0].canDownloadPdf, true);
  assert.ok(queries[0].sql.includes("order_documents"));
  assert.equal(queries.length, 3);
});
