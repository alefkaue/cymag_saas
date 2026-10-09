# CYMAG Enterprise — Guia da Plataforma

> Plataforma de **pentest autônomo com IA** para PMEs. Ela descobre, explora e
> **explica** as falhas de uma rede — e traduz cada risco técnico em **quanto
> custaria** para o negócio, em português claro para o dono decidir.

Este documento explica **o que é**, **como rodar** e **como funciona** a
plataforma. É o ponto de partida ideal para entender o projeto em 10 minutos.

---

## 1. O que é a CYMAG

A CYMAG é um SaaS de segurança ofensiva com três camadas de valor:

| Camada | Para quem | O que entrega |
|---|---|---|
| **Scanner / Pentester autônomo** | Analista de TI | Descoberta de rede → port scan → enumeração → exploração → laudo, dentro de um escopo autorizado. |
| **AEGIS (copiloto de IA)** | Analista / consultor | Enriquece cada achado: passos de remediação, comandos prontos, cadeia de ataque, CVSS e mapeamento MITRE ATT&CK. |
| **Visão do dono** | Dono do negócio (não técnico) | Traduz as falhas em **impacto financeiro** ("quanto custa não corrigir" × "quanto custa corrigir") e permite autorizar orçamento. |

O diferencial é **falar a língua do dono**: em vez de só listar CVEs, a plataforma
quantifica o risco em reais (LGPD, downtime, resposta a incidente).

### AEGIS — IA com degradação graciosa

O **AEGIS** é o cérebro de IA. Ele usa a **API da Groq** (compatível com o
protocolo da OpenAI) para gerar análises. O ponto importante:

- **Com chave de API** → respostas geradas por LLM (modelo `llama-3.3-70b-versatile` por padrão).
- **Sem chave** → o AEGIS cai em **modo offline**, com respostas determinísticas
  embutidas (`offline_secops`, `offline_exec`). **A plataforma nunca quebra por
  falta de IA** — ela apenas fica mais rica quando a IA está ligada.

---

## 2. Arquitetura

```
cymag_saas/
├── run.py                 # Entrypoint: sobe o servidor Flask
├── app/                   # Aplicação web (Flask, factory + blueprints)
│   ├── __init__.py        # create_app(): monta app, DB e AEGIS, registra blueprints
│   ├── config.py          # Configuração via variáveis de ambiente (.env)
│   ├── db.py              # Camada de dados (SQLite puro, sem ORM)
│   ├── ai/aegis.py        # Cliente do AEGIS (Groq) + fallbacks offline + teste/runtime
│   ├── auth/              # Login, sessão, decorators de papel/plano
│   ├── admin/            # ★ NOVO: painel admin de IA (status/testar/aplicar chave)
│   ├── scans/            # Scan manual, remediação, cadeia, auto-descoberta, histórico
│   ├── autonomous/       # Pentester autônomo (opera dentro do escopo)
│   ├── engagements/      # Escopos autorizados (base ética do modo autônomo)
│   ├── owner/            # Visão de negócio do dono (resumo + orçamento)
│   ├── billing/          # Assinatura / planos
│   ├── reports/          # Geração de laudos em PDF
│   └── main.py           # Dashboard + health check + catálogo de planos
├── core/                  # Motor de domínio, independente do Flask
│   ├── scanner.py        # Scanner de rede/portas
│   ├── exploit_engine.py # Áreas de cobertura e checagens
│   ├── checks/           # Verificações por área (web, smb, databases, iot_ot, remote)
│   ├── business.py       # Tradução técnica → risco de negócio (R$)
│   ├── plans.py          # Catálogo de planos e entitlements
│   └── severity.py       # Pesos de severidade e cálculo de risk score
├── index.html             # Frontend (SPA de página única, sem build)
├── static/
│   ├── cymag.js          # App SPA (conecta na API real)
│   ├── cymag-demo.js     # ★ Camada de demonstração: responde à API no navegador
│   └── cymag.css         # Estilos
└── tests/                 # Suíte pytest (lógica de negócio, planos, sanitização…)
```

**Decisões de projeto importantes:**

- **Backend modular por blueprint** — cada área de negócio é um pacote isolado.
- **SQLite puro (stdlib)** — zero dependência de banco externo; portável e leve.
- **Um único `index.html`** — serve tanto pelo Flask (backend real) quanto como
  **site estático** (GitHub Pages/Vercel) no *modo demonstração*, em que
  `static/cymag-demo.js` responde às chamadas de API 100% no navegador.
