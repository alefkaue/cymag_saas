"""
FallbackChain — executa estratégias em sequência até uma ter sucesso.
Padrão central do CYMAG para garantir resiliência: se um comando falha,
o próximo é tentado automaticamente, sem interromper o scan.

Uso:
    chain = FallbackChain()
    result, used = chain.run([
        ("nmap_syn",  lambda: nmap_scan("-sS -sV")),
        ("nmap_tcp",  lambda: nmap_scan("-sT -sV")),
        ("socket",    lambda: raw_socket_scan()),
    ])
"""
import logging
from typing import Any, Callable, List, Optional, Tuple

logger = logging.getLogger("cymag.fallback")


class FallbackChain:
    """
    Executa uma lista de (nome, callable) até que um retorne valor truthy.
    Registra cada tentativa para rastreabilidade total no log.
    """

    def run(
        self,
        strategies: List[Tuple[str, Callable]],
        default: Any = None,
    ) -> Tuple[Any, str]:
        """
        Retorna (resultado, nome_da_estratégia_usada).
        Se todas falharem, retorna (default, "none").
        """
        for name, fn in strategies:
            try:
                logger.debug("[fallback] ▶ Tentando estratégia: %s", name)
                result = fn()
                # Considera falha: None, False, lista/dict vazio
                if result is not None and result is not False and result != [] and result != {}:
                    logger.info("[fallback] ✓ Sucesso com: %s", name)
                    return result, name
                logger.debug("[fallback] ↩ '%s' retornou vazio, tentando próxima...", name)
            except Exception as exc:
                logger.warning("[fallback] ✗ '%s' lançou exceção: %s", name, exc)

        logger.warning("[fallback] Todas as %d estratégias falharam.", len(strategies))
        return default, "none"
