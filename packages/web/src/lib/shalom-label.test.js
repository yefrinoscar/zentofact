import test from 'node:test';
import assert from 'node:assert/strict';
import {
  missingShalomLabelFields,
  resolveShalomLabel,
  shalomLabelError,
  shalomLabelSheetHtml,
} from './shalom-label.ts';

const label = { name: 'Maribel Vanesa Silva Cama', dni: '40328817', phone: '968784568', sede: 'Arequipa / Av Lima' };

test('la etiqueta toma nombre, DNI y celular del cliente hasta que el vendedor los cambia', () => {
  const customer = { name: 'Maribel Silva', phone: '968784568', dni: '40328817' };
  assert.deepEqual(resolveShalomLabel({}, customer), {
    name: 'Maribel Silva',
    dni: '40328817',
    phone: '968784568',
    sede: '',
  });
  assert.equal(resolveShalomLabel({ phone: '968784568 / 975141252' }, customer).phone, '968784568 / 975141252');
  assert.equal(resolveShalomLabel({ name: '' }, customer).name, '');
});

test('pide nombre, DNI de 8 dígitos, celular y sede', () => {
  assert.deepEqual(missingShalomLabelFields({ name: ' ', dni: '123', phone: '', sede: '' }), [
    'nombre',
    'DNI',
    'celular',
    'sede',
  ]);
  assert.equal(shalomLabelError(label), null);
  assert.equal(shalomLabelError({ ...label, sede: ' ' }), 'Completa la etiqueta Shalom: falta sede.');
});

test('la hoja lleva 2 etiquetas y pasa a otra página desde la tercera', () => {
  const html = shalomLabelSheetHtml(Array.from({ length: 5 }, (_, index) => ({ ...label, orderNumber: `P-${index}` })));
  assert.equal(html.match(/class="page"/g)?.length, 3);
  assert.equal(html.match(/class="cell"/g)?.length, 5);
  assert.match(html, /MARIBEL VANESA SILVA CAMA/);
  assert.match(html, /Pedido P-4/);
});

test('escapa lo que escribe el vendedor', () => {
  const html = shalomLabelSheetHtml([{ ...label, sede: 'Arequipa / <b>Alto</b>' }]);
  assert.match(html, /Arequipa \/ &lt;b&gt;Alto&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Alto/);
});
