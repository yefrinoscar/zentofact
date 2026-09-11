import test from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeFormat, BinaryBitmap, HybridBinarizer, NotFoundException, QRCodeWriter, RGBLuminanceSource } from '@zxing/library';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { PickingQrReader } from './picking-reader.ts';

function bitmap(width, height, isBlack) {
  const pixels = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels[y * width + x] = isBlack(x, y) ? 0 : 255;
  }
  return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height)));
}

test('ignores a secondary 0204 barcode instead of submitting it as a picking scan', () => {
  // Code 39 start, 0, 2, 0, 4, stop; narrow bars are 2 pixels, wide bars 6.
  const patterns = [0x094, 0x034, 0x061, 0x034, 0x031, 0x094];
  const row = Array(30).fill(false);
  for (const pattern of patterns) {
    for (let bit = 8; bit >= 0; bit--) {
      row.push(...Array(pattern & (1 << bit) ? 6 : 2).fill(bit % 2 === 0));
    }
    row.push(false, false);
  }
  row.push(...Array(30).fill(false));
  const frame = bitmap(row.length, 100, (x) => row[x]);
  assert.equal(new BrowserMultiFormatReader().decodeBitmap(frame).getText(), '0204');
  assert.throws(() => new PickingQrReader().decodeBitmap(frame), NotFoundException);
});

test('reads the full tracking from the label QR after ignoring a barcode', () => {
  const tracking = '240121000011723360';
  const matrix = new QRCodeWriter().encode(tracking, BarcodeFormat.QR_CODE, 240, 240, new Map());
  const frame = bitmap(matrix.getWidth(), matrix.getHeight(), (x, y) => matrix.get(x, y));
  assert.equal(new PickingQrReader().decodeBitmap(frame).getText(), tracking);
});
