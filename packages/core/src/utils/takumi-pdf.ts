// Render de PDF sin navegador (takumi-pdf, WebAssembly) para el MISMO HTML que antes
// imprimía Chromium. Liberation Sans es la fuente con la que Chromium dibuja "Arial"
// en Railway (fonts-liberation), así que el resultado coincide con producción.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from 'takumi-pdf';

const CSS_PX_PER_MM = 96 / 25.4;
const FONT_DIR = path.resolve(__dirname, '../../assets/fonts/liberation-sans');
const FONT_FACES = [
  { file: 'LiberationSans-Regular.ttf', weight: 400, style: 'normal' },
  { file: 'LiberationSans-Bold.ttf', weight: 700, style: 'normal' },
  { file: 'LiberationSans-Italic.ttf', weight: 400, style: 'italic' },
  { file: 'LiberationSans-BoldItalic.ttf', weight: 700, style: 'italic' },
] as const;

type TakumiFont = { name: string; data: Buffer; weight: number; style: string };
let fonts: TakumiFont[] | null = null;

function loadFonts(): TakumiFont[] {
  // Registradas como "Arial": la plantilla pide `font-family: Arial, Helvetica, sans-serif`.
  fonts ||= FONT_FACES.map((face) => ({
    name: 'Arial',
    data: readFileSync(path.join(FONT_DIR, face.file)),
    weight: face.weight,
    style: face.style,
  }));
  return fonts;
}

export async function renderHtmlToPdfWithTakumi(
  html: string,
  page: { widthMm: number; heightMm: number },
): Promise<Buffer> {
  const pdf = await render(html, {
    size: { width: page.widthMm * CSS_PX_PER_MM, height: page.heightMm * CSS_PX_PER_MM },
    margin: 0,
    fonts: loadFonts(),
    // Un carácter sin glifo (p. ej. un emoji en la descripción) no debe tumbar la emisión;
    // se dibuja como cuadro vacío, igual que Chromium sin una fuente que lo cubra.
    uncoveredText: 'placeholder',
  });
  return Buffer.from(pdf);
}
