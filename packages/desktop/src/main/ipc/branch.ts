import { ipcMain } from 'electron';
import { listBranches, createBranch, updateBranch } from '@zentofact/core';
import type { CreateBranchInput, UpdateBranchInput } from '@zentofact/core';

export function registerBranchHandlers() {
  ipcMain.handle('branch:list', async (_e, companyId: number) => {
    return listBranches(companyId);
  });

  ipcMain.handle('branch:create', async (_e, data: CreateBranchInput) => {
    return createBranch(data);
  });

  ipcMain.handle('branch:update', async (_e, id: number, data: UpdateBranchInput) => {
    return updateBranch(id, data);
  });
}
