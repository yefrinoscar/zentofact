import Database from 'better-sqlite3';
import { join } from 'path';

const dbPath = join(process.cwd(), 'packages/desktop/storage/boletas.db');
const sqlite = new Database(dbPath);

// Read current company 9
const before = sqlite.prepare('SELECT id, nombre, razon_social FROM companies WHERE id = 9').get();
console.log('Before:', before);

// Simulate what updateCompany does
sqlite.prepare(`UPDATE companies SET nombre = 'TEST NOMBRE', updated_at = strftime('%s','now') WHERE id = 9`).run();

const after = sqlite.prepare('SELECT id, nombre, razon_social FROM companies WHERE id = 9').get();
console.log('After:', after);

// Restore
sqlite.prepare(`UPDATE companies SET nombre = 'LIMBO 2', updated_at = strftime('%s','now') WHERE id = 9`).run();
const restored = sqlite.prepare('SELECT id, nombre, razon_social FROM companies WHERE id = 9').get();
console.log('Restored:', restored);

sqlite.close();
