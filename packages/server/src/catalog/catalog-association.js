const STOP_WORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'para', 'por',
  'su', 'sus', 'tu', 'tus', 'un', 'una', 'uno', 'y',
  // Descriptores comerciales que no cambian la identidad física del producto.
  'potente', 'simulador', 'sonido', 'talla',
]);

const TOKEN_ALIASES = new Map([
  ['hombres', 'hombre'], ['masculino', 'hombre'], ['masculina', 'hombre'],
  ['mujeres', 'mujer'], ['femenino', 'mujer'], ['femenina', 'mujer'],
  ['ninos', 'nino'], ['ninas', 'nina'],
  ['moldeadora', 'remodela'], ['moldeador', 'remodela'], ['moldear', 'remodela'],
  ['reductoras', 'reductora'], ['termico', 'termica'], ['termicas', 'termica'], ['termicos', 'termica'],
  ['munequera', 'pulsera'], ['munecuera', 'pulsera'], ['accesorios', 'accesorio'],
]);

const COLOR_ALIASES = new Map([
  ['black', 'negro'], ['negro', 'negro'], ['negra', 'negro'], ['negros', 'negro'], ['negras', 'negro'],
  ['white', 'blanco'], ['blanco', 'blanco'], ['blanca', 'blanco'], ['blancos', 'blanco'], ['blancas', 'blanco'],
  ['blue', 'azul'], ['azul', 'azul'], ['azules', 'azul'], ['red', 'rojo'], ['rojo', 'rojo'], ['roja', 'rojo'],
  ['green', 'verde'], ['verde', 'verde'], ['gray', 'gris'], ['grey', 'gris'], ['gris', 'gris'], ['grises', 'gris'],
  ['yellow', 'amarillo'], ['amarillo', 'amarillo'], ['amarilla', 'amarillo'], ['pink', 'rosado'], ['rosado', 'rosado'], ['rosada', 'rosado'], ['rosa', 'rosado'],
  ['purple', 'morado'], ['morado', 'morado'], ['purpura', 'morado'], ['violeta', 'morado'],
  ['orange', 'naranja'], ['naranja', 'naranja'], ['gold', 'dorado'], ['dorado', 'dorado'], ['dorada', 'dorado'],
  ['silver', 'plateado'], ['plateado', 'plateado'], ['plateada', 'plateado'],
  ['brown', 'marron'], ['marron', 'marron'], ['cafe', 'marron'], ['madera', 'marron'], ['marron oscuro', 'marron'],
  ['celeste', 'celeste'], ['ambar', 'ambar'], ['humo', 'humo'],
  ['crema', 'crema'], ['fucsia', 'fucsia'], ['turquesa', 'turquesa'], ['azul marino', 'azul marino'],
  ['camuflado', 'camuflado'], ['camuflada', 'camuflado'],
  ['beige', 'beige'], ['transparente', 'transparente'], ['multicolor', 'multicolor'],
]);

const COLOR_PHRASES = [...COLOR_ALIASES.keys()].sort((left, right) => right.length - left.length);
const SIZE_ALIASES = new Map([
  ['extra small', 'XS'], ['xs', 'XS'],
  ['small', 'S'], ['s', 'S'],
  ['medium', 'M'], ['m', 'M'],
  ['large', 'L'], ['l', 'L'],
  ['extra large', 'XL'], ['xl', 'XL'],
  ['xxl', 'XXL'], ['2xl', 'XXL'], ['xxxl', 'XXXL'], ['3xl', 'XXXL'],
  ['talla unica', 'UNICA'], ['unica', 'UNICA'], ['unico', 'UNICA'], ['one size', 'UNICA'],
]);

// Excepciones verificadas visualmente en el catálogo real. Falabella mantiene
// publicaciones con nombres distintos para la misma unidad física; estas
// reglas eliminan solo los descriptores que el seller usa como título/modelo.
const VERIFIED_EQUIVALENT_FAMILIES = [
  {
    key: 'manta-termica-mylar-140x210',
    requiredTokens: ['manta', 'termica', 'emergencia'],
    anyTokens: ['mylar', '140x210'],
    ignoredTokens: new Set([
      '140x210', 'aluminizada', 'camping', 'desastres', 'mylar', 'supervivencia', 'trekking',
    ]),
  },
  {
    key: 'pulsera-camara-gopro',
    requiredTokens: ['pulsera', 'camara', 'accesorio'],
    anyTokens: ['gopro', 'accion', 'mano', 'giratoria'],
    // Los sellers alternan entre GoPro, acción, mano y giratoria para el
    // mismo accesorio físico. Color y talla siguen siendo señales de variante.
    ignoredTokens: new Set(['accion', 'gopro', 'giratoria', 'mano']),
  },
];

