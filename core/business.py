"""
Tradução de achados técnicos para linguagem de NEGÓCIO (determinística, sem IA).

Serve à visão do DONO (role 'owner') — alguém que não entende de cibersegurança
e precisa de um resumo do tipo: "que problema é esse, quanto me custa se eu não
consertar, quanto custa consertar e o que precisa mudar".

É de propósito agnóstico de framework e SEM IA: os números e textos vêm de
faixas fixas por ÁREA e SEVERIDADE. É a base gratuita (só Python). A IA (AEGIS),
quando o plano tem, entra por cima com narrativa sob medida — mas o dono nunca
fica sem um resumo, mesmo offline.

⚠️ Os valores em reais são ESTIMATIVAS de ordem de grandeza para priorização,
não uma perícia contábil. Rotule sempre como estimativa na interface.
"""

from typing import Dict, List, Optional, Tuple

# ─── Faixas por área do pentester ──────────────────────────────────────────────
# loss  = prejuízo estimado se o problema NÃO for corrigido (BRL: min, max)
# fix   = custo estimado para corrigir (BRL: min, max)
_AREA: Dict[str, Dict] = {
    "database": {
        "label": "Banco de dados exposto",
        "problem": ("Um banco de dados da empresa está acessível pela rede sem a "
                    "proteção adequada — é onde costumam ficar dados de clientes, "
                    "financeiro e operação."),
        "fix": ("Fechar o acesso do banco para fora, exigir senha forte e aplicar "
                "as atualizações do fabricante."),
        "loss": (200_000, 6_200_000),
        "fix_cost": (4_000, 18_000),
    },
    "web": {
        "label": "Site ou sistema web vulnerável",
        "problem": ("Um site ou sistema web da empresa tem uma falha que pode "
                    "deixar um invasor roubar dados ou assumir o sistema."),
        "fix": ("Corrigir a falha na aplicação, remover arquivos sensíveis "
                "expostos e trocar senhas padrão."),
        "loss": (150_000, 4_000_000),
        "fix_cost": (3_000, 15_000),
    },
    "smb_ad": {
        "label": "Rede Windows / domínio vulnerável",
        "problem": ("O compartilhamento de arquivos ou o controlador de domínio "
                    "Windows tem uma falha que pode dar acesso a toda a rede interna."),
        "fix": ("Aplicar as atualizações de segurança da Microsoft e ativar as "
                "proteções de assinatura de rede (SMB signing)."),
        "loss": (300_000, 5_100_000),
        "fix_cost": (5_000, 20_000),
    },
    "iot_ot": {
        "label": "Equipamento industrial / IoT exposto",
        "problem": ("Um equipamento de automação (IoT/OT) está acessível sem "
                    "proteção. Um ataque aqui pode parar a operação física."),
        "fix": ("Isolar o equipamento em uma rede separada e exigir autenticação "
                "no broker/painel de controle."),
        "loss": (500_000, 8_700_000),
        "fix_cost": (8_000, 40_000),
    },
    "remote_access": {
        "label": "Acesso remoto exposto",
        "problem": ("Um serviço de acesso remoto (SSH, RDP, VNC ou FTP) está "
                    "aberto e pode ser usado para invadir a máquina."),
        "fix": ("Restringir o acesso remoto a redes confiáveis (VPN) e exigir "
                "senha forte com duplo fator (2FA)."),
        "loss": (100_000, 3_800_000),
        "fix_cost": (2_000, 12_000),
    },
}

_DEFAULT = {
    "label": "Exposição de ativo",
    "problem": ("Um ativo da empresa está exposto de uma forma que pode ser "
                "explorada por um invasor."),
    "fix": "Fechar o acesso desnecessário e aplicar as atualizações de segurança.",
    "loss": (80_000, 2_500_000),
    "fix_cost": (2_000, 10_000),
}

# Quanto a severidade escala o PREJUÍZO (um crítico dói o valor cheio; um baixo, pouco).
_SEV_LOSS = {"crit": 1.0, "high": 0.65, "med": 0.35, "low": 0.15, "info": 0.05}
# Quanto a severidade escala o CUSTO de corrigir (corrigir sob urgência custa mais).
_SEV_FIX = {"crit": 1.0, "high": 0.8, "med": 0.6, "low": 0.45, "info": 0.35}

_SEV_PT = {"crit": "Crítico", "high": "Alto", "med": "Médio", "low": "Baixo", "info": "Informativo"}
# Ordem de prioridade para o dono (crítico primeiro).
_SEV_ORDER = {"crit": 0, "high": 1, "med": 2, "low": 3, "info": 4}


