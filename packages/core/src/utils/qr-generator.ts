import QRCode from 'qrcode';

export async function generateQRDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    width: 200,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

export function buildQRString(boleta: {
  ruc: string;
  tipoDocumento: string;
  serie: string;
  correlativo: string;
  mtoIgv: string;
  mtoImpVenta: string;
  fechaEmision: string;
  tipoDocCliente: string;
  numDocCliente: string;
}): string {
  return [
    boleta.ruc,
    boleta.tipoDocumento,
    boleta.serie,
    boleta.correlativo,
    boleta.mtoIgv,
    boleta.mtoImpVenta,
    boleta.fechaEmision,
    boleta.tipoDocCliente,
    boleta.numDocCliente,
  ].join('|');
}