// Excepciones verificadas contra las fotos del catálogo real. ShopSku fija la
// identidad física cuando el título publicado es ambiguo o cambia entre sellers.
const VERIFIED_LISTING_FAMILIES = new Map([
  ...['144952457', '144962095', '144958641', '144962778', '144957751', '144956187', '146325129']
    .map((shopSku) => [shopSku, 'mochila-viral-usb']),
  ...['129620781', '129756078', '129727176', '129591195', '131589787', '115743341']
    .map((shopSku) => [shopSku, 'mochila-deportiva-40l']),
  ...['144952628', '144959236', '144962066', '144958289', '144962740', '156499931']
    .map((shopSku) => [shopSku, 'mochila-trekking-45l']),
  ...['140695706', '140716145', '140715136', '140392127', '140604057', '140747083', '156581151']
    .map((shopSku) => [shopSku, 'pilas-aa-recargables-usb-c']),
  ...['115717657', '135891757', '155435960', '129759067', '149672431', '156500250']
    .map((shopSku) => [shopSku, 'capucha-polar-6-en-1']),
  ...[
    '140456403', '140712936', '144949909', '140679978', '140542914', '144959108',
    '144959117', '144962045', '144958250', '144962723', '144957114', '144954569',
    '140511766', '140552072', '140747081', '156499933', '156500184',
  ].map((shopSku) => [shopSku, 'mochila-camping-trekking-40l']),
  ...['144949858', '144959372', '144962079', '144958577', '144962756', '144955951', '144957656', '156500047']
    .map((shopSku) => [shopSku, 'mochila-viajera-aerolineas']),
  ...['123383049', '131601207', '129729338', '135888450', '129647340', '129622659', '129756627', '156583836']
    .map((shopSku) => [shopSku, 'toalla-microfibra-celeste']),
  ...['144951810', '144962075', '144958812', '144957741', '156499963']
    .map((shopSku) => [shopSku, 'mochila-expandible-viaje']),
  ...['144953026', '144959434', '144962119', '144958703', '144962811', '144956638', '152680399', '156500089']
    .map((shopSku) => [shopSku, 'bolso-gama-alta-marron']),
  ...[
    '118765884', '140704229', '140716398', '140715719', '140472056', '140746371', '140822979',
    '118765883', '140704280', '140716390', '140715731', '140472053', '140746403', '140823062',
    '118765881', '140704030', '140716278', '140715693', '140472033', '140746524', '140823005',
    '118765880', '140704149', '140716282', '140715699', '140472001', '140746590', '140822892',
    '140704198', '140716287', '140715706', '140511764', '140746933', '140823054',
    '140704306', '140716408', '140715741', '140472043', '140746441', '140822955',
    '140454972', '156576493', '156576509', '156576540', '156576302', '156576358', '156576403',
  ].map((shopSku) => [shopSku, 'camiseta-faja-reductora-vivid-bvd']),
  ...[
    '128545421', '129551348', '129750004', '131876164',
    '128545517', '131610914', '129551254', '129750010',
    '136344532', '129741409', '135888322', '129645938',
  ].map((shopSku) => [shopSku, 'silla-comer-reclinable']),
  ...['144959050', '144962663', '156582201']
    .map((shopSku) => [shopSku, 'silla-comer-evolutiva-patas-altas']),
  ...['140437519', '140681420', '140716029', '140714631', '140377407', '140546534', '140743807', '156581792']
    .map((shopSku) => [shopSku, 'adorno-pared-ginkgo']),
  ...['140430971', '140681536', '140716049', '140714723', '140377163', '140546071', '140743698', '156581814']
    .map((shopSku) => [shopSku, 'adorno-pared-hojas-alargadas']),
  ...['140432973', '140681492', '140716042', '140714636', '140377491', '140546464', '140743749', '156581830']
    .map((shopSku) => [shopSku, 'adorno-pared-ramas-finas']),
]);

