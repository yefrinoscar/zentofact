import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import api from "../lib/api";
import { usePermissions } from "../hooks/usePermissions";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";

type Kind = "factura" | "boleta";
type Document = {
  id: number;
  kind: Kind | "credit_note";
  number: string;
  status: string;
  reason: string;
  issuedAt: string;
  total: number;
  hasXml: boolean;
  canDownloadPdf: boolean;
};
type Order = {
  id: number;
  externalOrderNumber: string;
  documentRequirement: string;
  requestedDocumentType?: Kind | null;
  documentDecision?: { type?: Kind | null };
};
type Action = "emit" | "reissue" | "refresh" | "pdf" | "xml";
const STATUS: Record<string, string> = {
  ACEPTADO: "Aceptado",
  RECHAZADO: "Rechazado",
  REEMPLAZADO: "Reemplazado",
  ANULADO: "Anulado",
  PENDIENTE: "Sin confirmar",
  NO_CONFIRMADO: "Sin confirmar",
  SIN_CDR: "Sin CDR",
  ENVIANDO: "Enviando",
  REVISION_MANUAL: "Revisión manual",
  NO_ENVIADA: "No enviado",
};
const STATUS_DOT: Record<string, string> = {
  ACEPTADO: "bg-emerald-500",
  RECHAZADO: "bg-rose-500",
  ANULADO: "bg-rose-500",
  ENVIANDO: "bg-sky-500",
  REEMPLAZADO: "bg-muted-foreground/50",
};
function download(base64: string, filename: string, format: "pdf" | "xml") {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: format === "pdf" ? "application/pdf" : "application/xml",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function OrderDocumentPanel({
  order,
  onUpdated,
}: {
  order: Order;
  onUpdated: () => Promise<void>;
}) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const query = useQuery<{ documents: Document[] }>({
    queryKey: ["order-documents", order.id],
    queryFn: () => api.getManagedOrder(order.id),
    refetchInterval: (q) =>
      q.state.data?.documents.some((d) => d.status === "ENVIANDO")
        ? 3000
        : false,
  });
  const documents = query.data?.documents || [];
  const active = documents.find(
    (d) =>
      d.kind !== "credit_note" &&
      !["REEMPLAZADO", "ANULADO"].includes(d.status),
  );
  const canManage = (kind: string) =>
    kind === "factura" ? can("facturas") : can("boletas");
  const mutation = useMutation({
    mutationFn: ({ action, doc }: { action: Action; doc?: Document }) =>
      api.actOnManagedOrderDocument(
        order.id,
        action,
        doc
          ? {
              kind: doc.kind === "factura" ? "factura" : "boleta",
              documentId: doc.id,
            }
          : {},
      ),
    onSuccess: async (result, { action, doc }) => {
      if (action === "pdf" || action === "xml") {
        download(
          result.base64,
          `${doc?.number || order.externalOrderNumber}.${action}`,
          action,
        );
        return;
      }
      setNote(
        result.message ||
          (result.success
            ? "Comprobante aceptado por SUNAT."
            : "Estado actualizado."),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["order-documents", order.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["managed-orders"] }),
        onUpdated(),
      ]);
    },
    onError: async (error) => {
      setNote(error.message);
      await queryClient.invalidateQueries({
        queryKey: ["order-documents", order.id],
      });
      await onUpdated();
    },
  });
  const run = (action: Action, doc?: Document) => {
    setNote("");
    mutation.mutate({ action, doc });
  };
  const busy = mutation.isPending;
  const pendingAction = busy ? mutation.variables?.action : undefined;
  const typeLabel = order.documentDecision?.type === "factura" ? "factura" : order.documentDecision?.type === "boleta" ? "boleta" : "comprobante";
  return (
    <div className="space-y-3">
      {query.isPending && (
        <div role="status" aria-label="Cargando comprobante" className="h-9 w-48 rounded-md bg-muted motion-safe:animate-pulse" />
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      {!query.isPending &&
        !query.error &&
        !active &&
        order.documentRequirement !== "disabled" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Todavía no se emite la {typeLabel}.
            </p>
            <Button
              type="button"
              size="sm"
              className="cursor-pointer"
              disabled={busy || !(can("facturas") || can("boletas"))}
              onClick={() => run("emit")}
            >
              {pendingAction === "emit" ? <Loader2 className="animate-spin" /> : <FileText />}
              Emitir comprobante
            </Button>
          </div>
        )}
      {active && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="font-mono text-sm font-medium tabular-nums">{active.number}</span>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", STATUS_DOT[active.status] || "bg-muted-foreground/50")} />
              {STATUS[active.status] || active.status}
            </span>
          </div>
          {active.status !== "ACEPTADO" && (
            <p className={cn(
              "border-l-2 pl-3 text-sm leading-5",
              active.status === "RECHAZADO" ? "border-destructive" : "border-amber-400",
            )}>
              {active.reason ||
                "No hay un motivo registrado. Consulta SUNAT para confirmar el estado."}
            </p>
          )}
          {canManage(active.kind) && (
            <div className="flex flex-wrap gap-2">
              {!["ACEPTADO", "ENVIANDO"].includes(active.status) && (
                <Button size="sm" className="cursor-pointer" disabled={busy} onClick={() => run("reissue", active)}>
                  {pendingAction === "reissue" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  Volver a emitir
                </Button>
              )}
              {active.status !== "ACEPTADO" && (
                <Button size="sm" variant="outline" className="cursor-pointer" disabled={busy} onClick={() => run("refresh", active)}>
                  {pendingAction === "refresh" && <Loader2 className="animate-spin" />}
                  Consultar SUNAT
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={busy || !active.canDownloadPdf}
                title={!active.canDownloadPdf ? "Disponible cuando SUNAT acepta el comprobante." : undefined}
                onClick={() => run("pdf", active)}
              >
                {pendingAction === "pdf" ? <Loader2 className="animate-spin" /> : <Download />}
                PDF
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={busy || !active.hasXml}
                title={!active.hasXml ? "No hay XML archivado." : undefined}
                onClick={() => run("xml", active)}
              >
                {pendingAction === "xml" ? <Loader2 className="animate-spin" /> : <Download />}
                XML
              </Button>
            </div>
          )}
          {active.status === "REVISION_MANUAL" && (
            <p className="text-xs leading-5 text-muted-foreground">
              Al volver a emitir se consulta SUNAT. Si el número pertenece a otro cliente, se usa el siguiente correlativo libre.
            </p>
          )}
        </>
      )}
      {note && (
        <p role="status" className="text-sm leading-5 text-muted-foreground">
          {note}
        </p>
      )}
      {documents.length > 1 && (
        <details className="group text-sm">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Ver comprobantes anteriores ({documents.length - 1})</span>
            <span className="hidden group-open:inline">Ocultar comprobantes anteriores</span>
          </summary>
          <ul className="mt-2 divide-y divide-border/60">
            {documents
              .filter((d) => d !== active)
              .map((d) => (
                <li
                  key={`${d.kind}-${d.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="font-mono text-[13px] tabular-nums">{d.number}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {d.kind === "credit_note" ? "Nota de crédito · " : ""}
                    {STATUS[d.status] || d.status}
                    {d.kind !== "credit_note" && canManage(d.kind) && d.hasXml && (
                      <Button size="xs" variant="ghost" className="cursor-pointer" disabled={busy} onClick={() => run("xml", d)}>
                        XML
                      </Button>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}
