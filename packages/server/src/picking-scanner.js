function text(value) {
  return String(value ?? '').trim();
}

function objectValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

export function normalizeScannedCode(value) {
  const raw = text(value).slice(0, 500);
  if (!raw) return '';
  let decoded = raw;
  try {
    const url = new URL(raw);
    decoded = ['tracking', 'trackingCode', 'code', 'order', 'orderNumber', 'ticket']
      .map((key) => url.searchParams.get(key))
      .find(Boolean)
      || url.pathname.split('/').filter(Boolean).at(-1)
      || raw;
  } catch {}
  const numericCodes = text(decoded).match(/\d{8,30}/g) || [];
  return (numericCodes.sort((left, right) => right.length - left.length)[0] || text(decoded)).toUpperCase();
}

function normalizedItems(inventory) {
  const normalizedById = new Map((inventory?.items || []).map((item) => [text(item?.orderItemId), item]));
  return (inventory?.orderItems || []).map((raw, index) => {
    const normalized = normalizedById.get(text(raw?.OrderItemId)) || inventory?.items?.[index] || {};
    const imageUrls = Array.isArray(normalized?.imageUrls)
      ? normalized.imageUrls.map(text).filter(Boolean)
      : [text(normalized?.imageUrl)].filter(Boolean);
    return {
      orderItemId: text(raw?.OrderItemId || normalized?.orderItemId),
      name: text(normalized?.name || raw?.Name || raw?.Description),
      sellerSku: text(normalized?.sellerSku || raw?.Sku || raw?.SellerSku),
      shopSku: text(normalized?.shopSku || raw?.ShopSku),
      quantity: Math.max(1, Number(normalized?.quantity ?? raw?.Quantity ?? 1) || 1),
      status: text(normalized?.status || raw?.Status),
      trackingCode: text(raw?.TrackingCode || raw?.TrackingNumber),
      packageId: text(raw?.PackageId || normalized?.packageId),
      variation: objectValue(raw?.Variation),
      imageUrl: text(normalized?.imageUrl || imageUrls[0]),
      imageUrls,
      raw,
    };
  });
}

export async function saveFalabellaTicketSnapshot(db, order, inventory) {
  const items = normalizedItems(inventory);
  await Promise.all(items.filter((item) => item.orderItemId).map((item) => db.query(
    `insert into falabella_ticket_items (
       company_id, order_id, order_number, order_item_id,
       tracking_code, package_id, item_data, captured_at
     ) values ($1,$2,$3,$4,$5,$6,$7,now())
     on conflict (company_id, order_id, order_item_id) do update set
       order_number=excluded.order_number,
       tracking_code=excluded.tracking_code,
       package_id=excluded.package_id,
       item_data=excluded.item_data,
       captured_at=now()`,
    [
      Number(order.companyId),
      text(order.orderId),
      text(order.orderNumber),
      item.orderItemId,
      item.trackingCode,
      item.packageId,
      JSON.stringify({
        raw: item.raw,
        item: {
          ...item,
          raw: undefined,
        },
      }),
    ],
  )));
  return items;
}

async function orderRow(db, companyId, orderId) {
  const result = await db.query(
    `select fo.company_id, fo.order_id, fo.order_number, fo.status,
       fo.falabella_created_at, fo.falabella_updated_at, fo.raw_data,
       coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social, 'Tienda') company_name
     from falabella_orders fo
     join companies c on c.id=fo.company_id
     where fo.company_id=$1 and fo.order_id=$2
     limit 1`,
    [Number(companyId), text(orderId)],
  );
  return result.rows[0] || null;
}

async function directOrderRows(db, code) {
  const result = await db.query(
    `select fo.company_id, fo.order_id, fo.order_number, fo.status,
       fo.falabella_created_at, fo.falabella_updated_at, fo.raw_data,
       coalesce(nullif(c.nombre, ''), nullif(c.nombre_comercial, ''), c.razon_social, 'Tienda') company_name
     from falabella_orders fo
     join companies c on c.id=fo.company_id
     where fo.order_number=$1 or fo.order_id=$1
     order by fo.last_seen_at desc nulls last
     limit 5`,
    [code],
  );
  return result.rows;
}

async function snapshotMatch(db, code) {
  const result = await db.query(
    `select company_id, order_id,
       case
         when tracking_code=$1 then 'tracking'
         when package_id=$1 then 'package'
         else 'order'
       end match_type
     from falabella_ticket_items
     where tracking_code=$1 or package_id=$1 or order_number=$1 or order_id=$1
     order by captured_at desc
     limit 1`,
    [code],
  );
  return result.rows[0] || null;
}

async function snapshotInventory(db, companyId, orderId) {
  const result = await db.query(
    `select item_data from falabella_ticket_items
     where company_id=$1 and order_id=$2
     order by id`,
    [Number(companyId), text(orderId)],
  );
  const entries = result.rows.map((row) => objectValue(row.item_data));
  return {
    ok: true,
    orderItems: entries.map((entry) => entry.raw).filter(Boolean),
    items: entries.map((entry) => entry.item).filter(Boolean),
  };
}

function itemMatchesCode(item, code) {
  return item.trackingCode === code || item.packageId === code;
}

