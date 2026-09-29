# CYMAG Enterprise v2 — Motor de Scan

## Estrutura

```
cymag_saas/
├── run.py                    ← Entrypoint (python run.py)
├── requirements.txt
├── .env.example              ← Copie para .env e preencha os segredos
├── app/                      ← Aplicação web (Flask) — separada por área
│   ├── __init__.py           ← Application factory (create_app)
│   ├── config.py             ← Configuração via ambiente/.env
│   ├── db.py                 ← Camada de dados (SQLite: users/engagements/scans/findings/audit)
│   ├── ai/aegis.py           ← AEGIS (integração Groq + fallbacks offline)
│   ├── auth/                 ← Login/sessão/papéis + decorators
│   ├── scans/                ← Scan, remediação, cadeia, auto-descoberta, histórico
│   ├── engagements/          ← Escopo autorizado (base do modo autônomo)
│   ├── reports/              ← Geração de PDF (+ narrativa AEGIS)
│   └── main.py               ← Dashboard (/) e health check
├── core/                     ← Motor de domínio (agnóstico de framework)
│   ├── scanner.py            ← Orquestrador central (FallbackChain em todas as fases)
│   ├── exploit_engine.py     ← Checkers por serviço (HTTP, MQTT, Redis, SMB, MySQL…)
│   ├── mqtt_explorer.py      ← Exploração autônoma de brokers MQTT
│   └── fallback.py           ← Utilitário FallbackChain
├── scanner_go/               ← Port scanner opcional em Go (goroutines + banner grabbing)
├── static/  templates/       ← Frontend (dashboard)
└── instance/                 ← Banco SQLite + secret key (gerado; fora do git)
```

## Instalação (multiplataforma: Linux, macOS e Windows)

Funciona em qualquer SO. As únicas dependências obrigatórias são `flask`,
`groq`, `requests` e `fpdf2`. As demais habilitam recursos extras e têm
fallback automático quando ausentes:

- `psutil` — auto-descoberta de rede portável (recomendado; sem ele há
  fallback via socket que assume /24).
- `python-nmap` — usa Nmap se instalado; sem ele, o scan cai para socket puro.
- `paho-mqtt` — exploração de brokers MQTT.
- `pymysql` — checagem de credenciais MySQL.

**1. Criar e ativar o ambiente virtual**

Linux / macOS:
```bash
python3 -m venv venv
source venv/bin/activate
```

Windows (PowerShell):
```powershell
py -m venv venv
.\venv\Scripts\Activate.ps1
```

**2. Instalar dependências** (mesmo comando em todos os SOs, com o venv ativo):
```bash
pip install flask groq requests fpdf2 psutil python-nmap paho-mqtt pymysql
```

> Nmap (o programa) é opcional. Para detecção de serviços mais rica, instale-o
> pelo SO: `apt install nmap` (Linux), `brew install nmap` (macOS) ou o
> instalador oficial em nmap.org (Windows). Sem ele o scanner usa socket puro.

## Compilar o scanner Go (opcional mas recomendado)

Linux / macOS:
```bash
cd scanner_go
go build -o cymag_scan main.go
```

Windows (PowerShell):
```powershell
cd scanner_go
go build -o cymag_scan.exe main.go
```

O Python detecta automaticamente o binário do SO correto (`cymag_scan` ou
`cymag_scan.exe`). Se não encontrar, usa Nmap ou, por fim, socket scan Python.

## Variáveis de ambiente

Linux / macOS:
```bash
export GROQ_API_KEY="gsk_..."    # Chave da Groq para o AEGIS
```

Windows (PowerShell):
```powershell
$env:GROQ_API_KEY = "gsk_..."
```

> ⚠️  NUNCA commite a chave no repositório. Use `.env` + `python-dotenv` ou secrets do CI/CD.
> Sem a chave o AEGIS opera em modo offline (respostas pré-programadas).

## Rodar

Com o venv ativo, em qualquer SO:
```bash
python run.py
```
Depois acesse http://127.0.0.1:5000

### Modelo: contas, papéis e planos

O **plano pertence à conta** (a empresa que contrata). Os usuários internos herdam
o plano da conta. A plataforma é para uso **interno da PME**; o agente autônomo
ajuda o profissional de TI/segurança a cobrir mais em menos tempo.

- Papéis do cliente: **owner** (dono — contrata/gerencia), **operator** (usa no dia a dia), **viewer** (só relatórios).
- Papéis da CYMAG: **cymag** (consultor que entrega o pentest gerenciado), **admin** (superadmin).
- Planos (`core/plans.py`): Comunidade → Essencial (agente autônomo) → Profissional (+IA +treino) → Gerenciado (+CYMAG faz o pentest) → Enterprise.

### Contas de acesso demo (criadas no primeiro boot, senha hasheada)

