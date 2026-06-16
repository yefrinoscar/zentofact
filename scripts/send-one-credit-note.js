process.env.DATABASE_URL = 'sqlite:packages/desktop/storage/boletas.db';
process.env.STORAGE_PATH = 'packages/desktop/storage';

const core = require('../packages/core/dist');

async function main() {
  const boletaIdArg = process.argv[2];
  if (!boletaIdArg) {
    throw new Error('Uso: electron scripts/send-one-credit-note.js <boletaId>');
  }

  const boletaId = Number(boletaIdArg);
  if (!Number.isInteger(boletaId) || boletaId <= 0) {
    throw new Error(`boletaId invalido: ${boletaIdArg}`);
  }

  const result = await core.createAndSendCreditNoteFromBoleta(boletaId, {
    codMotivo: '01',
    desMotivo: 'ANULACION DE LA OPERACION',
    usuarioCreacion: 'codex:test-one-credit-note',
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('ERROR', error.stack || error.message);
  process.exit(1);
});
