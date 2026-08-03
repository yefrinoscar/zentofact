from __future__ import annotations

import calendar
import json
import math
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg2
import xlsxwriter
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "outputs" / "reporte_mensual_julio_2026_20260731"
OUTPUT_PATH = OUTPUT_DIR / "reporte_empresas_julio_2026.xlsx"
AUDIT_PATH = Path(__file__).with_name("audit.json")

PERIOD_START = date(2026, 7, 1)
PERIOD_END = date(2026, 7, 31)
PERIOD_LABEL = "Julio 2026"


def decimal_amount(value) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def status(value) -> str:
    return str(value or "").strip().upper() or "SIN ESTADO"


def fetch_data():
    env = dotenv_values(ROOT / ".env")
    connection_string = env.get("DATABASE_URL_POSTGRES") or env.get("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("No se encontró DATABASE_URL_POSTGRES ni DATABASE_URL en .env")

    with psycopg2.connect(connection_string) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, razon_social, ruc, activo
                FROM companies
                ORDER BY razon_social, id
                """
            )
            companies = [
                {
                    "id": row[0],
                    "company": row[1],
                    "ruc": row[2],
                    "active": bool(row[3]),
                }
                for row in cursor.fetchall()
            ]

            cursor.execute(
                """
                SELECT
                    b.company_id,
                    c.razon_social,
                    c.ruc,
                    b.fecha_emision,
                    'Boleta' AS document_type,
                    b.numero_completo,
                    upper(coalesce(b.estado_sunat, '')) AS sunat_status,
                    coalesce(b.moneda, 'PEN') AS currency,
                    CASE
                        WHEN coalesce(b.mto_imp_venta, '') ~ '^-?[0-9]+([.][0-9]+)?$'
                        THEN b.mto_imp_venta::numeric
                        ELSE 0
                    END AS amount,
                    coalesce(b.order_number, '') AS order_number,
                    '' AS affected_document,
                    '' AS affected_type,
                    '' AS credit_note_reason,
                    coalesce(b.metodo_envio, '') AS shipping_method
                FROM boletas b
                INNER JOIN companies c ON c.id = b.company_id
                WHERE b.fecha_emision >= %s AND b.fecha_emision <= %s

                UNION ALL

                SELECT
                    f.company_id,
                    c.razon_social,
                    c.ruc,
                    f.fecha_emision,
                    'Factura' AS document_type,
                    f.numero_completo,
                    upper(coalesce(f.estado_sunat, '')) AS sunat_status,
                    coalesce(f.moneda, 'PEN') AS currency,
                    CASE
                        WHEN coalesce(f.mto_imp_venta, '') ~ '^-?[0-9]+([.][0-9]+)?$'
                        THEN f.mto_imp_venta::numeric
                        ELSE 0
                    END AS amount,
                    coalesce(f.order_number, '') AS order_number,
                    '' AS affected_document,
                    '' AS affected_type,
                    '' AS credit_note_reason,
                    coalesce(f.metodo_envio, '') AS shipping_method
                FROM facturas f
                INNER JOIN companies c ON c.id = f.company_id
                WHERE f.fecha_emision >= %s AND f.fecha_emision <= %s

                UNION ALL

                SELECT
                    n.company_id,
                    c.razon_social,
                    c.ruc,
                    n.fecha_emision,
                    'Nota de crédito' AS document_type,
                    n.numero_completo,
                    upper(coalesce(n.estado_sunat, '')) AS sunat_status,
                    coalesce(n.moneda, 'PEN') AS currency,
                    CASE
                        WHEN coalesce(n.mto_imp_venta, '') ~ '^-?[0-9]+([.][0-9]+)?$'
                        THEN n.mto_imp_venta::numeric
                        ELSE 0
                    END AS amount,
                    '' AS order_number,
                    coalesce(n.num_doc_afectado, '') AS affected_document,
                    coalesce(n.tipo_doc_afectado, '') AS affected_type,
                    coalesce(n.des_motivo, '') AS credit_note_reason,
                    '' AS shipping_method
                FROM credit_notes n
                INNER JOIN companies c ON c.id = n.company_id
                WHERE n.fecha_emision >= %s AND n.fecha_emision <= %s

                ORDER BY 4, 2, 5, 6
                """,
                (
                    PERIOD_START.isoformat(),
                    PERIOD_END.isoformat(),
                    PERIOD_START.isoformat(),
                    PERIOD_END.isoformat(),
                    PERIOD_START.isoformat(),
                    PERIOD_END.isoformat(),
                ),
            )

            documents = []
            for row in cursor.fetchall():
                documents.append(
                    {
                        "company_id": row[0],
                        "company": row[1],
                        "ruc": row[2],
                        "issue_date": datetime.strptime(row[3], "%Y-%m-%d").date(),
                        "document_type": row[4],
                        "document_number": row[5],
                        "sunat_status": status(row[6]),
                        "currency": row[7],
                        "amount": decimal_amount(row[8]),
                        "order_number": row[9],
                        "affected_document": row[10],
                        "affected_type": row[11],
                        "credit_note_reason": row[12],
                        "shipping_method": row[13],
                    }
                )

    return companies, documents


def aggregate(companies, documents):
    by_company = {}
    for company in companies:
        by_company[company["id"]] = {
            **company,
            "boletas_total": 0,
            "boletas_accepted": 0,
            "boletas_rejected": 0,
            "boletas_other": 0,
            "boletas_amount": Decimal("0"),
            "facturas_total": 0,
            "facturas_accepted": 0,
            "facturas_rejected": 0,
            "facturas_other": 0,
            "facturas_amount": Decimal("0"),
            "notes_total": 0,
            "notes_accepted": 0,
            "notes_rejected": 0,
            "notes_other": 0,
            "notes_amount": Decimal("0"),
            "net_amount": Decimal("0"),
        }

    for document in documents:
        item = by_company[document["company_id"]]
        accepted = document["sunat_status"] == "ACEPTADO"
        rejected = document["sunat_status"] == "RECHAZADO"
        doc_type = document["document_type"]

        if doc_type == "Boleta":
            item["boletas_total"] += 1
            if accepted:
                item["boletas_accepted"] += 1
                item["boletas_amount"] += document["amount"]
            elif rejected:
                item["boletas_rejected"] += 1
            else:
                item["boletas_other"] += 1
        elif doc_type == "Factura":
            item["facturas_total"] += 1
            if accepted:
                item["facturas_accepted"] += 1
                item["facturas_amount"] += document["amount"]
            elif rejected:
                item["facturas_rejected"] += 1
            else:
                item["facturas_other"] += 1
        else:
            item["notes_total"] += 1
            if accepted:
                item["notes_accepted"] += 1
                item["notes_amount"] += document["amount"]
            elif rejected:
                item["notes_rejected"] += 1
            else:
                item["notes_other"] += 1

    for item in by_company.values():
        item["net_amount"] = (
            item["boletas_amount"] + item["facturas_amount"] - item["notes_amount"]
        )

    rows = sorted(by_company.values(), key=lambda row: (-row["net_amount"], row["company"]))
    totals = defaultdict(lambda: Decimal("0"))
    for row in rows:
        for key, value in row.items():
            if isinstance(value, (int, Decimal)) and key not in {"id"}:
                totals[key] += Decimal(value)
    totals["companies"] = len(rows)
    totals["rejected_total"] = (
        totals["boletas_rejected"]
        + totals["facturas_rejected"]
        + totals["notes_rejected"]
    )
    return rows, totals


def rgb(hex_value: str) -> str:
    return hex_value.lstrip("#")


def build_workbook(companies, documents, summary_rows, totals):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    workbook = xlsxwriter.Workbook(OUTPUT_PATH)
    workbook.set_properties(
        {
            "title": f"Reporte consolidado de empresas - {PERIOD_LABEL}",
            "subject": "Boletas, facturas, notas de crédito y ventas netas",
            "author": "ZentoFact",
            "company": "ZentoFact",
            "comments": "Generado desde la base PostgreSQL conectada al proyecto.",
        }
    )
    workbook.set_calc_mode("auto")

    colors = {
        "navy": "#172554",
        "blue": "#1D4ED8",
        "cyan": "#0891B2",
        "green": "#15803D",
        "red": "#B91C1C",
        "amber": "#B45309",
        "purple": "#7E22CE",
        "ink": "#111827",
        "muted": "#64748B",
        "line": "#CBD5E1",
        "soft": "#F1F5F9",
        "white": "#FFFFFF",
        "light_blue": "#DBEAFE",
        "light_green": "#DCFCE7",
        "light_red": "#FEE2E2",
        "light_amber": "#FEF3C7",
        "light_purple": "#F3E8FF",
    }

    title_fmt = workbook.add_format(
        {
            "font_name": "Aptos Display",
            "font_size": 22,
            "bold": True,
            "font_color": colors["white"],
            "bg_color": colors["navy"],
            "align": "left",
            "valign": "vcenter",
        }
    )
    subtitle_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "font_size": 10,
            "font_color": "#DCE7FF",
            "bg_color": colors["navy"],
            "align": "left",
            "valign": "vcenter",
        }
    )
    section_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "font_size": 12,
            "bold": True,
            "font_color": colors["navy"],
            "bottom": 2,
            "bottom_color": colors["blue"],
        }
    )
    label_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "font_size": 9,
            "bold": True,
            "font_color": colors["muted"],
            "align": "center",
            "valign": "vcenter",
            "text_wrap": True,
        }
    )
    card_value = {
        "font_name": "Aptos Display",
        "font_size": 20,
        "bold": True,
        "align": "center",
        "valign": "vcenter",
        "border": 1,
        "border_color": colors["line"],
    }
    card_styles = {
        "blue": workbook.add_format({**card_value, "font_color": colors["blue"], "bg_color": colors["light_blue"]}),
        "green": workbook.add_format({**card_value, "font_color": colors["green"], "bg_color": colors["light_green"]}),
        "red": workbook.add_format({**card_value, "font_color": colors["red"], "bg_color": colors["light_red"]}),
        "amber": workbook.add_format({**card_value, "font_color": colors["amber"], "bg_color": colors["light_amber"]}),
        "purple": workbook.add_format({**card_value, "font_color": colors["purple"], "bg_color": colors["light_purple"]}),
        "net": workbook.add_format(
            {
                **card_value,
                "font_size": 24,
                "font_color": colors["white"],
                "bg_color": colors["green"] if totals["net_amount"] >= 0 else colors["red"],
                "num_format": '"S/" #,##0.00;[Red]-"S/" #,##0.00',
            }
        ),
    }
    card_currency = {
        key: workbook.add_format(
            {
                **card_value,
                "font_color": style_color,
                "bg_color": style_bg,
                "num_format": '"S/" #,##0.00;[Red]-"S/" #,##0.00',
            }
        )
        for key, style_color, style_bg in [
            ("blue", colors["blue"], colors["light_blue"]),
            ("green", colors["green"], colors["light_green"]),
            ("red", colors["red"], colors["light_red"]),
            ("amber", colors["amber"], colors["light_amber"]),
            ("purple", colors["purple"], colors["light_purple"]),
        ]
    }
    note_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "font_size": 9,
            "font_color": colors["muted"],
            "bg_color": colors["soft"],
            "text_wrap": True,
            "valign": "vcenter",
            "border": 1,
            "border_color": colors["line"],
        }
    )
    text_fmt = workbook.add_format({"font_name": "Aptos", "font_size": 10, "font_color": colors["ink"]})
    integer_fmt = workbook.add_format(
        {"font_name": "Aptos", "font_size": 10, "font_color": colors["ink"], "num_format": "#,##0"}
    )
    money_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "font_size": 10,
            "font_color": colors["ink"],
            "num_format": '"S/" #,##0.00;[Red]-"S/" #,##0.00',
        }
    )
    total_text_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "bold": True,
            "font_color": colors["white"],
            "bg_color": colors["navy"],
            "top": 2,
            "top_color": colors["navy"],
        }
    )
    total_int_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "bold": True,
            "font_color": colors["white"],
            "bg_color": colors["navy"],
            "num_format": "#,##0",
            "top": 2,
            "top_color": colors["navy"],
        }
    )
    total_money_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "bold": True,
            "font_color": colors["white"],
            "bg_color": colors["navy"],
            "num_format": '"S/" #,##0.00;[Red]-"S/" #,##0.00',
            "top": 2,
            "top_color": colors["navy"],
        }
    )

    # Sheet 1: Dashboard.
    dashboard = workbook.add_worksheet("Dashboard")
    dashboard.hide_gridlines(2)
    dashboard.set_tab_color(colors["blue"])
    dashboard.set_zoom(70)
    dashboard.set_column("A:A", 2.5)
    dashboard.set_column("B:Q", 10)
    dashboard.set_row(0, 8)
    dashboard.set_row(1, 34)
    dashboard.set_row(2, 24)
    dashboard.merge_range("B2:Q2", f"Reporte consolidado de comprobantes — {PERIOD_LABEL}", title_fmt)

    data_cutoff = max((d["issue_date"] for d in documents), default=PERIOD_START)
    dashboard.merge_range(
        "B3:Q3",
        (
            f"Todas las empresas registradas · Periodo {PERIOD_START:%d/%m/%Y}–{PERIOD_END:%d/%m/%Y} "
            f"· Último comprobante encontrado: {data_cutoff:%d/%m/%Y}"
        ),
        subtitle_fmt,
    )
    dashboard.merge_range("B5:E5", "Empresas", label_fmt)
    dashboard.merge_range("F5:I5", "Boletas emitidas", label_fmt)
    dashboard.merge_range("J5:M5", "Facturas emitidas", label_fmt)
    dashboard.merge_range("N5:Q5", "Notas de crédito emitidas", label_fmt)
    for cell_range, formula, value, fmt in [
        (
            "B6:E7",
            f"=COUNTA('Resumen empresas'!$B$6:$B${5 + len(summary_rows)})",
            totals["companies"],
            card_styles["purple"],
        ),
        ("F6:I7", f"='Resumen empresas'!D{6 + len(summary_rows)}", totals["boletas_accepted"], card_styles["blue"]),
        ("J6:M7", f"='Resumen empresas'!I{6 + len(summary_rows)}", totals["facturas_accepted"], card_styles["green"]),
        ("N6:Q7", f"='Resumen empresas'!N{6 + len(summary_rows)}", totals["notes_accepted"], card_styles["amber"]),
    ]:
        dashboard.merge_range(cell_range, "", fmt)
        dashboard.write_formula(cell_range.split(":")[0], formula, fmt, float(value))

    dashboard.merge_range("B9:E9", "Monto de boletas emitidas", label_fmt)
    dashboard.merge_range("F9:I9", "Monto de facturas emitidas", label_fmt)
    dashboard.merge_range("J9:M9", "Monto de notas de crédito", label_fmt)
    dashboard.merge_range("N9:Q9", "TOTAL NETO DEL MES", label_fmt)
    total_row_excel = 6 + len(summary_rows)
    for cell_range, formula, value, fmt in [
        ("B10:E12", f"='Resumen empresas'!G{total_row_excel}", totals["boletas_amount"], card_currency["blue"]),
        ("F10:I12", f"='Resumen empresas'!L{total_row_excel}", totals["facturas_amount"], card_currency["green"]),
        ("J10:M12", f"='Resumen empresas'!Q{total_row_excel}", totals["notes_amount"], card_currency["amber"]),
        ("N10:Q12", f"='Resumen empresas'!R{total_row_excel}", totals["net_amount"], card_styles["net"]),
    ]:
        dashboard.merge_range(cell_range, "", fmt)
        dashboard.write_formula(cell_range.split(":")[0], formula, fmt, float(value))

    dashboard.merge_range(
        "B14:Q14",
        "Total neto = monto de boletas ACEPTADAS + monto de facturas ACEPTADAS − monto de notas de crédito ACEPTADAS.",
        note_fmt,
    )

    # Sheet 2: Summary, created before dashboard chart references are finalized.
    summary = workbook.add_worksheet("Resumen empresas")
    summary.hide_gridlines(2)
    summary.set_tab_color(colors["green"])
    summary.set_zoom(65)
    summary.freeze_panes(5, 2)
    summary.set_landscape()
    summary.fit_to_pages(1, 1)
    summary.set_margins(0.25, 0.25, 0.4, 0.4)
    summary.merge_range("A1:R1", f"Resumen por empresa — {PERIOD_LABEL}", title_fmt)
    summary.merge_range(
        "A2:R2",
        (
            "Emitidas = estado SUNAT ACEPTADO. Rechazadas = estado SUNAT RECHAZADO. "
            "Otros = anuladas, pendientes, reemplazadas o cualquier otro estado."
        ),
        subtitle_fmt,
    )
    summary.merge_range(
        "A3:R3",
        "Los importes solo consideran comprobantes aceptados y se expresan en soles (PEN).",
        note_fmt,
    )

    headers = [
        "Empresa",
        "RUC",
        "Boletas\n(total)",
        "Boletas\nemitidas",
        "Boletas\nrechazadas",
        "Boletas\notros",
        "Monto boletas\nemitidas",
        "Facturas\n(total)",
        "Facturas\nemitidas",
        "Facturas\nrechazadas",
        "Facturas\notros",
        "Monto facturas\nemitidas",
        "Notas crédito\n(total)",
        "Notas crédito\nemitidas",
        "Notas crédito\nrechazadas",
        "Notas crédito\notros",
        "Monto notas de\ncrédito",
        "TOTAL NETO\nDEL MES",
    ]
    header_fmt = workbook.add_format(
        {
            "font_name": "Aptos",
            "font_size": 9,
            "bold": True,
            "font_color": colors["white"],
            "bg_color": colors["blue"],
            "align": "center",
            "valign": "vcenter",
            "text_wrap": True,
            "border": 1,
            "border_color": colors["white"],
        }
    )
    summary.set_row(4, 42)
    for column, header in enumerate(headers):
        summary.write(4, column, header, header_fmt)

    detail_start_excel = 6
    detail_end_excel = 5 + len(documents)
    summary_start_excel = 6
    for offset, row in enumerate(summary_rows):
        excel_row = summary_start_excel + offset
        worksheet_row = excel_row - 1
        summary.write(worksheet_row, 0, row["company"], text_fmt)
        summary.write_string(worksheet_row, 1, row["ruc"], text_fmt)

        ruc_ref = f"$B{excel_row}"
        source_ruc = f"'Detalle documentos'!$D${detail_start_excel}:$D${detail_end_excel}"
        source_type = f"'Detalle documentos'!$B${detail_start_excel}:$B${detail_end_excel}"
        source_status = f"'Detalle documentos'!$F${detail_start_excel}:$F${detail_end_excel}"
        source_amount = f"'Detalle documentos'!$H${detail_start_excel}:$H${detail_end_excel}"

        formula_values = [
            (f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Boleta")', row["boletas_total"]),
            (
                f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Boleta",{source_status},"ACEPTADO")',
                row["boletas_accepted"],
            ),
            (
                f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Boleta",{source_status},"RECHAZADO")',
                row["boletas_rejected"],
            ),
            (f"=C{excel_row}-D{excel_row}-E{excel_row}", row["boletas_other"]),
            (
                f'=SUMIFS({source_amount},{source_ruc},{ruc_ref},{source_type},"Boleta",{source_status},"ACEPTADO")',
                row["boletas_amount"],
            ),
            (f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Factura")', row["facturas_total"]),
            (
                f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Factura",{source_status},"ACEPTADO")',
                row["facturas_accepted"],
            ),
            (
                f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Factura",{source_status},"RECHAZADO")',
                row["facturas_rejected"],
            ),
            (f"=H{excel_row}-I{excel_row}-J{excel_row}", row["facturas_other"]),
            (
                f'=SUMIFS({source_amount},{source_ruc},{ruc_ref},{source_type},"Factura",{source_status},"ACEPTADO")',
                row["facturas_amount"],
            ),
            (f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Nota de crédito")', row["notes_total"]),
            (
                f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Nota de crédito",{source_status},"ACEPTADO")',
                row["notes_accepted"],
            ),
            (
                f'=COUNTIFS({source_ruc},{ruc_ref},{source_type},"Nota de crédito",{source_status},"RECHAZADO")',
                row["notes_rejected"],
            ),
            (f"=M{excel_row}-N{excel_row}-O{excel_row}", row["notes_other"]),
            (
                f'=SUMIFS({source_amount},{source_ruc},{ruc_ref},{source_type},"Nota de crédito",{source_status},"ACEPTADO")',
                row["notes_amount"],
            ),
            (f"=G{excel_row}+L{excel_row}-Q{excel_row}", row["net_amount"]),
        ]
        for idx, (formula, value) in enumerate(formula_values, start=2):
            fmt = money_fmt if idx in {6, 11, 16, 17} else integer_fmt
            summary.write_formula(worksheet_row, idx, formula, fmt, float(value))

    total_excel_row = summary_start_excel + len(summary_rows)
    total_ws_row = total_excel_row - 1
    summary.write(total_ws_row, 0, "TOTAL DEL MES", total_text_fmt)
    summary.write(total_ws_row, 1, "", total_text_fmt)
    for column in range(2, 18):
        column_letter = xlsxwriter.utility.xl_col_to_name(column)
        cached_key = {
            2: "boletas_total",
            3: "boletas_accepted",
            4: "boletas_rejected",
            5: "boletas_other",
            6: "boletas_amount",
            7: "facturas_total",
            8: "facturas_accepted",
            9: "facturas_rejected",
            10: "facturas_other",
            11: "facturas_amount",
            12: "notes_total",
            13: "notes_accepted",
            14: "notes_rejected",
            15: "notes_other",
            16: "notes_amount",
            17: "net_amount",
        }[column]
        fmt = total_money_fmt if column in {6, 11, 16, 17} else total_int_fmt
        summary.write_formula(
            total_ws_row,
            column,
            f"=SUM({column_letter}{summary_start_excel}:{column_letter}{total_excel_row - 1})",
            fmt,
            float(totals[cached_key]),
        )

    summary.set_column("A:A", 34)
    summary.set_column("B:B", 14)
    summary.set_column("C:F", 11)
    summary.set_column("G:G", 16)
    summary.set_column("H:K", 11)
    summary.set_column("L:L", 16)
    summary.set_column("M:P", 12)
    summary.set_column("Q:R", 17)
    summary.autofilter(4, 0, total_ws_row - 1, 17)
    summary.conditional_format(
        5,
        17,
        total_ws_row - 1,
        17,
        {
            "type": "3_color_scale",
            "min_color": colors["light_red"],
            "mid_color": colors["light_amber"],
            "max_color": colors["light_green"],
        },
    )
    summary.conditional_format(
        5,
        4,
        total_ws_row - 1,
        4,
        {"type": "cell", "criteria": ">", "value": 0, "format": workbook.add_format({"bg_color": colors["light_red"], "font_color": colors["red"], "bold": True})},
    )
    summary.set_header("&LZentoFact&CReporte mensual&R&P de &N")
    summary.set_footer(f"&L{PERIOD_LABEL}&CConfidencial&RGenerado {date.today():%d/%m/%Y}")

    # Chart: net amount by company.
    chart = workbook.add_chart({"type": "bar"})
    chart.add_series(
        {
            "name": "Total neto",
            "categories": ["Resumen empresas", 5, 0, 4 + len(summary_rows), 0],
            "values": ["Resumen empresas", 5, 17, 4 + len(summary_rows), 17],
            "fill": {"color": colors["blue"]},
            "border": {"none": True},
            "data_labels": {"value": True, "num_format": '"S/" #,##0'},
        }
    )
    chart.set_title({"name": "Total neto por empresa (S/)"})
    chart.set_x_axis({"num_format": '"S/" #,##0', "major_gridlines": {"visible": True, "line": {"color": colors["line"]}}})
    chart.set_y_axis({"label_position": "low"})
    chart.set_legend({"none": True})
    chart.set_chartarea({"border": {"none": True}, "fill": {"color": colors["white"]}})
    chart.set_plotarea({"border": {"none": True}, "fill": {"color": colors["white"]}})
    chart.set_style(10)
    dashboard.insert_chart("B16", chart, {"x_scale": 1.48, "y_scale": 1.42})

    dashboard.write("N16", "Control del periodo", section_fmt)
    control_rows = [
        ("Boletas totales", totals["boletas_total"]),
        ("Boletas rechazadas", totals["boletas_rejected"]),
        ("Boletas otros estados", totals["boletas_other"]),
        ("Facturas totales", totals["facturas_total"]),
        ("Facturas rechazadas", totals["facturas_rejected"]),
        ("NC totales", totals["notes_total"]),
        ("NC rechazadas", totals["notes_rejected"]),
    ]
    for idx, (label, value) in enumerate(control_rows, start=17):
        dashboard.merge_range(idx - 1, 13, idx - 1, 15, label, text_fmt)
        dashboard.write_number(idx - 1, 16, float(value), integer_fmt)
    dashboard.merge_range(
        "N26:Q29",
        (
            "Importante: una boleta anulada forma parte del total de boletas, pero no del monto emitido. "
            "Por eso el total de documentos puede no coincidir con emitidos + rechazados."
        ),
        note_fmt,
    )
    dashboard.print_area("B2:Q32")
    dashboard.set_landscape()
    dashboard.fit_to_pages(1, 1)

    # Sheet 3: document detail.
    detail = workbook.add_worksheet("Detalle documentos")
    detail.hide_gridlines(2)
    detail.set_tab_color(colors["amber"])
    detail.set_zoom(70)
    detail.freeze_panes(5, 4)
    detail.set_landscape()
    detail.fit_to_pages(1, 0)
    detail.merge_range("A1:N1", f"Detalle de comprobantes — {PERIOD_LABEL}", title_fmt)
    detail.merge_range(
        "A2:N2",
        (
            f"Fuente: tablas boletas, facturas y credit_notes de la base PostgreSQL. "
            f"Periodo filtrado: {PERIOD_START:%d/%m/%Y}–{PERIOD_END:%d/%m/%Y}."
        ),
        subtitle_fmt,
    )
    detail.merge_range(
        "A3:N3",
        "Los montos son el importe total del comprobante (mto_imp_venta). Use los filtros para revisar empresa, tipo o estado.",
        note_fmt,
    )
    detail_headers = [
        "Fecha emisión",
        "Tipo",
        "Empresa",
        "RUC",
        "N.º comprobante",
        "Estado SUNAT",
        "Moneda",
        "Importe total",
        "N.º orden",
        "Documento afectado",
        "Tipo doc. afectado",
        "Motivo nota de crédito",
        "Método de envío",
        "ID empresa",
    ]
    date_fmt = workbook.add_format({"font_name": "Aptos", "font_size": 10, "num_format": "dd/mm/yyyy"})
    status_formats = {
        "ACEPTADO": workbook.add_format({"bg_color": colors["light_green"], "font_color": colors["green"], "bold": True}),
        "RECHAZADO": workbook.add_format({"bg_color": colors["light_red"], "font_color": colors["red"], "bold": True}),
        "ANULADO": workbook.add_format({"bg_color": colors["soft"], "font_color": colors["muted"], "bold": True}),
    }
    detail_data_start = 5
    for row_idx, document in enumerate(documents, start=detail_data_start):
        detail.write_datetime(row_idx, 0, datetime.combine(document["issue_date"], datetime.min.time()), date_fmt)
        detail.write(row_idx, 1, document["document_type"], text_fmt)
        detail.write(row_idx, 2, document["company"], text_fmt)
        detail.write_string(row_idx, 3, document["ruc"], text_fmt)
        detail.write(row_idx, 4, document["document_number"], text_fmt)
        detail.write(row_idx, 5, document["sunat_status"], text_fmt)
        detail.write(row_idx, 6, document["currency"], text_fmt)
        detail.write_number(row_idx, 7, float(document["amount"]), money_fmt)
        detail.write_string(row_idx, 8, str(document["order_number"] or ""), text_fmt)
        detail.write(row_idx, 9, document["affected_document"], text_fmt)
        detail.write(row_idx, 10, document["affected_type"], text_fmt)
        detail.write(row_idx, 11, document["credit_note_reason"], text_fmt)
        detail.write(row_idx, 12, document["shipping_method"], text_fmt)
        detail.write_number(row_idx, 13, document["company_id"], integer_fmt)

    table_last_row = detail_data_start + len(documents)
    detail.add_table(
        4,
        0,
        table_last_row - 1,
        len(detail_headers) - 1,
        {
            "name": "DetalleComprobantes",
            "style": "Table Style Medium 2",
            "columns": [{"header": header} for header in detail_headers],
        },
    )
    detail.set_row(4, 34)
    detail.set_column("A:A", 13)
    detail.set_column("B:B", 17)
    detail.set_column("C:C", 34)
    detail.set_column("D:D", 14)
    detail.set_column("E:E", 19)
    detail.set_column("F:F", 15)
    detail.set_column("G:G", 9)
    detail.set_column("H:H", 15)
    detail.set_column("I:I", 17)
    detail.set_column("J:J", 20)
    detail.set_column("K:K", 17)
    detail.set_column("L:L", 32)
    detail.set_column("M:M", 16)
    detail.set_column("N:N", 10, None, {"hidden": True})
    for current_status, fmt in status_formats.items():
        detail.conditional_format(
            detail_data_start,
            5,
            table_last_row - 1,
            5,
            {"type": "text", "criteria": "containing", "value": current_status, "format": fmt},
        )
    detail.set_header("&LZentoFact&CDetalle de comprobantes&R&P de &N")
    detail.set_footer(f"&L{PERIOD_LABEL}&CConfidencial&RGenerado {date.today():%d/%m/%Y}")

    # Sheet 4: methodology and checks.
    methodology = workbook.add_worksheet("Metodología")
    methodology.hide_gridlines(2)
    methodology.set_tab_color(colors["purple"])
    methodology.set_zoom(95)
    methodology.set_column("A:A", 3)
    methodology.set_column("B:B", 27)
    methodology.set_column("C:F", 19)
    methodology.merge_range("B2:F2", "Metodología y controles", title_fmt)
    methodology.merge_range(
        "B3:F3",
        f"Reporte consolidado para {PERIOD_LABEL}. Fecha de generación: {date.today():%d/%m/%Y}.",
        subtitle_fmt,
    )
    methodology.write("B5", "Definiciones", section_fmt)
    definitions = [
        ("Empresa incluida", "Toda empresa registrada en la tabla companies, incluso si no tuvo movimientos en el mes."),
        ("Documento emitido", "Comprobante cuyo estado SUNAT es ACEPTADO."),
        ("Documento rechazado", "Comprobante cuyo estado SUNAT es RECHAZADO."),
        ("Otros estados", "ANULADO, PENDIENTE, REEMPLAZADO, sin estado u otro valor distinto de ACEPTADO/RECHAZADO."),
        ("Monto de boletas/facturas", "Suma de mto_imp_venta únicamente para documentos ACEPTADOS."),
        ("Monto de notas de crédito", "Suma de mto_imp_venta únicamente para notas de crédito ACEPTADAS."),
        ("Total neto mensual", "Monto de boletas aceptadas + monto de facturas aceptadas − monto de notas de crédito aceptadas."),
    ]
    for idx, (term, definition) in enumerate(definitions, start=6):
        methodology.write(idx - 1, 1, term, workbook.add_format({"bold": True, "font_color": colors["navy"], "valign": "top"}))
        methodology.merge_range(idx - 1, 2, idx - 1, 5, definition, note_fmt)
        methodology.set_row(idx - 1, 32)

    methodology.write("B15", "Controles de conciliación", section_fmt)
    checks = [
        ("Boletas: total = emitidas + rechazadas + otros", totals["boletas_total"], totals["boletas_accepted"] + totals["boletas_rejected"] + totals["boletas_other"]),
        ("Facturas: total = emitidas + rechazadas + otros", totals["facturas_total"], totals["facturas_accepted"] + totals["facturas_rejected"] + totals["facturas_other"]),
        ("Notas de crédito: total = emitidas + rechazadas + otros", totals["notes_total"], totals["notes_accepted"] + totals["notes_rejected"] + totals["notes_other"]),
        ("Total neto recalculado", totals["net_amount"], totals["boletas_amount"] + totals["facturas_amount"] - totals["notes_amount"]),
    ]
    methodology.write_row("B16", ["Control", "Valor reportado", "Valor recalculado", "Resultado"], header_fmt)
    for idx, (name, reported, recalculated) in enumerate(checks, start=17):
        methodology.write(idx - 1, 1, name, text_fmt)
        value_fmt = money_fmt if "neto" in name.lower() else integer_fmt
        methodology.write_number(idx - 1, 2, float(reported), value_fmt)
        methodology.write_number(idx - 1, 3, float(recalculated), value_fmt)
        result = "OK" if reported == recalculated else "REVISAR"
        methodology.write(
            idx - 1,
            4,
            result,
            workbook.add_format(
                {
                    "bold": True,
                    "font_color": colors["green"] if result == "OK" else colors["red"],
                    "bg_color": colors["light_green"] if result == "OK" else colors["light_red"],
                    "align": "center",
                }
            ),
        )

    methodology.write("B23", "Fuente de datos", section_fmt)
    source_rows = [
        ("Base", "PostgreSQL configurada mediante DATABASE_URL_POSTGRES/DATABASE_URL del proyecto."),
        ("Tablas", "companies, boletas, facturas y credit_notes."),
        ("Rango", f"{PERIOD_START:%d/%m/%Y} al {PERIOD_END:%d/%m/%Y}."),
        ("Moneda", "PEN. El reporte no realiza conversión de moneda."),
    ]
    for idx, (label, value) in enumerate(source_rows, start=24):
        methodology.write(idx - 1, 1, label, workbook.add_format({"bold": True, "font_color": colors["navy"]}))
        methodology.merge_range(idx - 1, 2, idx - 1, 5, value, note_fmt)
        methodology.set_row(idx - 1, 28)

    workbook.close()

    audit = {
        "output": str(OUTPUT_PATH),
        "period": {"start": PERIOD_START.isoformat(), "end": PERIOD_END.isoformat()},
        "data_cutoff": data_cutoff.isoformat(),
        "companies": len(companies),
        "documents": len(documents),
        "currencies": sorted({d["currency"] for d in documents}),
        "totals": {key: float(value) if isinstance(value, Decimal) else value for key, value in totals.items()},
    }
    AUDIT_PATH.write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")
    return audit


def main():
    companies, documents = fetch_data()
    summary_rows, totals = aggregate(companies, documents)
    if any(document["currency"] != "PEN" for document in documents):
        raise RuntimeError("El periodo contiene monedas distintas de PEN; se requiere conversión antes de consolidar.")
    audit = build_workbook(companies, documents, summary_rows, totals)
    print(json.dumps(audit, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