const VERIFIED_SIZELESS_FAMILIES = new Set([
  'bolso-gama-alta-marron',
  'capucha-polar-6-en-1',
  'mochila-camping-trekking-40l',
  'mochila-expandible-viaje',
  'mochila-viajera-aerolineas',
]);

const VERIFIED_COLORLESS_FAMILIES = new Set([
  'silla-comer-evolutiva-patas-altas',
  'silla-comer-reclinable',
]);

export function normalizeCatalogText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeColor(value, title) {
  const direct = normalizeCatalogText(value);
  if (direct) return COLOR_ALIASES.get(direct) || '';
  const normalizedTitle = ` ${normalizeCatalogText(title)} `;
  const match = COLOR_PHRASES.find((candidate) => normalizedTitle.includes(` ${candidate} `));
  return match ? COLOR_ALIASES.get(match) : '';
}

function normalizeSize(value, title) {
  const direct = normalizeCatalogText(value);
  const normalizedTitle = normalizeCatalogText(title);
  const explicit = /(?:^|\s)talla\s+(xxxl|3xl|xxl|2xl|xl|xs|s|m|l|unica)(?:\s|$)/.exec(normalizedTitle);
  // Falabella a veces envía la cantidad del pack (por ejemplo "1") en el
  // atributo size. Cuando el título sí declara una talla de ropa, esa señal es
  // la variante comercial correcta.
  if (explicit && (!direct || /^\d+(?:\.\d+)?$/.test(direct))) {
    return SIZE_ALIASES.get(explicit[1]) || explicit[1].toUpperCase();
  }
  if (direct) return SIZE_ALIASES.get(direct) || direct.toUpperCase();
  if (explicit) return SIZE_ALIASES.get(explicit[1]) || explicit[1].toUpperCase();
  const trailing = /(?:^|\s)(xxxl|3xl|xxl|2xl|xl|xs|s|m|l)(?:\s|$)$/.exec(normalizedTitle);
  return trailing ? SIZE_ALIASES.get(trailing[1]) || trailing[1].toUpperCase() : '';
}

function normalizedTokens(title, color, size) {
  const colorParts = new Set(normalizeCatalogText(color).split(' ').filter(Boolean));
  const normalizedSize = normalizeCatalogText(size);
  return normalizeCatalogText(title).split(' ').filter(Boolean).filter((token) => {
    if (STOP_WORDS.has(token) || colorParts.has(token)) return false;
    if (normalizedSize && (token === normalizedSize || SIZE_ALIASES.get(token) === size)) return false;
    return true;
  }).map((token) => TOKEN_ALIASES.get(token) || token);
}

function tokenMetrics(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const smaller = Math.min(left.size, right.size) || 1;
  const union = new Set([...left, ...right]).size || 1;
  return {
    intersection,
    containment: intersection / smaller,
    jaccard: intersection / union,
  };
}