- **`core/` não importa Flask** — o motor de domínio é testável de forma isolada.

---

## 3. Papéis e contas de teste

A plataforma é multi-conta e multi-papel. Cada papel vê uma tela diferente:

| Papel | Tela | Enxerga |
|---|---|---|
| `owner` (dono) | Resumo de negócio | Risco, custo e decisão de orçamento — sem jargão. |
| `operator` (TI) | Console técnico | Scan, autônomo, engagements, áreas, histórico. |
| `viewer` | Painel executivo | Leitura do relatório consolidado. |
| `cymag` (consultor) | Console + Central | Entrega dos pentests gerenciados. |
| `admin` (superadmin) | Tudo + **IA / AEGIS** | Console completo **+ painel de configuração da IA**. |

**Contas semeadas no primeiro boot** (senha `cybersecurity`, exceto o admin):

| E-mail | Papel | Senha |
|---|---|---|
| `admin@cymag.com` | admin | `cymag-admin` |
| `consultor@cymag.com` | cymag | `cybersecurity` |
| `dono@pme.com` | owner | `cybersecurity` |
| `ti@pme.com` | operator | `cybersecurity` |
| `dono@lojaverde.com` | owner (plano gerenciado) | `cybersecurity` |

> A senha do admin pode ser definida por `CYMAG_ADMIN_PASSWORD` no `.env`.

---

## 4. Como rodar

### Pré-requisitos
- **Python 3.10+** (testado em 3.14).
- Opcional: Nmap instalado no SO (melhora a detecção de serviços; há fallback por socket).

### Passo a passo (Windows — PowerShell)

```powershell
# 1. Entre na pasta do projeto
cd cymag_saas

# 2. Crie e ative um ambiente virtual
py -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3. Instale as dependências
pip install -r requirements.txt

# 4. (Opcional) configure o ambiente
copy .env.example .env     # edite se quiser definir GROQ_API_KEY, senha admin, etc.

# 5. Suba o servidor
py run.py
```

### Passo a passo (Linux / macOS)

```bash
cd cymag_saas
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env         # opcional
python run.py
```

Acesse **http://127.0.0.1:5000**. No primeiro boot, o banco
(`instance/cymag.db`) é criado e as contas de teste são semeadas automaticamente.

### Modo demonstração (sem instalar nada)

Abra o `index.html` direto no navegador **ou** clique em
**"▶ Explorar demonstração (sem login)"** na tela de entrada. Tudo roda
client-side (`cymag-demo.js`), sem backend — ideal para apresentar a plataforma
sem subir servidor. Você pode alternar entre os papéis na barra de demonstração.

---

## 5. ★ Painel de IA (admin) — configurar e testar a API

Este é o fluxo que torna a **API fácil de usar**: em vez de editar o `.env` e
reiniciar o servidor, o admin cola a chave na interface, **testa ao vivo** e
**aplica** — o AEGIS fica online na hora.

**Como usar:**