async function findLegacyPrintedTicket({ db, getOrderItems, code }) {
  if (!/^\d{15,30}$/.test(code)) return null;
  const result = await db.query(
    `select company_id, order_id, order_number, last_printed_at
     from (
       select distinct on (prints.company_id, prints.order_id)
         prints.company_id, prints.order_id, prints.order_number, prints.last_printed_at
       from falabella_label_prints prints
       order by prints.company_id, prints.order_id, prints.last_printed_at desc
     ) recent
     order by last_printed_at desc
     limit 120`,
  );
  const candidates = result.rows;
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const batch = candidates.slice(offset, offset + 4);
    const loaded = await Promise.all(batch.map(async (candidate) => {
      try {
        const inventory = await getOrderItems({
          companyId: Number(candidate.company_id),
          orderId: candidate.order_id,
        });
        if (inventory?.error || inventory?.ok === false) return null;
        await saveFalabellaTicketSnapshot(db, {
          companyId: candidate.company_id,
          orderId: candidate.order_id,
          orderNumber: candidate.order_number,
        }, inventory);
        return { candidate, inventory, items: normalizedItems(inventory) };
      } catch {
        return null;
      }
    }));
    const match = loaded.find((entry) => entry?.items?.some((item) => itemMatchesCode(item, code)));
    if (match) return match;
  }
  return null;
}

function shippingAddress(raw) {
  const address = objectValue(raw?.AddressShipping || raw?.ShippingAddress || raw?.Address);
  return {
    addressLine: [address.Address1, address.Address2, address.Address3].map(text).filter(Boolean).join(', '),
    district: text(address.Ward || address.District),
    city: text(address.City),
    region: text(address.Region || address.Province),
  };
}

function proxiedImageUrl(value) {
  const imageUrl = text(value);
  return imageUrl ? `/falabella/picking/image?url=${encodeURIComponent(imageUrl)}` : '';
}

function publicItem(item) {
  const candidates = [...new Set([item.imageUrl, ...(item.imageUrls || [])].map(text).filter(Boolean))];
  const imageUrls = candidates.map(proxiedImageUrl);
  return {
    ...item,
    raw: undefined,
    imageUrl: imageUrls[0] || '',
    imageUrls,
  };
}

function buildPickingResult({ code, matchType, stored, inventory }) {
  const raw = objectValue(stored.raw_data);
  const warehouse = objectValue(raw.Warehouse);
  const allItems = normalizedItems(inventory);
  const matchedItems = allItems.filter((item) => itemMatchesCode(item, code));
  const items = matchedItems.length ? matchedItems : allItems;
  const packageGroups = new Map();
  for (const item of items) {
    const key = `${item.packageId}|${item.trackingCode}`;
    if (!packageGroups.has(key)) {
      packageGroups.set(key, {
        packageId: item.packageId,
        trackingCode: item.trackingCode,
        items: [],
      });
    }
    packageGroups.get(key).items.push(publicItem(item));
  }
  const customerName = [raw.CustomerFirstName, raw.CustomerLastName, raw.CustomerLastName2]
    .map(text).filter(Boolean).join(' ')
    || text(objectValue(raw.AddressShipping).FirstName);
  return {
    found: true,
    scan: { code, matchType },
    order: {
      companyId: Number(stored.company_id),
      companyName: text(stored.company_name),
      orderId: text(stored.order_id),
      orderNumber: text(stored.order_number),
      status: text(stored.status),
      customerName,
      shippingType: text(raw.ShippingType),
      sellerFacilityId: text(warehouse.FacilityId || warehouse.SellerWarehouseId),
      createdAt: stored.falabella_created_at || null,
      updatedAt: stored.falabella_updated_at || null,
      promisedShippingTime: raw.PromisedShippingTime || null,
      address: shippingAddress(raw),
    },
    packages: [...packageGroups.values()],
    itemCount: items.length,
    unitCount: items.reduce((total, item) => total + item.quantity, 0),
  };
}

export async function lookupPickingScan({ db, getOrderItems, input }) {
  const code = normalizeScannedCode(input);
  if (!code) {
    const error = new Error('Escanea un QR o ingresa un código válido.');
    error.status = 400;
    throw error;
  }

  let stored = null;
  let inventory = null;
  let matchType = 'order';
  const direct = await directOrderRows(db, code);
  if (direct.length) stored = direct[0];

  if (!stored) {
    const snapshot = await snapshotMatch(db, code);
    if (snapshot) {
      stored = await orderRow(db, snapshot.company_id, snapshot.order_id);
      matchType = snapshot.match_type;
    }
  }

  if (!stored) {
    const legacy = await findLegacyPrintedTicket({ db, getOrderItems, code });
    if (legacy) {
      stored = await orderRow(db, legacy.candidate.company_id, legacy.candidate.order_id);
      inventory = legacy.inventory;
      matchType = 'tracking';
    }
  }

  if (!stored) {
    const error = new Error(`No encontramos una etiqueta u orden asociada a ${code}.`);
    error.status = 404;
    throw error;
  }

  if (!inventory) {
    try {
      inventory = await getOrderItems({
        companyId: Number(stored.company_id),
        orderId: stored.order_id,
      });
      if (inventory?.error || inventory?.ok === false) throw new Error(inventory?.error || 'Falabella no devolvió los productos.');
      await saveFalabellaTicketSnapshot(db, {
        companyId: stored.company_id,
        orderId: stored.order_id,
        orderNumber: stored.order_number,
      }, inventory);
    } catch {
      inventory = await snapshotInventory(db, stored.company_id, stored.order_id);
      if (!inventory.orderItems.length) throw new Error('No pudimos consultar los productos de esta orden.');
    }
  }

  if (matchType === 'order') {
    const match = normalizedItems(inventory).find((item) => itemMatchesCode(item, code));
    if (match) matchType = match.trackingCode === code ? 'tracking' : 'package';
  }
  return buildPickingResult({ code, matchType, stored, inventory });
}
