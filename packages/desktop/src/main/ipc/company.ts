import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  listCompanies, getCompany, getCompanyByRuc,
  createCompany, updateCompany, deleteCompany, testSunatConnection,
} from '@zentofact/core';
import type { CreateCompanyInput, UpdateCompanyInput } from '@zentofact/core';

function getConfigPath() {
  const userData = app.getPath('userData');
  return path.join(userData, 'boletas-config.json');
}

function readConfig(): Record<string, any> {
  try {
    if (fs.existsSync(getConfigPath())) {
      return JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
    }
  } catch {}
  return {};
}

function writeConfig(data: Record<string, any>) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(data, null, 2));
}

export function registerCompanyHandlers() {
  ipcMain.handle('company:list', async () => {
    return listCompanies();
  });

  ipcMain.handle('company:get', async (_e, id: number) => {
    return getCompany(id);
  });

  ipcMain.handle('company:create', async (_e, data: CreateCompanyInput) => {
    return createCompany(data);
  });

  ipcMain.handle('company:update', async (_e, id: number, data: UpdateCompanyInput) => {
    return updateCompany(id, data);
  });

  ipcMain.handle('company:delete', async (_e, id: number) => {
    return deleteCompany(id);
  });

  ipcMain.handle('company:test-sunat', async (_e, id: number, environment: 'beta' | 'produccion' = 'beta') => {
    return testSunatConnection(id, environment);
  });

  ipcMain.handle('company:get-active', async () => {
    const config = readConfig();
    const configuredId = config.activeCompanyId ?? null;

    if (configuredId !== null) {
      const company = await getCompany(configuredId);
      if (company?.activo) {
        return configuredId;
      }
    }

    const firstActiveCompany = (await listCompanies())[0] ?? null;
    if (!firstActiveCompany) {
      return null;
    }

    config.activeCompanyId = firstActiveCompany.id;
    writeConfig(config);
    return firstActiveCompany.id;
  });

  ipcMain.handle('company:set-active', async (_e, id: number | null) => {
    const config = readConfig();
    config.activeCompanyId = id;
    writeConfig(config);
    return true;
  });
}
