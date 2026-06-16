import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';

const EXTENSION_XPATH = "//*[local-name(.)='ExtensionContent']";
const DOCUMENT_XPATH = "/*";
const C14N_ALGORITHM = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED_SIGNATURE_TRANSFORM = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA1_ALGORITHM = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1_DIGEST_ALGORITHM = 'http://www.w3.org/2000/09/xmldsig#sha1';

export function signXml(xml: string, privateKeyPem: string, certificatePem: string): string {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
  });

  sig.canonicalizationAlgorithm = C14N_ALGORITHM;
  sig.signatureAlgorithm = RSA_SHA1_ALGORITHM;

  sig.addReference({
    xpath: DOCUMENT_XPATH,
    transforms: [
      ENVELOPED_SIGNATURE_TRANSFORM,
      C14N_ALGORITHM,
    ],
    digestAlgorithm: SHA1_DIGEST_ALGORITHM,
    isEmptyUri: true,
  });

  try {
    sig.computeSignature(xml, {
      prefix: 'ds',
      location: {
        reference: EXTENSION_XPATH,
        action: 'append',
      },
    });
  } catch (e: any) {
    throw new Error(
      `Error al firmar el XML para SUNAT: no se encontró el elemento <ext:ExtensionContent> en el XML generado. ` +
      `Verifica que el certificado digital (.pfx) sea válido y la contraseña correcta. Detalle: ${e.message}`
    );
  }

  return sig.getSignedXml();
}

export function extractHashFromXml(xml: string): string | null {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const digestValues = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'DigestValue');
  if (digestValues.length > 0) {
    return digestValues[0].textContent || null;
  }
  return null;
}
