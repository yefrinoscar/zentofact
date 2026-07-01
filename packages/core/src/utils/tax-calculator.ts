export interface DetalleItem {
  codigo: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  mto_valor_unitario: number;
  mto_valor_gratuito?: number;
  // Bruto de la línea (con IGV) tal como vino del origen (ej. precio Falabella).
  // Si está presente, el IGV se deriva como (bruto − base) para que el total cuadre
  // exacto con el bruto, en vez de recalcular round(base × %) que desfasa 1-2 céntimos.
  mto_bruto?: number;
  porcentaje_igv: number;
  porcentaje_ivap?: number;
  tip_afe_igv: string;
  isc?: number;
  icbper?: number;
  factor_icbper?: number;
  codigo_producto_sunat?: string;
}

export interface TaxTotals {
  valorVenta: number;
  mtoOperGravadas: number;
  mtoOperExoneradas: number;
  mtoOperInafectas: number;
  mtoOperGratuitas: number;
  mtoIgvGratuitas: number;
  mtoIgv: number;
  mtoBaseIvap: number;
  mtoIvap: number;
  mtoIsc: number;
  mtoIcbper: number;
  totalImpuestos: number;
  subTotal: number;
  mtoImpVenta: number;
}

export function calculateTotals(detalles: DetalleItem[]): TaxTotals {
  let mtoOperGravadas = 0;
  let mtoOperExoneradas = 0;
  let mtoOperInafectas = 0;
  let mtoOperGratuitas = 0;
  let mtoIgvGratuitas = 0;
  let mtoIgv = 0;
  let mtoBaseIvap = 0;
  let mtoIvap = 0;
  let mtoIsc = 0;
  let mtoIcbper = 0;
  let valorVenta = 0;

  for (const d of detalles) {
    const cantidad = Number(d.cantidad);
    const valorUnitario = Number(d.mto_valor_unitario);
    const valorGratuito = Number(d.mto_valor_gratuito ?? 0);
    const itemValorVenta = Math.round(cantidad * valorUnitario * 100) / 100;
    const itemValorGratuito = Math.round(cantidad * valorGratuito * 100) / 100;
    const tip = d.tip_afe_igv;

    // Gravado (10, 11, 12, 13, 14)
    if (['10', '11', '12', '13', '14', '15', '16'].includes(tip)) {
      mtoOperGravadas += itemValorVenta;
      if (tip === '11') {
        mtoOperGratuitas += itemValorGratuito;
        mtoIgvGratuitas += Math.round(itemValorGratuito * d.porcentaje_igv) / 100;
      }
      // Si la línea trae su bruto (con IGV), el IGV es el resto (bruto − base) para cuadrar exacto.
      // Si no, se recalcula desde la base como antes.
      const brutoLinea = Number(d.mto_bruto ?? 0);
      mtoIgv += brutoLinea > 0
        ? Math.round((brutoLinea - itemValorVenta) * 100) / 100
        : Math.round(itemValorVenta * d.porcentaje_igv) / 100;
    }
    // IVAP (17)
    else if (tip === '17') {
      mtoBaseIvap += itemValorVenta;
      mtoIvap += Math.round(itemValorVenta * (d.porcentaje_ivap ?? d.porcentaje_igv)) / 100;
    }
    // Exonerado (20, 21)
    else if (['20', '21'].includes(tip)) {
      mtoOperExoneradas += itemValorVenta;
      if (tip === '21') {
        mtoOperGratuitas += itemValorGratuito;
      }
    }
    // Inafecto (30, 31, 32, 33, 34, 35, 36, 37, 40)
    else if (['30', '31', '32', '33', '34', '35', '36', '37', '40'].includes(tip)) {
      mtoOperInafectas += itemValorVenta;
    }

    // ISC
    const itemIsc = Number(d.isc ?? 0);
    if (itemIsc > 0) {
      mtoIsc += Math.round(cantidad * itemIsc * 100) / 100;
    }
    // ICBPER
    const factorIcbper = Number(d.factor_icbper ?? 0);
    const itemIcbper = Number(d.icbper ?? 0);
    if (factorIcbper > 0) {
      mtoIcbper += Math.round(cantidad * factorIcbper * itemIcbper * 100) / 100;
    }

    valorVenta += itemValorVenta;
  }

  // Redondear a 2 decimales
  mtoOperGravadas = Math.round(mtoOperGravadas * 100) / 100;
  mtoOperExoneradas = Math.round(mtoOperExoneradas * 100) / 100;
  mtoOperInafectas = Math.round(mtoOperInafectas * 100) / 100;
  mtoOperGratuitas = Math.round(mtoOperGratuitas * 100) / 100;
  mtoIgvGratuitas = Math.round(mtoIgvGratuitas * 100) / 100;
  mtoIgv = Math.round(mtoIgv * 100) / 100;
  mtoBaseIvap = Math.round(mtoBaseIvap * 100) / 100;
  mtoIvap = Math.round(mtoIvap * 100) / 100;
  mtoIsc = Math.round(mtoIsc * 100) / 100;
  mtoIcbper = Math.round(mtoIcbper * 100) / 100;
  valorVenta = Math.round(valorVenta * 100) / 100;

  const totalImpuestos = Math.round((mtoIgv + mtoIvap + mtoIsc + mtoIcbper) * 100) / 100;
  const subTotal = Math.round(valorVenta * 100) / 100;
  const mtoImpVenta = Math.round((subTotal + totalImpuestos + mtoIgvGratuitas) * 100) / 100;

  return {
    valorVenta,
    mtoOperGravadas,
    mtoOperExoneradas,
    mtoOperInafectas,
    mtoOperGratuitas,
    mtoIgvGratuitas,
    mtoIgv,
    mtoBaseIvap,
    mtoIvap,
    mtoIsc,
    mtoIcbper,
    totalImpuestos,
    subTotal,
    mtoImpVenta,
  };
}
