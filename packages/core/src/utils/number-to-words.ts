const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'];
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const ESPECIALES = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'];
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function convertirGrupo(n: number): string {
  if (n === 100) return 'cien';
  if (n === 0) return '';

  let resultado = '';
  const c = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;

  if (c > 0) resultado += CENTENAS[c] + ' ';
  if (d === 1) {
    resultado += ESPECIALES[u];
    return resultado.trim();
  }
  if (d > 1) resultado += DECENAS[d] + (u > 0 ? ' y ' : ' ');
  if (u > 0) resultado += UNIDADES[u];

  return resultado.trim();
}

export function numeroALetras(numero: number): string {
  if (numero === 0) return 'cero';
  if (numero < 0) return 'menos ' + numeroALetras(Math.abs(numero));

  const entero = Math.floor(numero);
  const centavos = Math.round((numero - entero) * 100);

  if (entero === 0 && centavos === 0) return 'cero';

  const grupos: string[] = [];
  let n = entero;
  let i = 0;

  while (n > 0) {
    const grupo = n % 1000;
    if (grupo > 0) {
      let texto = convertirGrupo(grupo);
      if (i === 1) texto += ' mil';
      if (i === 2) texto += (grupo === 1 ? ' millón' : ' millones');
      grupos.unshift(texto);
    }
    n = Math.floor(n / 1000);
    i++;
  }

  let resultado = grupos.join(' ');
  resultado = resultado.charAt(0).toUpperCase() + resultado.slice(1);

  if (centavos > 0) {
    resultado += ` con ${centavos.toString().padStart(2, '0')}/100`;
  } else {
    resultado += ' con 00/100';
  }

  return resultado;
}