1. Entre como **admin** (`admin@cymag.com` / `cymag-admin`).
2. No menu lateral, abra **IA / AEGIS**.
3. Cole uma **chave de API** (normalmente da Groq — pegue a sua gratuita em
   <https://console.groq.com/keys>). Funciona com a chave de **qualquer conta**.
4. Escolha o **modelo** (há sugestões no campo) e clique em **Testar conexão**.
   - O painel mostra ✅ **latência**, **resposta do modelo** e **uso de tokens**,
     ou ❌ um **erro claro** (ex.: "Chave inválida ou expirada (401)").
5. Se o teste passou, clique em **Aplicar e ativar**. O AEGIS passa a usar essa
   chave imediatamente (sem reiniciar). A configuração fica salva em
   `instance/ai_config.json` e sobrevive a reinícios.
6. **Restaurar padrão** descarta a chave salva e volta ao estado do `.env`.

> **Provedor alternativo:** em *Opções avançadas* você pode trocar a **URL base**
> para qualquer endpoint compatível com o protocolo da OpenAI.

### Como funciona por baixo (segurança)

- A chave **nunca** é devolvida ao cliente nem gravada na auditoria — o backend
  expõe apenas um indicador **mascarado** (ex.: `gsk_…abcd`).
- **Aplicar** só ativa a chave **depois** de um teste real bem-sucedido — nunca
  fica "online" com uma chave que não funciona.
- `instance/` é **gitignored**: a chave salva nunca vai para o repositório.
- Todas as rotas exigem papel `admin` (HTTP 403 para os demais).

**Endpoints (todos exigem admin):**

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/admin/ai/status` | Estado atual (online, modelo, provedor, origem). |
| `POST` | `/api/admin/ai/test` | Testa uma chave ao vivo, **sem** alterar o estado. |
| `POST` | `/api/admin/ai/apply` | Valida e **ativa** a chave em runtime (e persiste). |
| `POST` | `/api/admin/ai/reset` | Descarta a chave salva e volta ao `.env`. |

Corpo de `test`/`apply`:
```json
{ "api_key": "gsk_...", "model": "llama-3.3-70b-versatile", "base_url": "(opcional)", "prompt": "(opcional)" }
```

---

## 6. Principais endpoints da API

| Área | Rota | Descrição |
|---|---|---|
| Auth | `POST /api/login`, `POST /api/logout`, `GET /api/me` | Sessão e identidade. |
| Saúde | `GET /api/health` | Status do serviço e do AEGIS. |
| Planos | `GET /api/plans`, `GET /api/billing/summary` | Catálogo e assinatura. |
| Scan | `POST /api/scan` | Scan completo de um alvo autorizado. |
| Scan | `GET /api/scans`, `GET /api/scans/<id>/findings` | Histórico e achados. |
| IA | `POST /api/remediation`, `POST /api/exploit_chain` | Remediação e cadeia (AEGIS). |
| Autônomo | `POST /api/autonomous/run`, `GET /api/autonomous/<id>` | Pentester autônomo. |
| Engagements | `GET/POST /api/engagements`, `POST /api/engagements/<id>/authorize` | Escopos autorizados. |
| Dono | `GET /api/owner/summary`, `POST /api/owner/budget` | Resumo e decisão de orçamento. |
| Relatórios | `POST /api/report/quick`, `POST /api/report/detailed` | Laudos em PDF. |
| **Admin IA** | `/api/admin/ai/{status,test,apply,reset}` | **Configuração da IA (ver §5).** |

Respostas de erro seguem um padrão: `{ "error": "mensagem" }` com o HTTP status
apropriado (401 não autenticado, 402 recurso fora do plano, 403 sem permissão,
429 quota de scans excedida).

---

## 7. Segurança embutida

- **Autorização por escopo (Engagement):** toda varredura — inclusive a manual —
  exige um engagement autorizado e um alvo dentro do escopo. É a base ética do
  modo autônomo.
- **Sanitização contra prompt injection:** banners, títulos e evidências vindos
  dos **alvos** são hostis por natureza. Antes de entrarem num prompt do AEGIS,
  passam por `sanitize_untrusted` (remove marcadores de papel, frases de injeção
  e delimitadores de bloco). Veja `tests/test_sanitize.py`.
- **Sessões assinadas** (cookie HttpOnly, SameSite=Lax) e **hash de senha**
  (`werkzeug.security`).
- **Entitlements por plano:** recursos (IA, autônomo, gerenciado) são liberados
  conforme o plano da conta, via decorators (`requires_feature`, `enforce_scan_quota`).

---

## 8. Testes

```bash
pytest tests/ -q
```

A suíte cobre a lógica de domínio sem depender de rede: planos, severidade,
tradução de risco de negócio, escopo, billing, sanitização de entrada e a
configuração/runtime do AEGIS (`tests/test_aegis_config.py`).

---

## 9. Variáveis de ambiente (resumo)

| Variável | Padrão | Para que serve |
|---|---|---|
| `GROQ_API_KEY` | — | Liga o AEGIS no boot. (Também dá para configurar pelo painel admin.) |
| `CYMAG_AEGIS_MODEL` | `llama-3.3-70b-versatile` | Modelo padrão do AEGIS. |
| `CYMAG_SECRET_KEY` | gerada em dev | Assina as sessões (obrigatória em produção). |
| `CYMAG_ADMIN_PASSWORD` | `cymag-admin` | Senha do admin semeado. |
| `CYMAG_DB_PATH` | `instance/cymag.db` | Caminho do banco SQLite. |
| `CYMAG_HOST` / `CYMAG_PORT` | `127.0.0.1` / `5000` | Host e porta do servidor. |

Veja `.env.example` para a lista completa.

---

*Dúvida rápida: comece pelo **modo demonstração** para ver a plataforma por cada
papel, depois suba o backend e entre como `admin` para configurar a IA em
**IA / AEGIS**.*
