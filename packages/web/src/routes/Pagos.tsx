import { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload } from 'lucide-react';
import api from '../lib/api';
import { decodeSettlementCsv, importSummary, money, paymentStatusLabel, settlementMethodLabel, unmatchedReasonLabel } from '../lib/pagos-presentation';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePanel,
  TablePanelHeader,
  TableRow,
} from '@/components/ui/table';

const dateTime = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Lima',
});

export default function Pagos() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'matched' | 'unmatched'>('matched');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const importsQuery = useQuery({
    queryKey: ['pagos-imports'],
    queryFn: () => api.listSettlementImports({ limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const linesQuery = useQuery({
    queryKey: ['pagos-lines', tab],
    queryFn: () => api.listSettlementLines({ status: tab, limit: 200 }),
    placeholderData: keepPreviousData,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const csv = decodeSettlementCsv(await file.arrayBuffer());
      return api.importSettlementCsv({ filename: file.name, csv });
    },
    onSuccess: async (result) => {
      setError('');
      setNotice(importSummary(result));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pagos-imports'] }),
        queryClient.invalidateQueries({ queryKey: ['pagos-lines'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
    onError: (nextError) => {
      setNotice('');
      setError((nextError as Error).message || 'No se pudo leer el CSV.');
    },
  });

  const imports = importsQuery.data?.items || [];
  const lines = linesQuery.data?.items || [];

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center justify-end">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) upload.mutate(file);
          }}
        />
        <Button type="button" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Upload data-icon="inline-start" />}
          Subir CSV
        </Button>
      </div>

      {notice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <TablePanel aria-label="Historial de liquidaciones">
        <TablePanelHeader>
          <p className="text-sm font-medium">Historial</p>
        </TablePanelHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Archivo</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Cruzadas</TableHead>
              <TableHead className="text-right">Sin cruzar</TableHead>
              <TableHead className="text-right">Ventas pagadas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.map((item: { id: number; filename: string; importedAt?: string; matchedCount: number; unmatchedCount: number; paidSalesCount: number }) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.filename}</TableCell>
                <TableCell>{item.importedAt ? dateTime.format(new Date(item.importedAt)) : ''}</TableCell>
                <TableCell className="text-right tabular-nums">{item.matchedCount}</TableCell>
                <TableCell className="text-right tabular-nums">{item.unmatchedCount}</TableCell>
                <TableCell className="text-right tabular-nums">{item.paidSalesCount}</TableCell>
              </TableRow>
            ))}
            {!imports.length && !importsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Todavía no hay liquidaciones cargadas.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TablePanel>

      <Tabs value={tab} onValueChange={(value) => setTab(value as 'matched' | 'unmatched')}>
        <TabsList>
          <TabsTrigger value="matched">Cruzadas</TabsTrigger>
          <TabsTrigger value="unmatched">Sin cruzar</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <TablePanel aria-label={tab === 'matched' ? 'Líneas cruzadas' : 'Líneas sin cruzar'}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Pago</TableHead>
                  <TableHead>Cruce</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Comisión</TableHead>
                  <TableHead className="text-right">Otros</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line: {
                  id: number;
                  saleOrderNumber?: string | null;
                  orderId?: string;
                  sku?: string;
                  date?: string | null;
                  type?: string;
                  paymentStatus?: string;
                  method?: string | null;
                  reason?: string | null;
                  bruto?: number;
                  commission?: number;
                  other?: number;
                  neto?: number;
                }) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.saleOrderNumber || line.orderId || '—'}</TableCell>
                    <TableCell>{line.sku || '—'}</TableCell>
                    <TableCell>{line.date || '—'}</TableCell>
                    <TableCell>{line.type || '—'}</TableCell>
                    <TableCell>{paymentStatusLabel(line.paymentStatus)}</TableCell>
                    <TableCell>{tab === 'matched' ? settlementMethodLabel(line.method) : unmatchedReasonLabel(line.reason)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money.format(line.bruto || 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money.format(line.commission || 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money.format(line.other || 0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money.format(line.neto || 0)}</TableCell>
                  </TableRow>
                ))}
                {!lines.length && !linesQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                      {tab === 'matched' ? 'No hay líneas cruzadas.' : 'No hay líneas sin cruzar.'}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </TablePanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
