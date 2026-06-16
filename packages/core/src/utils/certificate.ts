import forge from 'node-forge';

export interface CertificateKeys {
  privateKey: string;
  certificate: string;
}

export function parsePfxToPem(pfxBase64: string, password: string): CertificateKeys {
  const pfxDer = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);

  const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];

  if (!keyBag?.key || !certBag?.cert) {
    throw new Error('No se pudo extraer la clave privada o el certificado del archivo PFX');
  }

  return {
    privateKey: forge.pki.privateKeyToPem(keyBag.key),
    certificate: forge.pki.certificateToPem(certBag.cert),
  };
}

export function parsePem(pemContent: string): CertificateKeys {
  const privateKeyMatch = pemContent.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/);
  const certificateMatch = pemContent.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);

  const privateKey = privateKeyMatch?.[0] || '';
  const certificate = certificateMatch?.[0] || '';

  if (!privateKey || !certificate) {
    throw new Error('No se encontró clave privada o certificado en el archivo PEM');
  }

  return { privateKey, certificate };
}