| E-mail | Senha | Papel | Conta / Plano |
|--------|-------|-------|----------------|
| `dono@pme.com` | `cybersecurity` | owner | PME Demo Ltda / Profissional |
| `ti@pme.com` | `cybersecurity` | operator | PME Demo Ltda / Profissional |
| `dono@lojaverde.com` | `cybersecurity` | owner | Loja Verde / Gerenciado |
| `consultor@cymag.com` | `cybersecurity` | cymag | CYMAG (equipe) / Enterprise |
| `admin@cymag.com` | `cymag-admin` (ou `CYMAG_ADMIN_PASSWORD`) | admin | CYMAG (equipe) / Enterprise |

> Troque essas senhas antes de qualquer uso real. O banco fica em `instance/cymag.db`.
> Entrar como `dono@pme.com` e depois `dono@lojaverde.com` mostra a UI mudando por plano.

## Endpoints

Rotas de scan/relatório exigem sessão (faça `POST /api/login` primeiro).

| Método | Rota                              | Descrição                                          |
|--------|-----------------------------------|----------------------------------------------------|
| GET    | `/api/health`                     | Status do serviço e do AEGIS                       |
| POST   | `/api/login` · `/api/logout`      | Autenticação (sessão por cookie)                   |
| GET    | `/api/me`                         | Usuário autenticado atual                          |
| POST   | `/api/scan`                       | Scan completo (exige engagement autorizado + alvo no escopo) |
| GET    | `/api/scans`                      | Histórico de scans do usuário                      |
| GET    | `/api/scans/<id>/findings`        | Achados de um scan                                 |
| POST   | `/api/remediation`                | AEGIS analisa 1 vuln (secops ou exec)              |
| POST   | `/api/exploit_chain`              | AEGIS planeja attack chain com todos os achados    |
| GET    | `/api/auto_discover`              | Sub-redes locais (cross-platform)                  |
| GET    | `/api/areas`                      | Áreas do pentester cobertas e seus serviços        |
| GET/POST | `/api/engagements`              | Lista/cria engagement (escopo autorizado)          |
| POST   | `/api/engagements/<id>/authorize` | Admin autoriza o engagement                        |
| POST   | `/api/autonomous/run`             | Inicia operação autônoma (exige engagement autorizado + alvo no escopo) |
| GET    | `/api/autonomous/<run_id>`        | Progresso/relatório da operação (polling `?since=N`) |
| POST   | `/api/report/quick` · `/detailed` | Gera PDF (detailed usa narrativa do AEGIS)         |

### Áreas do pentester (Fase 3 — plugáveis em `core/checks/`)

`recon` · `web` (OWASP) · `database` · `smb_ad` · `iot_ot` · `remote_access` · `post_exploit`.
Cada área é um módulo com checks `@register`. O motor autônomo (Fase 4) encadeia
recon→enum→exploit→plano IA→relatório, **restrito ao escopo do Engagement autorizado**.

## Escopo / autorização (contrato ético)

**Nenhuma varredura roda sem um Engagement autorizado que contenha o alvo** —
vale tanto para o scan manual (`/api/scan`) quanto para o autônomo. A regra vive
num único ponto (`app/scope.py` → `resolve_authorized_target`, sobre as funções
puras de `core/scope.py`), então nenhuma rota consegue contorná-la. Os hosts
efetivamente descobertos na fase de recon são **re-filtrados** pelo escopo (2ª
barreira). Conteúdo vindo do alvo (banners, evidências, payloads MQTT) é
sanitizado antes de entrar em qualquer prompt do AEGIS (anti prompt-injection,
`app/ai/aegis.py` → `sanitize_finding`).

## Testes

```
pip install pytest      # já incluso no requirements.txt
pytest tests/           # regras de escopo, severidade e sanitização (puras, sem rede)
```

## FallbackChain — como funciona

Cada operação tenta estratégias em ordem até uma funcionar:

**Descoberta de hosts:**
```
nmap -sn (ICMP) → nmap -PS (TCP ping) → nmap -PU (UDP) → direto por IP
```

**Port scan:**
```
Go binary → nmap -sS -sV (SYN) → nmap -sT -sV (TCP) → nmap -Pn → socket Python
```

**MQTT (MQTTExplorer):**
```
porta 1883 → porta 9001 (WebSocket) → porta 1884 → porta 8883 (TLS sem cert)
→ captura wildcard # por 7s → injeção de payloads nos tópicos de controle
```

## Nmap: flags usadas

| Estratégia      | Flags                                      | Quando usa           |
|-----------------|--------------------------------------------|----------------------|
| `syn_sV_OS`     | `-Pn -sS -sV -O --open -T4 --vi 7`       | Root disponível      |
| `connect_sV`    | `-Pn -sT -sV --open -T4 --vi 5`          | Sem root             |
| `fast_sV`       | `-Pn -sV --open -T3 --vi 3`              | Rede lenta           |
| `minimal_Pn`    | `-Pn --open -T3`                           | Último recurso Nmap  |
| `socket_python` | ThreadPoolExecutor 150 workers              | Nmap indisponível    |
