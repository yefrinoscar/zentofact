function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return String(value ?? '').trim();
}

export const ORDER_PACKAGE_MAPPING_PROBLEM_SQL = `(o.fulfillment_status='ready_to_ship'
  and case when o.metadata->>'labelCount' ~ '^[0-9]+$'
    then greatest((o.metadata->>'labelCount')::int, 1)
    else 1 end > 1
  and (
    select count(distinct nullif(coalesce(
      package_item.metadata->>'packageId',
      package_item.metadata->>'packageID',
      package_item.raw_data->>'PackageId',
      package_item.raw_data->>'PackageID',
      package_item.raw_data->>'packageId',
      package_item.raw_data->>'packageID'
    ), ''))
    from order_items package_item
    where package_item.order_id=o.id
  ) <> case when o.metadata->>'labelCount' ~ '^[0-9]+$'
    then greatest((o.metadata->>'labelCount')::int, 1)
    else 1 end)`;

export const ORDER_PROBLEM_SQL = `(o.items_status='error'
  or o.fulfillment_status='unmapped'
  or lower(coalesce(o.metadata->>'hasIncident', 'false'))='true'
  or ${ORDER_PACKAGE_MAPPING_PROBLEM_SQL})`;

export function orderProblemMessage(row) {
  if (String(row?.items_status || '') === 'error') {
    return text(row.items_error) || 'No se pudieron obtener los productos indispensables del pedido.';
  }
  if (String(row?.fulfillment_status || '') === 'unmapped') {
    return `El estado ${text(row.provider_status) || 'del marketplace'} todavía no tiene equivalencia operativa.`;
  }
  if (String(object(row?.metadata).hasIncident || '').toLowerCase() === 'true') {
    return 'El marketplace informó una incidencia que requiere revisión.';
  }
  if (row?.package_mapping_problem === true) {
    return 'No se pudieron asociar con seguridad los productos a cada etiqueta del pedido.';
  }
  return null;
}
