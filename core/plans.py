"""
Planos comerciais do CYMAG — definição como dados (agnóstico de framework).

MODELO DE NEGÓCIO
-----------------
Público: PMEs que não têm (ou não conseguem manter) uma equipe de segurança.
A plataforma é usada INTERNAMENTE pela empresa — pelo dono e/ou pelo único
profissional de TI/segurança — e o agente autônomo faz o trabalho pesado de
recon→enumeração→exploração→relatório, para que uma pessoa só renda como um time.

O PLANO PERTENCE À CONTA (a empresa que contrata), não a um usuário técnico.
Quem compra é o dono (role 'owner'); os usuários internos herdam o plano da conta.

Escada de valor (quanto mais alto, mais a CYMAG faz POR você):
  comunidade  → avaliação: scan manual, 1 alvo (experimentar)
  essencial   → o AGENTE AUTÔNOMO self-service (você mesmo usa). Sem IA generativa.
  profissional→ + IA (AEGIS) como copiloto + treinamento/onboarding ("aula rápida")
  gerenciado  → + a CYMAG executa o pentest periodicamente e assina o laudo
  enterprise  → contínuo, dedicado, integrações, OT/IoT

A "intervenção humana" dos planos altos é um SERVIÇO ENTREGUE PELA CYMAG
(equipe interna, role 'cymag'), não um papel dentro do cliente.
"""

from dataclasses import dataclass
from typing import FrozenSet, List, Optional

# ─── Features gateáveis ─────────────────────────────────────────────────────────
FEATURE_AUTONOMOUS = "autonomous"  # agente autônomo (núcleo do produto)
FEATURE_AI = "ai"                  # copiloto AEGIS (remediação, risco, cadeia por IA)
FEATURE_TRAINING = "training"      # onboarding/treinamento entregue pela CYMAG
FEATURE_MANAGED = "managed"        # pentest periódico executado e assinado pela CYMAG


@dataclass(frozen=True)
class Plan:
    key: str
    name: str
    price_month: float                 # BRL/mês
    price_year: float                  # BRL/ano (2 meses grátis)
    features: FrozenSet[str]
    scans_per_month: Optional[int]     # None = ilimitado (fair-use)
    max_ips: Optional[int]             # None = ilimitado
    report_level: str                  # watermark|clean|ai|signed|white_label
    managed_cadence_days: int          # 0 = sem pentest gerenciado; 60 = a cada 2 meses
    tagline: str                       # frase-resumo p/ a página de planos
    audience: str

    def has(self, feature: str) -> bool:
        return feature in self.features


# Ordem crescente — usada para sugerir "faça upgrade para…".
ORDER: List[str] = ["comunidade", "essencial", "profissional", "gerenciado", "enterprise"]

DEFAULT_PLAN = "comunidade"

PLANS = {
    "comunidade": Plan(
        key="comunidade", name="Comunidade",
        price_month=0.0, price_year=0.0,
        features=frozenset(),
        scans_per_month=1, max_ips=1,
        report_level="watermark", managed_cadence_days=0,
        tagline="Experimente: um scan manual em um alvo.",
        audience="Avaliação e uso educacional",
    ),
    "essencial": Plan(
        key="essencial", name="Essencial",
        price_month=297.0, price_year=2970.0,
        features=frozenset({FEATURE_AUTONOMOUS}),
        scans_per_month=10, max_ips=256,
        report_level="clean", managed_cadence_days=0,
        tagline="O agente autônomo na mão da sua equipe. Você mesmo roda.",
        audience="PME que quer autonomia sem contratar um time",
    ),
    "profissional": Plan(
        key="profissional", name="Profissional",
        price_month=897.0, price_year=8970.0,
        features=frozenset({FEATURE_AUTONOMOUS, FEATURE_AI, FEATURE_TRAINING}),
        scans_per_month=50, max_ips=1024,
        report_level="ai", managed_cadence_days=0,
        tagline="IA copiloto: seu único analista rende como um time. Com treinamento.",
        audience="PME com um profissional de TI/segurança sobrecarregado",
    ),
    "gerenciado": Plan(
        key="gerenciado", name="Gerenciado",
        price_month=3900.0, price_year=39000.0,
        features=frozenset({FEATURE_AUTONOMOUS, FEATURE_AI, FEATURE_TRAINING, FEATURE_MANAGED}),
        scans_per_month=None, max_ips=None,
        report_level="signed", managed_cadence_days=60,
        tagline="A CYMAG faz o pentest a cada 2 meses e assina o laudo (LGPD/ISO/PCI).",
        audience="PME que precisa de laudo e acompanhamento recorrente",
    ),
    "enterprise": Plan(
        key="enterprise", name="Enterprise",
        price_month=6000.0, price_year=72000.0,  # piso; venda consultiva
        features=frozenset({FEATURE_AUTONOMOUS, FEATURE_AI, FEATURE_TRAINING, FEATURE_MANAGED}),
        scans_per_month=None, max_ips=None,
        report_level="white_label", managed_cadence_days=30,
        tagline="Contínuo, dedicado, integrações e OT/IoT. Sob consulta.",
        audience="Empresas maiores, financeiro e ambientes OT/IoT",
    ),
}


def get_plan(key: Optional[str]) -> Plan:
    """Plano pela chave; cai no plano padrão se a chave for desconhecida/vazia."""
    return PLANS.get((key or "").strip().lower(), PLANS[DEFAULT_PLAN])


def has_feature(key: Optional[str], feature: str) -> bool:
    return get_plan(key).has(feature)


def scan_quota(key: Optional[str]) -> Optional[int]:
    return get_plan(key).scans_per_month


def min_plan_with(feature: str) -> Optional[str]:
    """Menor plano (na ordem comercial) que inclui a feature — para sugerir upgrade."""
    for k in ORDER:
        if PLANS[k].has(feature):
            return k
    return None


def public_catalog() -> list:
    """Lista serializável dos planos, para a UI de pricing."""
    out = []
    for k in ORDER:
        p = PLANS[k]
        out.append({
            "key": p.key,
            "name": p.name,
            "price_month": p.price_month,
            "price_year": p.price_year,
            "features": sorted(p.features),
            "scans_per_month": p.scans_per_month,
            "max_ips": p.max_ips,
            "report_level": p.report_level,
            "managed_cadence_days": p.managed_cadence_days,
            "tagline": p.tagline,
            "audience": p.audience,
            "autonomous": p.has(FEATURE_AUTONOMOUS),
            "ai": p.has(FEATURE_AI),
            "training": p.has(FEATURE_TRAINING),
            "managed": p.has(FEATURE_MANAGED),
        })
    return out
