"""
pdf_generator.py — Gerador de PDF do CYMAG Enterprise.
Usa fpdf2 (pip install fpdf2).

Modos:
  - Rápido:   estrutura padrão gerada em < 1s
  - Detalhado: narrativa gerada pelo AEGIS + estrutura customizável
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger("cymag.pdf")

try:
    from fpdf import FPDF
    FPDF_AVAILABLE = True
except ImportError:
    FPDF_AVAILABLE = False
    logger.warning("[PDF] fpdf2 não instalado. Execute: pip install fpdf2")


# ─── CONSTANTES DE COR ───────────────────────────────────────────────────────
C_DARK   = (7,   12,  20)
C_SURF   = (13,  23,  36)
C_BLUE   = (82,  201, 255)
C_GREEN  = (70,  223, 161)
C_RED    = (255, 104, 114)
C_YELLOW = (245, 166, 35)
C_MUTED  = (100, 120, 140)
C_WHITE  = (255, 255, 255)
C_LIGHT  = (235, 240, 248)

SEV_LABEL = {"crit": "CRITICO", "high": "ALTO", "med": "MEDIO", "low": "BAIXO", "info": "INFO"}
SEV_COLOR = {"crit": C_RED, "high": C_YELLOW, "med": C_BLUE, "low": C_GREEN, "info": C_MUTED}


# ─── CLASSE BASE DO PDF ───────────────────────────────────────────────────────
class CYMAGReport(FPDF):
    """FPDF com header/footer padrão CYMAG."""

    def __init__(self, target: str = ""):
        super().__init__()
        self._target  = target
        self._page_no_offset = 0

    def header(self):
        # Barra de topo escura
        self.set_fill_color(*C_DARK)
        self.rect(0, 0, 210, 16, 'F')
        # Logo texto
        self.set_text_color(*C_BLUE)
        self.set_font("Helvetica", "B", 9)
        self.set_xy(10, 4)
        self.cell(80, 8, "CYMAG ENTERPRISE")
        # Alvo no centro
        self.set_text_color(*C_MUTED)
        self.set_font("Helvetica", "", 7.5)
        self.set_xy(90, 4)
        self.cell(30, 8, f"Alvo: {self._target[:35]}", align="C")
        # Data à direita
        self.set_xy(150, 4)
        self.cell(50, 8, datetime.now().strftime("%d/%m/%Y  %H:%M"), align="R")
        self.ln(14)

    def footer(self):
        self.set_y(-13)
        self.set_draw_color(*C_BLUE)
        self.set_line_width(0.4)
        self.line(10, self.get_y(), 200, self.get_y())
        self.set_line_width(0.2)
        self.set_draw_color(0, 0, 0)
        self.set_font("Helvetica", "I", 7.5)
        self.set_text_color(*C_MUTED)
        self.set_y(-11)
        self.cell(0, 5, f"Confidencial  ·  CYMAG Enterprise v2.0  ·  Página {self.page_no()}", align="C")


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def _section_title(pdf: FPDF, title: str, subtitle: str = ""):
    """Título de seção com linha azul."""
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(*C_DARK)
    pdf.cell(0, 8, title, ln=True)
    if subtitle:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*C_MUTED)
        pdf.cell(0, 5, subtitle, ln=True)
    pdf.set_draw_color(*C_BLUE)
    pdf.set_line_width(0.5)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.set_draw_color(0, 0, 0)
    pdf.ln(5)

def _score_color(score: int):
    if score > 70: return C_RED
    if score > 40: return C_YELLOW
    return C_GREEN

def _sev_color(sev: str):
    return SEV_COLOR.get(sev, C_MUTED)

def _safe(text: str, max_len: int = 200) -> str:
    """Remove caracteres não-latin1 e trunca."""
    if not text:
        return ""
    cleaned = text.encode("latin-1", errors="replace").decode("latin-1")
    return cleaned[:max_len] if len(cleaned) > max_len else cleaned


# ─── CAPA ─────────────────────────────────────────────────────────────────────

def _build_cover(pdf: CYMAGReport, target: str, findings: list, score: int):
    pdf.add_page()

    # Bloco escuro de fundo da capa
    pdf.set_fill_color(*C_DARK)
    pdf.rect(0, 14, 210, 55, 'F')

    # Título
    pdf.set_xy(10, 20)
    pdf.set_text_color(*C_BLUE)
    pdf.set_font("Helvetica", "B", 26)
    pdf.cell(0, 12, "CYMAG Enterprise", ln=True)

    pdf.set_x(10)
    pdf.set_text_color(*C_WHITE)
    pdf.set_font("Helvetica", "", 16)
    pdf.cell(0, 9, "Relatorio de Seguranca da Informacao", ln=True)

    pdf.set_x(10)
    pdf.set_text_color(*C_MUTED)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 7, f"Gerado em: {datetime.now().strftime('%d de %B de %Y, %H:%M')}", ln=True)

    pdf.ln(18)

    # Cards de resumo
    crits   = sum(1 for f in findings if f.get("sev") == "crit")
    highs   = sum(1 for f in findings if f.get("sev") == "high")
    hosts   = len(set(f.get("host","") for f in findings))
    sc_col  = _score_color(score)

    cards = [
        ("SCORE DE RISCO",         str(score) + "/100", sc_col),
        ("VULNERABILIDADES",       str(len(findings)),   C_WHITE),
        ("CRITICAS",               str(crits),           C_RED if crits else C_GREEN),
        ("ALTAS",                  str(highs),           C_YELLOW if highs else C_GREEN),
        ("HOSTS AFETADOS",         str(hosts),           C_BLUE),
    ]

    card_w = 36
    x_start = 10
    y_card = pdf.get_y()

    for i, (label, value, color) in enumerate(cards):
        x = x_start + i * (card_w + 2)
        pdf.set_fill_color(*C_SURF)
        pdf.rect(x, y_card, card_w, 22, 'F')
        pdf.set_xy(x, y_card + 3)
        pdf.set_text_color(*color)
        pdf.set_font("Helvetica", "B", 14)
        pdf.cell(card_w, 8, value, align="C")
        pdf.set_xy(x, y_card + 13)
        pdf.set_text_color(*C_MUTED)
        pdf.set_font("Helvetica", "", 6)
        pdf.cell(card_w, 5, label, align="C")

    pdf.set_y(y_card + 28)

    # Alvo
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*C_MUTED)
    pdf.cell(40, 7, "Alvo escaneado:")
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(*C_DARK)
    pdf.cell(0, 7, _safe(target), ln=True)

    pdf.ln(3)


# ─── TABELA DE VULNERABILIDADES ───────────────────────────────────────────────

def _build_vulns_table(pdf: FPDF, findings: list):
    _section_title(pdf, "Vulnerabilidades Tecnicas",
                   f"Total: {len(findings)} | "
                   f"Criticas: {sum(1 for f in findings if f.get('sev')=='crit')} | "
                   f"Altas: {sum(1 for f in findings if f.get('sev')=='high')}")

    if not findings:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*C_MUTED)
        pdf.cell(0, 8, "Nenhuma vulnerabilidade encontrada.", ln=True)
        pdf.ln(4)
        return

    # Cabeçalho da tabela
    cols = [28, 36, 68, 22, 14, 22]  # total = 190
    hdrs = ["CVE / ID", "ATIVO", "DESCRICAO", "SEVERIDADE", "CVSS", "STATUS"]

    pdf.set_fill_color(*C_DARK)
    pdf.set_text_color(*C_WHITE)
    pdf.set_font("Helvetica", "B", 7.5)
    for w, h in zip(cols, hdrs):
        pdf.cell(w, 7, h, border=1, fill=True, align="C")
    pdf.ln()

    # Linhas
    pdf.set_font("Helvetica", "", 7.5)
    for i, v in enumerate(findings):
        # Verificar espaço
        if pdf.get_y() > 265:
            pdf.add_page()

        bg = (248, 250, 255) if i % 2 == 0 else C_WHITE
        pdf.set_fill_color(*bg)
        sev    = v.get("sev", "low")
        sc_col = _sev_color(sev)

        row = [
            _safe(v.get("cve") or f"CYM-{str(i+1).zfill(3)}", 26),
            _safe(f"{v.get('host','?')}:{v.get('port','?')}", 34),
            _safe(v.get("title",""), 62),
            SEV_LABEL.get(sev, "N/A"),
            str(v.get("cvss","N/A")),
            "ABERTA",
        ]

        for j, (w, cell) in enumerate(zip(cols, row)):
            if j == 3:
                pdf.set_text_color(*sc_col)
            else:
                pdf.set_text_color(*C_DARK)
            pdf.cell(w, 6, cell, border=1, fill=True, align="C" if j > 1 else "L")
        pdf.ln()

    pdf.ln(6)


# ─── TABELA DE RISCOS EXECUTIVOS ──────────────────────────────────────────────

def _build_exec_table(pdf: FPDF, exec_risks: list):
    _section_title(pdf, "Riscos de Negocio",
                   "Impacto financeiro e regulatorio estimado pelo AEGIS")

    if not exec_risks:
        pdf.set_font("Helvetica", "I", 9)
        pdf.set_text_color(*C_MUTED)
        pdf.cell(0, 8, "Nenhum risco executivo processado.", ln=True)
        pdf.ln(4)
        return

    for r in exec_risks:
        if pdf.get_y() > 265:
            pdf.add_page()

        risk   = _safe(r.get("risk","N/A"), 80)
        cat    = _safe(r.get("category") or r.get("cat","N/A"), 30)
        prob   = _safe(r.get("probability") or r.get("prob","N/A"), 20)
        impact = _safe(r.get("impact","N/A"), 20)

        # Nome do risco
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*C_DARK)
        pdf.cell(5, 6, "")  # indent
        pdf.cell(0, 6, f"* {risk}", ln=True)

        # Detalhes em linha
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(*C_MUTED)
        pdf.cell(10, 5, "")
        pdf.cell(0, 5,
                 f"Categoria: {cat}  |  Probabilidade: {prob}  |  Impacto estimado: {impact}",
                 ln=True)
        pdf.ln(1)

    pdf.ln(5)


# ─── NARRATIVA DA IA (modo detalhado) ────────────────────────────────────────

def _build_narrative(pdf: FPDF, narrative: dict):
    """Insere seções de texto geradas pelo AEGIS."""

    def _text_section(title: str, key: str):
        content = narrative.get(key, "")
        if not content:
            return
        if pdf.get_y() > 240:
            pdf.add_page()
        _section_title(pdf, title)
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 50)
        pdf.multi_cell(0, 6, _safe(content, 2000))
        pdf.ln(5)

    _text_section("Sumario Executivo",         "executive_summary")
    _text_section("Visao Geral de Riscos",     "risk_overview")

    # Achados críticos (lista)
    crits = narrative.get("critical_findings", [])
    if crits:
        if pdf.get_y() > 230:
            pdf.add_page()
        _section_title(pdf, "Analise de Achados Criticos")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 50)
        for i, c in enumerate(crits, 1):
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(0, 6, f"{i}. Achado Critico", ln=True)
            pdf.set_font("Helvetica", "", 10)
            pdf.multi_cell(0, 6, _safe(str(c), 1000))
            pdf.ln(2)
        pdf.ln(3)

    # Recomendações
    recs = narrative.get("recommendations", [])
    if recs:
        if pdf.get_y() > 230:
            pdf.add_page()
        _section_title(pdf, "Recomendacoes Prioritarias")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(30, 30, 50)
        for i, rec in enumerate(recs, 1):
            pdf.cell(8, 6, f"{i}.", align="R")
            pdf.multi_cell(0, 6, _safe(str(rec), 500))
        pdf.ln(3)

    _text_section("Conclusao e Proximos Passos", "conclusion")


# ─── PONTO DE ENTRADA PÚBLICO ────────────────────────────────────────────────

def build_quick_pdf(target: str, findings: list, exec_risks: list, score: int) -> bytes:
    """Gera PDF rápido padrão. Retorna bytes do PDF."""
    if not FPDF_AVAILABLE:
        raise RuntimeError("fpdf2 não instalado. Execute: pip install fpdf2")

    pdf = CYMAGReport(target)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(10, 18, 10)

    _build_cover(pdf, target, findings, score)
    pdf.add_page()
    _build_vulns_table(pdf, findings)
    _build_exec_table(pdf, exec_risks)

    return bytes(pdf.output())


def build_detailed_pdf(
    target: str,
    findings: list,
    exec_risks: list,
    score: int,
    narrative: Optional[Dict] = None
) -> bytes:
    """Gera PDF detalhado com narrativa do AEGIS. Retorna bytes do PDF."""
    if not FPDF_AVAILABLE:
        raise RuntimeError("fpdf2 não instalado. Execute: pip install fpdf2")

    pdf = CYMAGReport(target)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(10, 18, 10)

    _build_cover(pdf, target, findings, score)
    pdf.add_page()

    # Narrativa da IA vem primeiro (sumário executivo antes das tabelas técnicas)
    if narrative:
        _build_narrative(pdf, narrative)
        if pdf.get_y() > 200:
            pdf.add_page()

    _build_vulns_table(pdf, findings)
    _build_exec_table(pdf, exec_risks)

    return bytes(pdf.output())
