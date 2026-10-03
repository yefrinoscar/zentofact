import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, RefreshCw } from "lucide-react";
import api from "../lib/api";
import { usePermissions } from "../hooks/usePermissions";

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
  return (
    <section className="order-document-panel border-t border-border px-5 py-5">
      <h3 className="mb-3 text-sm font-semibold">Comprobante</h3>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      {note && (
        <p role="status" className="mb-3 text-sm leading-5">
          {note}
        </p>
      )}
      {!query.isPending &&
        !query.error &&
        !active &&
        order.documentRequirement !== "disabled" && (
          <button
            type="button"
            className="daisy-btn daisy-btn-sm"
            disabled={busy || !(can("facturas") || can("boletas"))}
            onClick={() => run("emit")}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileText className="size-4" />
            )}
            Emitir comprobante
          </button>
        )}
      {active && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">{active.number}</span>
            <span
              className={
                active.status === "RECHAZADO"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {STATUS[active.status] || active.status}
            </span>
          </div>
          {active.status !== "ACEPTADO" && (
            <p className="border-l-2 border-destructive pl-3 text-sm leading-5">
              {active.reason ||
                "No hay un motivo registrado. Consulta SUNAT para confirmar el estado."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {canManage(active.kind) && (
              <>
                {!["ACEPTADO", "REVISION_MANUAL", "ENVIANDO"].includes(
                  active.status,
                ) && (
                  <button
                    className="daisy-btn daisy-btn-sm"
                    disabled={busy}
                    onClick={() => run("reissue", active)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Volver a emitir
                  </button>
                )}
                {active.status !== "ACEPTADO" && (
                  <button
                    className="daisy-btn daisy-btn-sm daisy-btn-outline"
                    disabled={busy}
                    onClick={() => run("refresh", active)}
                  >
                    Consultar SUNAT
                  </button>
                )}
                <button
                  className="daisy-btn daisy-btn-sm daisy-btn-outline"
                  disabled={busy || !active.canDownloadPdf}
                  title={
                    !active.canDownloadPdf
                      ? "Disponible cuando SUNAT acepta el comprobante."
                      : undefined
                  }
                  onClick={() => run("pdf", active)}
                >
                  <Download className="size-4" />
                  PDF
                </button>
                <button
                  className="daisy-btn daisy-btn-sm daisy-btn-outline"
                  disabled={busy || !active.hasXml}
                  title={!active.hasXml ? "No hay XML archivado." : undefined}
                  onClick={() => run("xml", active)}
                >
                  XML
                </button>
              </>
            )}
          </div>
          {active.status === "REVISION_MANUAL" && (
            <p className="text-xs text-muted-foreground">
              Requiere revisión manual antes de emitir otro comprobante.
            </p>
          )}
        </div>
      )}
      {documents.length > 1 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Comprobantes anteriores
          </summary>
          {documents
            .filter((d) => d !== active)
            .map((d) => (
              <div
                key={`${d.kind}-${d.id}`}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
              >
                <span>
                  {d.number} · {STATUS[d.status] || d.status}
                </span>
                {d.kind !== "credit_note" && canManage(d.kind) && d.hasXml && (
                  <button
                    className="daisy-btn daisy-btn-xs daisy-btn-ghost"
                    disabled={busy}
                    onClick={() => run("xml", d)}
                  >
                    XML
                  </button>
                )}
              </div>
            ))}
        </details>
      )}
    </section>
  );
}
