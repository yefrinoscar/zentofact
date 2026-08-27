export const LEGACY_AG_TO_EXCEL = {
  AG94: 'G38L',
  AG65: 'G44',
  AG134: 'Z77',
  AG296: 'G43',
  AG104: 'Z5',
  AG142: 'Z9',
  AG297: 'Z34',
  AG76: 'Z20',
  AG144: 'AD060R',
  AG87: 'G36',
  AG174: 'Z7',
  AG180: 'H32',
  AG192: 'H25',
  AG89: 'G47',
  AG85: 'H30',
  AG81: 'H9MB',
  AG83: 'H9MN',
  AG82: 'H9LB',
  AG84: 'H9LN',
  AG167: 'H9XLB',
  AG166: 'H9XLN',
  AG165: 'H13L',
  AG110: 'H14',
  AG163: 'H16',
  AG298: 'G40L',
  AG193: 'Z25',
  AG129: 'G42N',
  AG139: 'G42B',
  AG128: 'H36',
  AG108: 'G1FLORES',
  AG274: 'G1HOJAS',
  AG107: 'G1RAMAS',
  AG159: 'H39',
  AG171: 'G18',
  AG157: 'H49',
  AG115: 'G9',
  AG168: 'G13',
  AG121: 'G24N',
  AG189: 'G26C',
  AG123: 'G-28N',
  AG169: 'G34C',
  AG125: 'G35N',
  AG301: 'G35V',
  AG170: 'G35R',
  AG126: 'G37',
  AG140: 'H24',
  AG112: 'HOG001',
  AG141: 'HOG013',
  AG120: 'G-25',
  AG127: 'G-48',
  AG172: 'G-20',
  AG124: 'G-32',
  AG113: 'HOG-12-002',
  AG109: 'HOG-12-003',
  AG155: 'HOG-12-004',
  AC34: 'HOG-12-005',
  AG223: 'HOG025',
  AG173: 'G-8',
  AG75: 'G-36',
  AG119: 'G-2',
  AG197: 'HOG028',
  AG198: 'HOG029',
  AG224: 'A-2',
  AG201: 'A-25',
  AG202: 'A-22',
  AG212: 'A-33',
  AG277: 'A-29',
  AG210: 'A-30',
  AG164: 'H13M',
  AG299: 'G40XL',
};

export const EXCEL_ROW_ALIAS_TO_MASTER = {
  'G-19': 'G18',
  G24CA: 'G24N',
};

const MARKETPLACE_SKU_TO_MASTER = {
  TRI65748392: 'AG227',
  TRI09812784: 'AG227',
  '129752150': 'AG227',
  '9522514852': 'H36',
  CHA12345678: 'AG186',
  'PÑL12309854': 'AG79',
  FLO4400237: 'Z7',
  CON09832134: 'Z7',
  CTF44329989: 'Z7',
  '148145225': 'A-25',
  '1441852874': 'A-25',
  '148126523': 'AG218',
  '140746934': 'H9XLN',
  '357258624678': 'FAL-146325783',
  '1512351': 'FAL-146325783',
  '6846846846465': 'FAL-151159665',
  AS544145685: 'FAL-115839107',
  '23123asdfef': 'FAL-144958533',
  '426745': 'FAL-144958533',
  '144958533': 'FAL-144958533',
  '144956424': 'FAL-144958533',
  OM21221112: 'FAL-140715461',
  '140715461': 'FAL-140715461',
  AFE781187: 'FAL-123389143',
  '123389143': 'FAL-123389143',
};

export const HISTORICAL_SKU_TO_MASTER = Object.freeze({
  ...LEGACY_AG_TO_EXCEL,
  ...EXCEL_ROW_ALIAS_TO_MASTER,
  ...MARKETPLACE_SKU_TO_MASTER,
});

export function historicalMastersAbsentFromExcel(catalogSkus, historicalMap = HISTORICAL_SKU_TO_MASTER) {
  const catalog = catalogSkus instanceof Set ? catalogSkus : new Set(catalogSkus || []);
  return [...new Set(Object.values(historicalMap))]
    .filter((sku) => sku && !catalog.has(sku))
    .sort();
}

export function excelMasterForSku(sku, catalogSkus, historicalMap = HISTORICAL_SKU_TO_MASTER) {
  const value = String(sku || '').trim();
  if (!value) return null;
  if (catalogSkus.has(value)) return value;
  const mapped = historicalMap[value];
  if (mapped && catalogSkus.has(mapped)) return mapped;
  return null;
}

export function planListingExcelRemap(listing, catalog, { trustProductId = true } = {}) {
  const currentSku = trustProductId
    ? (catalog.skuById.get(Number(listing.product_id)) || null)
    : null;
  const master = excelMasterForSku(listing.seller_sku, catalog.skus)
    || excelMasterForSku(listing.shop_sku, catalog.skus)
    || excelMasterForSku(currentSku, catalog.skus);
  if (!master) return null;
  const productId = catalog.idBySku.get(master);
  if (!productId || productId === Number(listing.product_id)) return null;
  return {
    listingId: Number(listing.id),
    productId,
    mainSku: master,
  };
}
