"""
Regras puras de escopo — o contrato ético do CYMAG, sem dependência de framework.

Estas funções não conhecem Flask nem o banco: apenas decidem se um alvo está
dentro de um escopo autorizado (lista de IPs/CIDRs). A camada web (app/scope.py)
reusa isto e adiciona a resolução do Engagement via banco.

Manter a lógica de contenção aqui permite que TANTO o scan manual QUANTO o motor
autônomo filtrem hosts pela mesma regra — a autorização não pode ser contornada
por uma rota que "esqueceu" de validar.
"""

import ipaddress
from typing import List, Tuple


def valid_scope(scope: list) -> Tuple[bool, str]:
    """Valida que cada entrada do escopo é um IP ou CIDR válido."""
    if not isinstance(scope, list) or not scope:
        return False, "Escopo deve ser uma lista não vazia de IPs/CIDRs."
    for entry in scope:
        try:
            ipaddress.ip_network(str(entry), strict=False)
        except ValueError:
            return False, f"Entrada de escopo inválida: {entry}"
    return True, ""


def target_in_scope(target: str, scope: list) -> bool:
    """True se `target` (IP ou CIDR) estiver contido em alguma faixa do escopo."""
    try:
        tnet = ipaddress.ip_network(str(target), strict=False)
    except ValueError:
        return False
    for entry in scope:
        try:
            if tnet.subnet_of(ipaddress.ip_network(str(entry), strict=False)):
                return True
        except (ValueError, TypeError):
            continue
    return False


def hosts_in_scope(hosts: List[str], scope: list) -> List[str]:
    """Filtra uma lista de hosts, mantendo só os que estão dentro do escopo.

    Usada como segunda barreira: mesmo depois de o alvo ser validado, os hosts
    efetivamente *descobertos* na fase de recon são re-filtrados, para que um
    resultado inesperado do Nmap nunca leve o motor a tocar algo fora do escopo.
    Escopo vazio significa "não filtrar" (o chamador é responsável por exigir
    escopo quando ele for obrigatório).
    """
    if not scope:
        return list(hosts)
    return [h for h in hosts if target_in_scope(h, scope)]