function finitePrice(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function comparableCategory(value) {
  return normalizeCatalogText(value).split(' ').filter((token) => token && !STOP_WORDS.has(token));
}

function verifiedEquivalentFamily(tokens, modelTokens) {
  const tokenSet = new Set(tokens);
  return VERIFIED_EQUIVALENT_FAMILIES.find((family) => {
    if (!family.requiredTokens.every((token) => tokenSet.has(token))) return false;
    if (family.anyTokens && !family.anyTokens.some((token) => tokenSet.has(token))) return false;
    if (family.modelTokens && (
      modelTokens.length !== 1 || !family.modelTokens.has(modelTokens[0])
    )) return false;
    return true;
  }) || null;
}

export function falabellaAssociationProfile(remote = {}) {
  const title = String(remote.name || remote.title || '').trim();
  let color = normalizeColor(remote.color, title);
  let size = normalizeSize(remote.size, title);
  let tokens = normalizedTokens(title, color, size);
  const images = (Array.isArray(remote.images) ? remote.images : [remote.imageUrl || remote.image_url])
    .map((value) => String(value || '').trim()).filter(Boolean);
  let modelTokens = [...new Set(normalizeCatalogText(title).split(' ')
    .filter((token) => /\d/.test(token))
    .map((token) => /^n(\d+)$/.exec(token)?.[1] || token))];
  const verifiedListingFamily = VERIFIED_LISTING_FAMILIES.get(String(remote.shopSku || '').trim()) || '';
  const verifiedSemanticFamily = verifiedEquivalentFamily(tokens, modelTokens);
  const verifiedFamily = verifiedListingFamily || verifiedSemanticFamily?.key || '';
  if (VERIFIED_SIZELESS_FAMILIES.has(verifiedFamily)) size = '';
  if (VERIFIED_COLORLESS_FAMILIES.has(verifiedFamily)) color = '';
  const ignoredTokens = verifiedListingFamily
    ? new Set(['1', '2', '3'])
    : verifiedSemanticFamily?.ignoredTokens;
  if (verifiedFamily) {
    tokens = tokens.filter((token) => !ignoredTokens?.has(token));
    modelTokens = modelTokens.filter((token) => !ignoredTokens?.has(token));
  }
  return {
    title,
    normalizedTitle: normalizeCatalogText(title),
    color,
    size,
    tokens,
    brand: normalizeCatalogText(remote.brand),
    categoryTokens: comparableCategory(remote.primaryCategory || remote.category),
    modelTokens,
    verifiedFamily,
    price: finitePrice(remote.effectivePrice ?? remote.salePrice ?? remote.price),
    images,
    imageFingerprints: (Array.isArray(remote.imageFingerprints) ? remote.imageFingerprints : [remote.imageFingerprint])
      .map((value) => String(value || '').trim()).filter(Boolean),
    sellerSkus: [remote.sellerSku, ...(Array.isArray(remote.sellerSkus) ? remote.sellerSkus : [])]
      .map((value) => normalizeCatalogText(value)).filter(Boolean),
    knownColors: color ? [color] : [],
    knownSizes: size ? [size] : [],
  };
}

function variantsCompatible(left, right) {
  if (left.color && right.color && left.color !== right.color) return false;
  if (left.size && right.size && left.size !== right.size) return false;
  return true;
}

export function scoreFalabellaAssociation(leftInput, rightInput) {
  const left = leftInput?.tokens ? leftInput : falabellaAssociationProfile(leftInput);
  const right = rightInput?.tokens ? rightInput : falabellaAssociationProfile(rightInput);
  if (!variantsCompatible(left, right)) {
    return { eligible: false, confidence: 0, reason: 'variant_conflict', signals: [] };
  }

  const verifiedEquivalent = left.verifiedFamily && left.verifiedFamily === right.verifiedFamily;
  if (left.verifiedFamily !== right.verifiedFamily && (left.verifiedFamily || right.verifiedFamily)) {
    return { eligible: false, confidence: 0, reason: 'verified_family_conflict', signals: [] };
  }

  const exactImageUrl = left.images.some((image) => right.images.includes(image));
  const exactImageContent = left.imageFingerprints.some((fingerprint) => right.imageFingerprints.includes(fingerprint));
  const exactImage = exactImageUrl || exactImageContent;
  const exactSellerSku = left.sellerSkus.some((sellerSku) => right.sellerSkus.includes(sellerSku));
  const title = tokenMetrics(left.tokens, right.tokens);
  const titleSimilarity = Number(((title.containment + title.jaccard) / 2).toFixed(4));
  if (!verifiedEquivalent && !exactSellerSku && left.modelTokens.length && right.modelTokens.length
    && !left.modelTokens.some((token) => right.modelTokens.includes(token))) {
    return { eligible: false, confidence: 0, reason: 'model_conflict', signals: [] };
  }
  if (!verifiedEquivalent && ((!exactImage && !exactSellerSku && (title.intersection < 3 || title.containment < 0.6))
    || ((exactImage || exactSellerSku) && title.intersection < 1))) {
    return { eligible: false, confidence: 0, reason: 'weak_product_family', signals: [] };
  }
  if (title.jaccard < 0.65 && !exactImage && !exactSellerSku) {
    return { eligible: false, confidence: 0, reason: 'ambiguous_product_family', signals: [] };
  }

  const signals = [
    `title:${title.intersection}/${Math.min(new Set(left.tokens).size, new Set(right.tokens).size)}`,
  ];
  let confidence = (title.containment * 0.72) + (title.jaccard * 0.28);

  if (verifiedEquivalent) {
    confidence = Math.max(confidence, 0.99);
    signals.push(`verified_family:${left.verifiedFamily}`);
  }

  if (left.color && right.color) {
    confidence += 0.06;
    signals.push(`color:${left.color}`);
  }
  if (left.size && right.size) {
    confidence += 0.07;
    signals.push(`size:${left.size}`);
  }
  if (left.brand && right.brand) {
    if (left.brand !== right.brand) return { eligible: false, confidence: 0, reason: 'brand_conflict', signals };
    confidence += 0.05;
    signals.push(`brand:${left.brand}`);
  }
  const category = tokenMetrics(left.categoryTokens, right.categoryTokens);
  if (left.categoryTokens.length && right.categoryTokens.length && category.containment >= 0.6) {
    confidence += 0.03;
    signals.push('category');
  }
  if (left.price && right.price) {
    const ratio = Math.max(left.price, right.price) / Math.min(left.price, right.price);
    if (ratio <= 1.15) {
      confidence += 0.06;
      signals.push('price:near');
    } else if (ratio <= 1.6) {
      confidence += 0.02;
      signals.push('price:compatible');
    } else if (ratio >= 3) {
      confidence -= 0.08;
      signals.push('price:far');
    }
  }
  if (exactImage) {
    confidence = Math.max(confidence + 0.12, 0.95);
    signals.push(exactImageContent ? 'image:content' : 'image:url');
  }
  if (exactSellerSku) {
    confidence = Math.max(confidence + 0.14, 0.98);
    signals.push('seller_sku:exact');
  }

  const rounded = Math.max(0, Math.min(1, Number(confidence.toFixed(4))));
  return {
    eligible: rounded >= 0.82,
    confidence: rounded,
    titleSimilarity,
    reason: rounded >= 0.82 ? 'high_confidence' : 'below_threshold',
    signals,
  };
}

function semanticKey(profile) {
  const family = profile.verifiedFamily
    ? `verified:${profile.verifiedFamily}`
    : [...new Set(profile.tokens)].sort().join(' ');
  return `${family}|${profile.color}|${profile.size}`;
}

/**
 * Agrupa publicaciones equivalentes usando señales explicables. Los grupos grandes
 * se convierten en anclas y un candidato ambiguo permanece separado.
 */
export function groupFalabellaCatalogRecords(records, { threshold = 0.82, ambiguityMargin = 0.025 } = {}) {
  const exact = new Map();
  for (const record of records) {
    const profile = falabellaAssociationProfile(record.remote);
    const identity = profile.verifiedFamily
      ? `verified:${profile.verifiedFamily}`
      : profile.normalizedTitle;
    const key = `${identity}|${profile.color}|${profile.size}`;
    if (!exact.has(key)) exact.set(key, {
      key, profile, profiles: [], records: [], sourceGroups: [], companyIds: new Set(),
    });
    exact.get(key).profiles.push(profile);
    const signals = ['exact_identity'];
    if (profile.verifiedFamily) signals.push(`verified_family:${profile.verifiedFamily}`);
    exact.get(key).records.push({ ...record, association: { method: 'exact', confidence: 1, signals } });
    exact.get(key).companyIds.add(Number(record.company?.id));
  }
  for (const group of exact.values()) {
    group.profile.images = [...new Set(group.profiles.flatMap((profile) => profile.images))];
    group.profile.imageFingerprints = [...new Set(group.profiles.flatMap((profile) => profile.imageFingerprints))];
    group.profile.sellerSkus = [...new Set(group.profiles.flatMap((profile) => profile.sellerSkus))];
    group.profile.knownColors = [...new Set(group.profiles.flatMap((profile) => profile.knownColors))];
    group.profile.knownSizes = [...new Set(group.profiles.flatMap((profile) => profile.knownSizes))];
  }
  const sourceGroups = [...exact.values()].sort((left, right) => (
    right.records.length - left.records.length || right.profile.tokens.length - left.profile.tokens.length
  ));
  const clusters = [];
  for (const source of sourceGroups) {
    const candidates = clusters.map((cluster) => {
      const overlapsSeller = [...source.companyIds].some((companyId) => cluster.companyIds.has(companyId));
      const hasExactImage = source.profile.imageFingerprints
        .some((fingerprint) => cluster.profile.imageFingerprints.includes(fingerprint));
      const comparisons = [scoreFalabellaAssociation(source.profile, cluster.profile)];
      const minimum = comparisons[0].confidence;
      const average = minimum;
      const titleSimilarity = comparisons[0].titleSimilarity || 0;
      const hasExactSellerSku = comparisons.some((comparison) => comparison.signals.includes('seller_sku:exact'));
      const hasVerifiedFamily = comparisons.some((comparison) => (
        comparison.signals.some((signal) => signal.startsWith('verified_family:'))
      ));
      const colorConflict = source.profile.knownColors.length && cluster.profile.knownColors.length
        && !source.profile.knownColors.some((color) => cluster.profile.knownColors.includes(color));
      const sizeConflict = source.profile.knownSizes.length && cluster.profile.knownSizes.length
        && !source.profile.knownSizes.some((size) => cluster.profile.knownSizes.includes(size));
      const corroboratedDuplicate = hasVerifiedFamily || (cluster.companyIds.size >= 3 && minimum >= 0.95);
      if (colorConflict || sizeConflict) return null;
      if (overlapsSeller && !hasExactImage && !hasExactSellerSku && !corroboratedDuplicate) return null;
      return {
        cluster,
        comparisons,
        minimum,
        average,
        exactImage: comparisons.some((comparison) => comparison.signals.includes('image:content')),
        exactSellerSku: hasExactSellerSku,
        sellerSupport: cluster.companyIds.size,
        titleSimilarity,
      };
    }).filter(Boolean).filter((candidate) => candidate.comparisons.every((comparison) => comparison.eligible && comparison.confidence >= threshold))
      .sort((left, right) => Number(right.exactSellerSku) - Number(left.exactSellerSku)
        || Number(right.exactImage) - Number(left.exactImage)
        || right.titleSimilarity - left.titleSimilarity
        || right.sellerSupport - left.sellerSupport
        || right.average - left.average);
    const best = candidates[0];
    const ambiguous = best && candidates[1]
      && best.exactSellerSku === candidates[1].exactSellerSku
      && best.exactImage === candidates[1].exactImage
      && best.titleSimilarity - candidates[1].titleSimilarity < ambiguityMargin
      && best.sellerSupport - candidates[1].sellerSupport < 2
      && best.average - candidates[1].average < ambiguityMargin;
    if (!best || ambiguous) {
      clusters.push({ profile: source.profile, sourceGroups: [source], records: [...source.records], companyIds: new Set(source.companyIds) });
      continue;
    }
    const comparison = best.comparisons.sort((left, right) => right.confidence - left.confidence)[0];
    const associated = source.records.map((record) => ({
      ...record,
      association: {
        method: 'multisignal',
        confidence: comparison.confidence,
        signals: comparison.signals,
      },
    }));
    best.cluster.sourceGroups.push(source);
    best.cluster.records.push(...associated);
    best.cluster.profile.images = [...new Set([...best.cluster.profile.images, ...source.profile.images])];
    best.cluster.profile.imageFingerprints = [...new Set([
      ...best.cluster.profile.imageFingerprints,
      ...source.profile.imageFingerprints,
    ])];
    best.cluster.profile.sellerSkus = [...new Set([
      ...best.cluster.profile.sellerSkus,
      ...source.profile.sellerSkus,
    ])];
    best.cluster.profile.knownColors = [...new Set([
      ...best.cluster.profile.knownColors,
      ...source.profile.knownColors,
    ])];
    best.cluster.profile.knownSizes = [...new Set([
      ...best.cluster.profile.knownSizes,
      ...source.profile.knownSizes,
    ])];
    for (const companyId of source.companyIds) best.cluster.companyIds.add(companyId);
  }
  return clusters.map((cluster) => ({
    profile: cluster.profile,
    sourceGroups: cluster.sourceGroups,
    records: cluster.records,
    identity: semanticKey(cluster.profile),
  }));
}
