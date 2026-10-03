import { getOrder } from "./order-management.js";

const TABLES = {
  factura: "facturas",
  boleta: "boletas",
  credit_note: "credit_notes",
};
export function sunatReason(raw) {
  if (!raw) return "";
  let message = raw;
  try {
    const value = JSON.parse(raw);
    message =
      value.message ||
      value.reason ||
      value.description ||
      value.statusMessage ||
      value.error?.message ||
      raw;
  } catch {
    /* SUNAT also returns plain text. */
  }
  return String(message)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\[Paso[^\]]*\]\s*/g, "")
    .trim();
}

export async function listOrderDocuments(order, db) {
  const documents = [];
  for (const [kind, table] of Object.entries(TABLES)) {
    const column = kind === "credit_note" ? "credit_note_id" : `${kind}_id`;
    const result = await db.query(
      `select d.*, c.tipo_documento as client_type,
      c.numero_documento as client_number, c.razon_social as client_name, c.direccion as client_address
      from ${table} d left join clients c on c.id=d.client_id
      where (d.company_id=$1 and ${kind === "credit_note" ? "$2::text is null" : "d.order_number=$2"})
        or exists (select 1 from order_documents od where od.order_id=$3 and od.${column}=d.id)
      order by d.id desc`,
      [order.companyId, order.externalOrderNumber, order.id],
    );
    documents.push(
      ...result.rows.map((d) => ({
        id: Number(d.id),
        kind,
        number: d.numero_completo,
        status: d.estado_sunat,
        reason: sunatReason(d.respuesta_sunat),
        response: d.respuesta_sunat,
        issuedAt: d.fecha_emision,
        total: Number(d.mto_imp_venta),
        hasXml: Boolean(d.xml_path),
        canDownloadPdf: d.estado_sunat === "ACEPTADO",
        branchId: d.branch_id,
        serie: d.serie,
        client: {
          documentType: d.client_type,
          documentNumber: d.client_number,
          name: d.client_name,
          address: d.client_address || "",
        },
      })),
    );
  }
  return documents.sort(
    (a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id - a.id,
  );
}

function billingAttributes(value) {
  if (typeof value === "string") {
    try {
      return billingAttributes(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (Array.isArray(value))
    return Object.fromEntries(
      value
        .filter((v) => v && typeof v === "object")
        .map((v) => [
          v.Name ?? v.name ?? v.Key ?? v.key ?? v.Code ?? v.code,
          v.Value ?? v.value ?? v.Text ?? v.text,
        ]),
    );
  if (!value || typeof value !== "object") return {};
  const nested =
    value.ExtraBillingAttribute ||
    value.ExtraBillingAttributes ||
    value.Attribute ||
    value.Attributes;
  return nested ? billingAttributes(nested) : value;
}

export function orderBillingDefaults(order) {
  const payload = order.snapshots?.[0]?.rawPayload || {};
  const raw = payload.Order || payload;
  const attrs = billingAttributes(raw.ExtraBillingAttributes);
  const legalId = String(
    attrs.LegalId ||
      attrs.ReceiverLegalId ||
      attrs.TaxId ||
      attrs.RUC ||
      attrs.DocumentNumber ||
      "",
  ).replace(/\D/g, "");
  const customer = order.customer || {};
  const number = String(
    legalId || customer.documentNumber || raw.NationalRegistrationNumber || "",
  ).trim();
  const invoiceRequired =
    [true, 1, "1", "true"].includes(raw.InvoiceRequired) ||
    [true, 1, "1", "true"].includes(order.metadata?.invoiceRequired);
  const kind =
    order.documentTypePolicy === "factura" ||
    order.requestedDocumentType === "factura" ||
    (order.documentTypePolicy !== "boleta" &&
      (invoiceRequired || number.length === 11))
      ? "factura"
      : "boleta";
  return {
    kind,
    serie: kind === "factura" ? "F001" : "B001",
    client: {
      documentType:
        kind === "factura"
          ? "6"
          : String(
              customer.documentType ||
                (number.length === 8
                  ? "1"
                  : number.length === 9
                    ? "4"
                    : number
                      ? "7"
                      : "0"),
            ),
      documentNumber: number,
      name: String(
        attrs.ReceiverLegalName ||
          attrs.LegalName ||
          attrs.BusinessName ||
          attrs.CompanyName ||
          attrs.RazonSocial ||
          customer.legalName ||
          customer.name ||
          [raw.CustomerFirstName, raw.CustomerLastName]
            .filter(Boolean)
            .join(" ") ||
          "CLIENTE",
      ),
      address: String(
        attrs.ReceiverAddress ||
          attrs.Address ||
          attrs.Direccion ||
          customer.address ||
          order.shipping?.address ||
          "",
      ),
    },
  };
}

export async function prepareOrderEmission(order, core) {
  const branches = await core.listBranches(order.companyId);
  const branch = branches.find((b) => b.codigo === "0000") || branches[0];
  if (!branch)
    throw new Error("La empresa no tiene una sucursal emisora configurada.");
  return { ...orderBillingDefaults(order), branchId: branch.id };
}

export function buildOrderDocumentInput(order, input) {
  const kind = input.kind;
  if (!["factura", "boleta"].includes(kind))
    throw new Error("Selecciona factura o boleta.");
  if (!order.companyId) throw new Error("El pedido no tiene empresa emisora.");
  if (order.documentRequirement === "disabled")
    throw new Error("La emisión está deshabilitada para esta cuenta.");
  if (
    ["cancelled", "returned"].includes(order.fulfillmentStatus) ||
    order.orderStatus === "cancelled"
  )
    throw new Error("No se puede emitir un pedido cancelado o devuelto.");
  if (order.itemsStatus !== "complete" || !order.items.length)
    throw new Error("Primero sincroniza los productos del pedido.");
  const client = input.client || {};
  const number = String(client.documentNumber || "").trim();
  const type = kind === "factura" ? "6" : String(client.documentType || "1");
  if (kind === "factura" && !/^\d{11}$/.test(number))
    throw new Error("La factura requiere un RUC de 11 dígitos.");
  if (kind === "boleta" && !["0", "1", "4", "7"].includes(type))
    throw new Error("Selecciona un documento válido para la boleta.");
  if (type === "1" && !/^\d{8}$/.test(number))
    throw new Error("El DNI debe tener 8 dígitos.");
  if (["4", "7"].includes(type) && !number)
    throw new Error("Ingresa el documento del cliente.");
  if (type === "0" && Number(order.total) > 700)
    throw new Error(
      "Las boletas mayores a S/ 700 requieren identificar al cliente.",
    );
  const name = String(client.name || "").trim();
  if (!name) throw new Error("Ingresa el nombre o razón social del cliente.");
  const details = order.items.map((item) => {
    const quantity = Number(item.quantity);
    const gross =
      item.total == null
        ? Number(item.unitPrice) * quantity - Number(item.discountAmount || 0)
        : Number(item.total);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(gross) ||
      gross <= 0
    )
      throw new Error("El pedido tiene cantidades o importes incompletos.");
    return {
      codigo: item.sku || String(item.id),
      descripcion: item.description,
      unidad: "NIU",
      cantidad: quantity,
      mto_valor_unitario: gross / quantity / 1.18,
      mto_bruto: gross,
      porcentaje_igv: 18,
      tip_afe_igv: "10",
    };
  });
  const shipping = Number(order.shippingAmount || 0);
  if (shipping > 0)
    details.push({
      codigo: "ENVIO",
      descripcion: "Envío",
      unidad: "NIU",
      cantidad: 1,
      mto_valor_unitario: shipping / 1.18,
      mto_bruto: shipping,
      porcentaje_igv: 18,
      tip_afe_igv: "10",
    });
  const sum = details.reduce((n, line) => n + line.mto_bruto, 0);
  if (
    !Number.isFinite(Number(order.total)) ||
    Number(order.total) <= 0 ||
    Math.abs(sum - Number(order.total)) > 0.005
  ) {
    throw new Error(
      `Los productos y el envío suman S/ ${sum.toFixed(2)}, pero el pedido indica S/ ${Number(order.total).toFixed(2)}. Sincroniza o corrige el pedido antes de emitir.`,
    );
  }
  const branchId = Number(input.branchId);
  if (!Number.isInteger(branchId) || branchId <= 0)
    throw new Error("Selecciona la sucursal emisora.");
  const serie = String(input.serie || "")
    .trim()
    .toUpperCase();
  if (!(kind === "factura" ? /^F[A-Z0-9]{3}$/ : /^B[A-Z0-9]{3}$/).test(serie))
    throw new Error("La serie no corresponde al tipo de comprobante.");
  return {
    company_id: order.companyId,
    branch_id: branchId,
    order_number: order.externalOrderNumber,
    serie,
    fecha_emision: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
    }).format(new Date()),
    moneda: order.currency || "PEN",
    metodo_envio: "individual",
    client: {
      tipo_documento: type,
      numero_documento: type === "0" ? "00000000" : number,
      razon_social: name,
      direccion: String(client.address || "").trim(),
    },
    detalles: details,
    expected_total: { total: Number(order.total), source: "total del pedido" },
    datos_adicionales: [
      {
        source: "order-management",
        orderId: order.id,
        channel: order.channelCode,
      },
    ],
  };
}

export async function syncOrderDocuments(order, db) {
  for (const [kind, table] of Object.entries(TABLES).filter(
    ([kind]) => kind !== "credit_note",
  )) {
    await db.query(
      `insert into order_documents (order_id, document_kind, ${kind}_id)
      select $1, $2, id from ${table} where company_id=$3 and order_number=$4
      on conflict do nothing`,
      [order.id, kind, order.companyId, order.externalOrderNumber],
    );
  }
  const docs = await listOrderDocuments(order, db);
  const active = docs.filter(
    (d) =>
      d.kind !== "credit_note" &&
      !["REEMPLAZADO", "ANULADO"].includes(d.status),
  );
  const status = active.some((d) => d.status === "ACEPTADO")
    ? "accepted"
    : active.some((d) => d.status === "RECHAZADO")
      ? "rejected"
      : active.length
        ? "issued"
        : order.documentStatus;
  await db.query(
    "update orders set document_status=$2, updated_at=now() where id=$1",
    [order.id, status],
  );
}

export async function actOnOrderDocument(
  orderId,
  action,
  input,
  actorUserId,
  core,
) {
  const order = await getOrder(orderId, core.pool);
  if (!order) throw new Error("Pedido no encontrado.");
  const docs = await listOrderDocuments(order, core.pool);
  if (["refresh", "reissue"].includes(action))
    await syncOrderDocuments(order, core.pool);
  if (action === "emit") {
    if (
      docs.some(
        (d) =>
          d.kind !== "credit_note" &&
          !["REEMPLAZADO", "ANULADO"].includes(d.status),
      )
    )
      throw new Error(
        "El pedido ya tiene un comprobante. Consulta SUNAT o reemítelo.",
      );
    const built = buildOrderDocumentInput(order, input);
    const branches = await core.listBranches(order.companyId);
    if (!branches.some((b) => b.id === built.branch_id && b.activo))
      throw new Error("Sucursal no válida para esta empresa.");
    const client = await core.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `managed-order-emission:${order.companyId}:${order.externalOrderNumber}`,
      ]);
      const fresh = await listOrderDocuments(order, client);
      if (
        fresh.some(
          (d) =>
            d.kind !== "credit_note" &&
            !["REEMPLAZADO", "ANULADO"].includes(d.status),
        )
      )
        throw new Error("El pedido ya tiene un comprobante.");
      const created =
        input.kind === "factura"
          ? await core.createFactura({
              ...built,
              usuario_creacion: actorUserId,
            })
          : await core.createBoleta({
              ...built,
              usuario_creacion: actorUserId,
            });
      await syncOrderDocuments(order, client);
      await client.query("commit");
      const result =
        input.kind === "factura"
          ? await core.sendFacturaToSunat(created.id)
          : await core.sendBoletaToSunat(created.id);
      return {
        ...result,
        documentId: created.id,
        numeroCompleto: created.numeroCompleto,
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
      await syncOrderDocuments(order, core.pool);
    }
  }
  const doc = docs.find(
    (d) => d.id === Number(input.documentId) && d.kind === input.kind,
  );
  if (!doc || doc.kind === "credit_note")
    throw new Error("Comprobante no encontrado en este pedido.");
  try {
    if (action === "refresh")
      return doc.kind === "factura"
        ? await core.refreshFacturaStatus(doc.id)
        : await core.refreshBoletaStatus(doc.id);
    if (action === "reissue") {
      return doc.kind === "factura"
        ? await core.reEmitFactura(doc.id)
        : await core.reEmitBoleta(doc.id);
    }
    if (action === "pdf")
      return {
        base64:
          doc.kind === "factura"
            ? await core.generateAcceptedFacturaPdfBase64(doc.id)
            : await core.generateAcceptedBoletaPdfBase64(doc.id),
      };
    if (action === "xml")
      return {
        base64:
          doc.kind === "factura"
            ? await core.getFacturaXmlBase64(doc.id)
            : await core.getBoletaXmlBase64(doc.id),
      };
    throw new Error("Acción no válida.");
  } finally {
    if (["refresh", "reissue"].includes(action))
      await syncOrderDocuments(order, core.pool);
  }
}
