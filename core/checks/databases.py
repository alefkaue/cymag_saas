"""Área Bancos de Dados — MySQL, Redis, MongoDB, Elasticsearch, PostgreSQL."""

import logging
import socket
import time
from typing import Dict, List

import requests

from core.checks.base import (HTTP_TIMEOUT, SOCKET_TIMEOUT, ScanContext,
                              ServiceCheck, make_finding, register)

requests.packages.urllib3.disable_warnings()
logger = logging.getLogger("cymag.checks.db")


@register
class MySQLCheck(ServiceCheck):
    name = "mysql"
    category = "database"
    ports = [3306, 3307]

    def run(self, ctx: ScanContext) -> List[Dict]:
        host, port = ctx.host, ctx.port
        raw_banner = ctx.read_banner() or ctx.banner

        default_creds = [("root", ""), ("root", "root"), ("root", "mysql"),
                         ("mysql", "mysql"), ("admin", "admin"), ("root", "password")]
        for user, passwd in default_creds:
            try:
                import pymysql
                conn = pymysql.connect(host=host, port=port, user=user, password=passwd,
                                       connect_timeout=SOCKET_TIMEOUT, db="")
                conn.close()
                return [make_finding(
                    f"MySQL — Credencial Padrão Ativa ({user}/{passwd or 'sem senha'})",
                    f"Login MySQL bem-sucedido com '{user}:{passwd or '(vazio)'}'. Acesso total ao banco de dados.",
                    "crit", 9.8, "CWE-798",
                    evidence=f"Conexão aceita: {user}:{passwd or '(vazio)'}", banner=raw_banner,
                )]
            except ImportError:
                break
            except Exception:
                pass

        if raw_banner:
            for old in ["5.5.", "5.6.", "5.0.", "4."]:
                if old in raw_banner:
                    return [make_finding(
                        "MySQL End-of-Life Detectado",
                        f"Versão MySQL sem suporte ativo de segurança. Banner: {raw_banner[:80]}",
                        "crit", 9.8, "CVE-2016-6662", evidence=raw_banner[:200], banner=raw_banner,
                    )]
        return []


@register
class RedisCheck(ServiceCheck):
    name = "redis"
    category = "database"
    ports = [6379]

    def run(self, ctx: ScanContext) -> List[Dict]:
        strategies = [
            ("ping_plain",  lambda: self._probe(ctx.host, ctx.port, b"PING\r\n")),
            ("ping_inline", lambda: self._probe(ctx.host, ctx.port, b"ping\n")),
        ]
        result, _ = ctx.chain.run(strategies)
        if not result:
            return []
        version, info_raw = result
        return [make_finding(
            "Redis Sem Autenticação",
            f"Redis v{version} respondeu PONG sem credenciais. Acesso irrestrito ao banco de dados em memória.",
            "crit", 9.8, "CVE-2022-0543",
            evidence=f"PING → +PONG\n{info_raw[:300]}", banner=f"Redis {version}",
        )]

    @staticmethod
    def _probe(host: str, port: int, ping_cmd: bytes):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(SOCKET_TIMEOUT)
        try:
            s.connect((host, port))
            s.sendall(ping_cmd)
            time.sleep(0.1)
            response = s.recv(128).decode("utf-8", errors="replace")
            if "+PONG" not in response.upper() and "PONG" not in response:
                return None
            s.sendall(b"INFO server\r\n")
            info = s.recv(2048).decode("utf-8", errors="replace")
            version = "?"
            for line in info.split("\n"):
                if line.startswith("redis_version"):
                    version = line.split(":")[-1].strip()
            return version, info
        finally:
            s.close()


@register
class MongoDBCheck(ServiceCheck):
    name = "mongodb"
    category = "database"
    ports = [27017]

    def run(self, ctx: ScanContext) -> List[Dict]:
        try:
            hello_pkt = bytes.fromhex(
                "3a0000000000000000000000d40700000000000061646d696e2e24636d64"
                "0000000000ffffffff130000001069736d61737465720001000000"
            )
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(SOCKET_TIMEOUT)
            s.connect((ctx.host, ctx.port))
            s.sendall(hello_pkt)
            resp = s.recv(512)
            s.close()
            if resp and len(resp) > 20:
                return [make_finding(
                    "MongoDB Sem Autenticação",
                    "MongoDB respondeu ao handshake sem credenciais. Possível acesso total a todos os databases.",
                    "crit", 9.8, "CWE-306",
                    evidence=f"Wire protocol response: {len(resp)} bytes recebidos", banner=ctx.banner,
                )]
        except Exception as e:
            logger.debug("[mongodb] %s:%d: %s", ctx.host, ctx.port, e)
        return []


@register
class ElasticsearchCheck(ServiceCheck):
    name = "elasticsearch"
    category = "database"
    ports = [9200]

    def run(self, ctx: ScanContext) -> List[Dict]:
        host, port = ctx.host, ctx.port
        strategies = [
            ("http_root",  lambda: requests.get(f"http://{host}:{port}/", timeout=HTTP_TIMEOUT)),
            ("https_root", lambda: requests.get(f"https://{host}:{port}/", timeout=HTTP_TIMEOUT, verify=False)),
        ]
        resp, _ = ctx.chain.run(strategies)
        if resp is None or resp.status_code != 200 or "cluster_name" not in resp.text:
            return []
        try:
            info = resp.json()
            version = info.get("version", {}).get("number", "?")
            cluster = info.get("cluster_name", "?")
        except Exception:
            version, cluster = "?", "?"
        indices = ""
        try:
            indices = requests.get(f"http://{host}:{port}/_cat/indices?v", timeout=HTTP_TIMEOUT).text[:400]
        except Exception:
            pass
        return [make_finding(
            "Elasticsearch Exposto Sem Autenticação",
            f"Cluster '{cluster}' v{version} acessível sem credenciais. Todos os índices de dados expostos.",
            "crit", 9.8, "CVE-2015-1427",
            evidence=f"Cluster: {cluster} | v{version}\n\nÍndices:\n{indices}", banner=f"Elasticsearch {version}",
        )]


@register
class PostgresCheck(ServiceCheck):
    name = "postgres"
    category = "database"
    ports = [5432]

    def run(self, ctx: ScanContext) -> List[Dict]:
        try:
            startup = (
                b'\x00\x00\x00\x54\x00\x03\x00\x00'
                b'user\x00postgres\x00'
                b'database\x00postgres\x00\x00'
            )
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(SOCKET_TIMEOUT)
            s.connect((ctx.host, ctx.port))
            s.sendall(startup)
            resp = s.recv(256)
            s.close()
            if resp and len(resp) > 4 and chr(resp[0]) in ("R", "N", "S"):
                return [make_finding(
                    "PostgreSQL Acessível na Rede",
                    "Porta PostgreSQL respondeu ao startup. Verifique credenciais padrão (postgres/postgres, postgres/admin).",
                    "med", 6.5, "CWE-521",
                    evidence=f"Startup response type: '{chr(resp[0])}' ({len(resp)} bytes)", banner=ctx.banner,
                )]
        except Exception as e:
            logger.debug("[postgres] %s:%d: %s", ctx.host, ctx.port, e)
        return []