def _area(finding: Dict) -> Dict:
    return _AREA.get(finding.get("category", ""), _DEFAULT)


def _scale(rng: Tuple[int, int], factor: float) -> Tuple[int, int]:
    return (round(rng[0] * factor), round(rng[1] * factor))


def loss_estimate(finding: Dict) -> Tuple[int, int]:
    """Prejuízo estimado (min, max) em BRL se o problema NÃO for corrigido."""
    f = _SEV_LOSS.get(finding.get("sev", "info"), 0.2)
    return _scale(_area(finding)["loss"], f)


def fix_cost(finding: Dict) -> Tuple[int, int]:
    """Custo estimado (min, max) em BRL para corrigir o problema."""
    f = _SEV_FIX.get(finding.get("sev", "info"), 0.5)
    return _scale(_area(finding)["fix_cost"], f)


def brl_short(v: float) -> str:
    """Formata um valor em reais de forma curta e legível: R$ 6,2 mi / R$ 200 mil."""
    v = float(v)
    if v >= 1_000_000:
        s = f"{v / 1_000_000:.1f}".replace(".", ",").rstrip("0").rstrip(",")
        return f"R$ {s} mi"
    if v >= 1_000:
        return f"R$ {round(v / 1_000)} mil"
    return f"R$ {round(v)}"


def brl_range(rng: Tuple[int, int]) -> str:
    lo, hi = rng
    return brl_short(hi) if lo == hi else f"{brl_short(lo)}–{brl_short(hi)}"


def business_item(finding: Dict, finding_id: Optional[int] = None) -> Dict:
    """Um problema traduzido para o dono: o que é, quanto custa (não) resolver, o que mudar."""
    area = _area(finding)
    loss = loss_estimate(finding)
    fix = fix_cost(finding)
    return {
        "finding_id": finding_id,
        "title": finding.get("title") or area["label"],
        "area_label": area["label"],
        "severity": finding.get("sev", "info"),
        "severity_label": _SEV_PT.get(finding.get("sev", "info"), "Informativo"),
        "host": finding.get("host"),
        "port": finding.get("port"),
        "problem": area["problem"],
        "fix": area["fix"],
        "loss_min": loss[0], "loss_max": loss[1], "loss_label": brl_range(loss),
        "fix_cost_min": fix[0], "fix_cost_max": fix[1], "fix_cost_label": brl_range(fix),
    }


def summarize(findings: List[Dict]) -> Dict:
    """
    Resumo agregado para o painel do dono.

    `findings` são dicts de finding (podem trazer 'finding_id' e uma 'decision'
    já anexada: {'status': 'authorized'|'dismissed', ...}). Só os problemas SEM
    decisão contam como exposição "em aberto".
    """
    by_sev = {"crit": 0, "high": 0, "med": 0, "low": 0, "info": 0}
    open_loss_min = open_loss_max = 0
    open_fix_min = open_fix_max = 0
    authorized_budget = 0.0
    authorized = pending = dismissed = 0

    for f in findings:
        sev = f.get("sev", "info")
        by_sev[sev] = by_sev.get(sev, 0) + 1
        decision = f.get("decision")
        status = (decision or {}).get("status")
        if status == "authorized":
            authorized += 1
            authorized_budget += float((decision or {}).get("budget") or 0)
        elif status == "dismissed":
            dismissed += 1
        else:  # em aberto — soma na exposição
            pending += 1
            lmin, lmax = loss_estimate(f)
            fmin, fmax = fix_cost(f)
            open_loss_min += lmin
            open_loss_max += lmax
            open_fix_min += fmin
            open_fix_max += fmax

    return {
        "by_severity": by_sev,
        "total": len(findings),
        "pending": pending,
        "authorized": authorized,
        "dismissed": dismissed,
        "open_loss_min": open_loss_min,
        "open_loss_max": open_loss_max,
        "open_loss_label": brl_range((open_loss_min, open_loss_max)),
        "open_fix_min": open_fix_min,
        "open_fix_max": open_fix_max,
        "open_fix_label": brl_range((open_fix_min, open_fix_max)),
        "authorized_budget": authorized_budget,
        "authorized_budget_label": brl_short(authorized_budget),
    }


def sort_key(finding: Dict):
    """Ordena por severidade (crítico primeiro) e depois por CVSS desc."""
    return (_SEV_ORDER.get(finding.get("sev", "info"), 9), -float(finding.get("cvss") or 0))
