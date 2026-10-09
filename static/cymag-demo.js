/* ═══════════════════════════════════════════════════════════════════════
   CYMAG Enterprise — Camada de DEMONSTRAÇÃO (100% client-side)

   Objetivo: a plataforma inteira funciona NO NAVEGADOR, sem backend Flask e
   sem nenhuma chamada de IA paga. É isto que permite hospedar o projeto de
   graça (GitHub Pages / Vercel) num portfólio — qualquer pessoa testa tudo
   sem que o dono precise manter um servidor no ar.

   Como funciona: quando `window.CYMAG_DEMO.active === true`, o `api()` do
   cymag.js roteia cada chamada para `window.__demoApi(path, opts)` em vez de
   `fetch`. As respostas têm EXATAMENTE o mesmo formato do backend real, então
   o resto do app não sabe a diferença.

   Toda a lógica de negócio (estimativa de custo das falhas, planos, análise
   do AEGIS offline) é um port fiel de core/business.py, core/plans.py e
   app/ai/aegis.py para JavaScript. Decisões do dono (orçamento) e a troca de
   plano persistem em localStorage, então a experiência sobrevive a um reload.
═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const LS_KEY = "cymag_demo_v1";
  // Estado simulado do painel de IA (apenas no modo demo; não persiste).
  const DEMO_AI = { online: false, model: "llama-3.3-70b-versatile",
    base: "https://api.groq.com/openai/v1", mask: "" };
  function demoAIStatus() {
    return { online: DEMO_AI.online, model: DEMO_AI.model, base_url: DEMO_AI.base,
      provider: DEMO_AI.base === "https://api.groq.com/openai/v1" ? "groq" : "custom",
      source: DEMO_AI.online ? "runtime" : "none", key_mask: DEMO_AI.mask,
      default_base_url: "https://api.groq.com/openai/v1",
      known_models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant",
        "openai/gpt-oss-120b", "openai/gpt-oss-20b",
        "meta-llama/llama-4-scout-17b-16e-instruct", "qwen/qwen3-32b"] };
  }
  const nowISO = () => new Date().toISOString().slice(0, 19);
  const addDaysISO = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 19);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ─────────────────────────────────────────────────────────────────────
     CATÁLOGO DE PLANOS  (espelha core/plans.py)
  ───────────────────────────────────────────────────────────────────── */
  const PLAN_ORDER = ["comunidade", "essencial", "profissional", "gerenciado", "enterprise"];
  const PLANS = {
    comunidade:   { key: "comunidade", name: "Comunidade", price_month: 0, price_year: 0,
      autonomous: false, ai: false, training: false, managed: false,
      scans_per_month: 1, max_ips: 1, report_level: "watermark", managed_cadence_days: 0,
      tagline: "Experimente: um scan manual em um alvo.", audience: "Avaliação e uso educacional" },
    essencial:    { key: "essencial", name: "Essencial", price_month: 297, price_year: 2970,
      autonomous: true, ai: false, training: false, managed: false,
      scans_per_month: 10, max_ips: 256, report_level: "clean", managed_cadence_days: 0,
      tagline: "O agente autônomo na mão da sua equipe. Você mesmo roda.", audience: "PME que quer autonomia sem contratar um time" },
    profissional: { key: "profissional", name: "Profissional", price_month: 897, price_year: 8970,
      autonomous: true, ai: true, training: true, managed: false,
      scans_per_month: 50, max_ips: 1024, report_level: "ai", managed_cadence_days: 0,
      tagline: "IA copiloto: seu único analista rende como um time. Com treinamento.", audience: "PME com um profissional de TI/segurança sobrecarregado" },
    gerenciado:   { key: "gerenciado", name: "Gerenciado", price_month: 3900, price_year: 39000,
      autonomous: true, ai: true, training: true, managed: true,
      scans_per_month: null, max_ips: null, report_level: "signed", managed_cadence_days: 60,
      tagline: "A CYMAG faz o pentest a cada 2 meses e assina o laudo (LGPD/ISO/PCI).", audience: "PME que precisa de laudo e acompanhamento recorrente" },
    enterprise:   { key: "enterprise", name: "Enterprise", price_month: 6000, price_year: 72000,
      autonomous: true, ai: true, training: true, managed: true,
      scans_per_month: null, max_ips: null, report_level: "white_label", managed_cadence_days: 30,
      tagline: "Contínuo, dedicado, integrações e OT/IoT. Sob consulta.", audience: "Empresas maiores, financeiro e ambientes OT/IoT" },
  };
  const planView = (key) => {
    const p = PLANS[key] || PLANS.comunidade;
    return { key: p.key, name: p.name, autonomous: p.autonomous, ai: p.ai, training: p.training,
      managed: p.managed, scans_per_month: p.scans_per_month, report_level: p.report_level };
  };

  /* ─────────────────────────────────────────────────────────────────────
     LÓGICA DE NEGÓCIO  (espelha core/business.py — custo das falhas)
  ───────────────────────────────────────────────────────────────────── */
  const AREA = {
    database: { label: "Banco de dados exposto",
      problem: "Um banco de dados da empresa está acessível pela rede sem a proteção adequada — é onde costumam ficar dados de clientes, financeiro e operação.",
      fix: "Fechar o acesso do banco para fora, exigir senha forte e aplicar as atualizações do fabricante.",
      loss: [200000, 6200000], fix_cost: [4000, 18000] },
    web: { label: "Site ou sistema web vulnerável",
      problem: "Um site ou sistema web da empresa tem uma falha que pode deixar um invasor roubar dados ou assumir o sistema.",
      fix: "Corrigir a falha na aplicação, remover arquivos sensíveis expostos e trocar senhas padrão.",
      loss: [150000, 4000000], fix_cost: [3000, 15000] },
    smb_ad: { label: "Rede Windows / domínio vulnerável",
      problem: "O compartilhamento de arquivos ou o controlador de domínio Windows tem uma falha que pode dar acesso a toda a rede interna.",
      fix: "Aplicar as atualizações de segurança da Microsoft e ativar as proteções de assinatura de rede (SMB signing).",
      loss: [300000, 5100000], fix_cost: [5000, 20000] },
    iot_ot: { label: "Equipamento industrial / IoT exposto",
      problem: "Um equipamento de automação (IoT/OT) está acessível sem proteção. Um ataque aqui pode parar a operação física.",
      fix: "Isolar o equipamento em uma rede separada e exigir autenticação no broker/painel de controle.",
      loss: [500000, 8700000], fix_cost: [8000, 40000] },
    remote_access: { label: "Acesso remoto exposto",
      problem: "Um serviço de acesso remoto (SSH, RDP, VNC ou FTP) está aberto e pode ser usado para invadir a máquina.",
      fix: "Restringir o acesso remoto a redes confiáveis (VPN) e exigir senha forte com duplo fator (2FA).",
      loss: [100000, 3800000], fix_cost: [2000, 12000] },
  };
  const AREA_DEFAULT = { label: "Exposição de ativo",
    problem: "Um ativo da empresa está exposto de uma forma que pode ser explorada por um invasor.",
    fix: "Fechar o acesso desnecessário e aplicar as atualizações de segurança.",
    loss: [80000, 2500000], fix_cost: [2000, 10000] };
  const SEV_LOSS = { crit: 1.0, high: 0.65, med: 0.35, low: 0.15, info: 0.05 };
  const SEV_FIX = { crit: 1.0, high: 0.8, med: 0.6, low: 0.45, info: 0.35 };
  const SEV_PT = { crit: "Crítico", high: "Alto", med: "Médio", low: "Baixo", info: "Informativo" };
  const SEV_ORD = { crit: 0, high: 1, med: 2, low: 3, info: 4 };
  const SEV_W = { crit: 15, high: 8, med: 3, low: 1, info: 0 };

  const areaOf = (f) => AREA[f.category] || AREA_DEFAULT;
  const scale = (rng, k) => [Math.round(rng[0] * k), Math.round(rng[1] * k)];
  const lossEst = (f) => scale(areaOf(f).loss, SEV_LOSS[f.sev] ?? 0.2);
  const fixCost = (f) => scale(areaOf(f).fix_cost, SEV_FIX[f.sev] ?? 0.5);
  function brlShort(v) {
    v = Number(v);
    if (v >= 1e6) { let s = (v / 1e6).toFixed(1).replace(".", ",").replace(/,0$/, ""); return `R$ ${s} mi`; }
    if (v >= 1e3) return `R$ ${Math.round(v / 1e3)} mil`;
    return `R$ ${Math.round(v)}`;
  }
  const brlRange = ([lo, hi]) => (lo === hi ? brlShort(hi) : `${brlShort(lo)}–${brlShort(hi)}`);
  function businessItem(f) {
    const a = areaOf(f), loss = lossEst(f), fix = fixCost(f);
    return { finding_id: f.finding_id, title: f.title || a.label, area_label: a.label,
      severity: f.sev, severity_label: SEV_PT[f.sev] || "Informativo", host: f.host, port: f.port,
      problem: a.problem, fix: a.fix,
      loss_min: loss[0], loss_max: loss[1], loss_label: brlRange(loss),
      fix_cost_min: fix[0], fix_cost_max: fix[1], fix_cost_label: brlRange(fix) };
  }
  function summarize(findings) {
    const bySev = { crit: 0, high: 0, med: 0, low: 0, info: 0 };
    let lmin = 0, lmax = 0, fmin = 0, fmax = 0, budget = 0, auth = 0, pend = 0, dism = 0;
    for (const f of findings) {
      bySev[f.sev] = (bySev[f.sev] || 0) + 1;
      const st = f.decision && f.decision.status;
      if (st === "authorized") { auth++; budget += Number((f.decision && f.decision.budget) || 0); }
      else if (st === "dismissed") { dism++; }
      else { pend++; const [a, b] = lossEst(f), [c, d] = fixCost(f); lmin += a; lmax += b; fmin += c; fmax += d; }
    }
    return { by_severity: bySev, total: findings.length, pending: pend, authorized: auth, dismissed: dism,
      open_loss_min: lmin, open_loss_max: lmax, open_loss_label: brlRange([lmin, lmax]),
      open_fix_min: fmin, open_fix_max: fmax, open_fix_label: brlRange([fmin, fmax]),
      authorized_budget: budget, authorized_budget_label: brlShort(budget) };
  }
  const riskScore = (fs) => Math.min(100, fs.reduce((t, f) => t + (SEV_W[f.sev] ?? 1), 0));
  const sortKey = (a, b) => (SEV_ORD[a.sev] ?? 9) - (SEV_ORD[b.sev] ?? 9) || (b.cvss || 0) - (a.cvss || 0);

  /* ─────────────────────────────────────────────────────────────────────
     AEGIS OFFLINE  (espelha app/ai/aegis.py — análise determinística)
  ───────────────────────────────────────────────────────────────────── */
  function offlineExecRisk(v) {
    const t = (v.title || "").toLowerCase();
    if (/mqtt|scada|ot/.test(t)) return { risk: "Sabotagem OT/IoT", category: "Operações", impact: "R$ 8.7M", probability: "Muito Alta" };
    if (/sql|injection/.test(t)) return { risk: "Exfiltração DB — LGPD", category: "Compliance", impact: "R$ 12.4M", probability: "Alta" };
    if (/redis|mongo|elastic/.test(t)) return { risk: "Exposição de dados — LGPD", category: "Dados", impact: "R$ 6.2M", probability: "Alta" };
    if (/smb|ntlm|eternal/.test(t)) return { risk: "Comprometimento de domínio", category: "Identidade", impact: "R$ 5.1M", probability: "Alta" };
    if (/credencial|padr[ãa]o|senha/.test(t)) return { risk: "Acesso não autorizado", category: "Identidade", impact: "R$ 3.8M", probability: "Muito Alta" };
    return { risk: "Exposição de ativo crítico", category: "Tecnologia", impact: "R$ 2.5M", probability: "Média" };
  }
  function offlineSecops(v) {
    const host = v.host || "ALVO_IP", port = v.port || 0;
    return {
      steps: [
        `1. Confirmar vulnerabilidade: ${v.title} em ${host}:${port}`,
        "2. Isolar o ativo afetado da rede produtiva imediatamente",
        "3. Coletar evidências (logs, pacotes) antes de aplicar correção",
        "4. Aplicar patch ou mitigação conforme orientação do fabricante",
        "5. Validar correção com re-scan pós-remediação",
      ],
      commands: `# Verificar porta\nnmap -Pn -sV -p ${port} ${host}\n\n# Isolar host temporariamente (Linux)\nsudo iptables -I INPUT -s ${host} -j DROP\n\n# Re-scan pós-patch\nnmap -Pn -sV -p ${port} ${host}`,
      attack_chain: "Acesso inicial → escalação local → movimento lateral",
      cvss: v.cvss || 7.0, mitre_tactics: ["T1190", "T1059"], next_recon: `nmap -Pn -sV -A -p- ${host}`,
    };
  }
  function offlineExec(v) {
    const r = offlineExecRisk(v);
    return {
      rationale: `A vulnerabilidade '${v.title}' no ativo ${v.host}:${v.port} expõe a organização a prejuízo estimado em ${r.impact}. Risco: ${r.risk}. Probabilidade de exploração ativa: ${r.probability}.`,
      financial_impact: r.impact, regulatory_risk: "LGPD Art. 52 / ISO 27001 A.12.6 / PCI-DSS 6.3",
      email: `Assunto: [URGENTE] Vulnerabilidade Crítica Identificada — Ação Imediata Necessária\n\nPrezado(a) CTO/CEO,\n\nNossa plataforma CYMAG identificou a vulnerabilidade '${v.title}' no ativo ${v.host}:${v.port} (severidade: ${(v.sev || "N/A").toUpperCase()}).\n\nImpacto financeiro estimado: ${r.impact} (${r.risk}).\n\nSolicito aprovação para isolamento imediato do ativo e início do processo de remediação.\n\nReferência: ${v.cve || "N/A"} | CVSS: ${v.cvss || 0}\n\nAtenciosamente,\nEquipe de Segurança da Informação`,
    };
  }
  function offlineChain(findings) {
    const top = findings.slice().sort((a, b) => (b.cvss || 0) - (a.cvss || 0))[0] || {};
    const second = findings.filter((f) => f.category === "smb_ad" || f.category === "remote_access")[0] || top;
    return {
      initial_vector: { finding_title: top.title, host: top.host, port: top.port, why: "Maior CVSS do conjunto e exploração pública conhecida — acesso inicial de menor atrito." },
      attack_steps: [
        { step: 1, action: `Explorar ${top.title}`, command: `# acesso inicial em ${top.host}:${top.port}`, expected_result: "Acesso inicial / leitura de dados" },
        { step: 2, action: "Coletar credenciais e enumerar a rede interna", command: "# dump de credenciais + enum interna", expected_result: "Credenciais válidas" },
        { step: 3, action: `Movimento lateral para ${second.host}`, command: `# pivot para ${second.host}:${second.port}`, expected_result: "Comprometimento de host adicional" },
        { step: 4, action: "Escalar para administrador de domínio / root", command: "# escalonamento de privilégios", expected_result: "Controle total" },
      ],
      blast_radius: "Comprometimento de dados de clientes, rede Windows e operação — potencial de ransomware.",
      critical_path: findings.slice(0, 3).map((f) => `${f.host}:${f.port}`),
      estimated_time_to_root: "20–40 minutos", mitre_chain: ["TA0001", "TA0006", "TA0008", "TA0004"],
    };
  }

  /* ─────────────────────────────────────────────────────────────────────
     DADOS SEMEADOS  (uma história coerente para a demonstração)
  ───────────────────────────────────────────────────────────────────── */
  const SCAN_TARGET = "192.168.0.0/24";
  const FINDINGS_SEED = [
    { title: "Redis exposto sem autenticação", category: "database", sev: "crit", cvss: 9.8, cve: "CWE-306",
      host: "192.168.0.15", port: 6379, banner: "Redis 6.0.16",
      desc: "Servidor Redis acessível pela rede sem senha. Permite ler/escrever qualquer chave e, com CONFIG SET, escrever arquivos no disco (RCE).",
      evidence: "INFO retornou dados do servidor sem AUTH; CONFIG GET requirepass = (vazio)." },
    { title: "MongoDB sem autenticação", category: "database", sev: "crit", cvss: 9.1, cve: "CWE-306",
      host: "192.168.0.15", port: 27017, banner: "MongoDB 4.4.6",
      desc: "Banco MongoDB aceita conexões anônimas com permissão total de leitura e escrita nas coleções.",
      evidence: "listDatabases retornou 'clientes', 'financeiro' e 'pedidos' sem credenciais." },
    { title: "Elasticsearch aberto", category: "database", sev: "high", cvss: 7.5, cve: "CWE-306",
      host: "192.168.0.15", port: 9200, banner: "Elasticsearch 7.10",
      desc: "Cluster Elasticsearch exposto sem autenticação; índices com dados pessoais consultáveis por qualquer um.",
      evidence: "GET /_cat/indices listou índices 'logs-clientes-*'." },
    { title: "MySQL com credencial padrão (root/root)", category: "database", sev: "high", cvss: 8.2, cve: "CWE-521",
      host: "192.168.0.15", port: 3306, banner: "MySQL 5.7.33",
      desc: "Servidor MySQL aceita login root com a senha padrão. Acesso administrativo total ao banco.",
      evidence: "Login bem-sucedido com root:root." },
    { title: "SQL Injection em /login.php", category: "web", sev: "crit", cvss: 9.3, cve: "CWE-89",
      host: "192.168.0.10", port: 80, banner: "Apache/2.4.41 (Ubuntu)",
      desc: "Parâmetro 'user' concatenado diretamente na consulta SQL. Permite bypass de login e extração do banco.",
      evidence: "Payload ' OR '1'='1 retornou sessão autenticada." },
    { title: "Diretório .git exposto", category: "web", sev: "high", cvss: 7.5, cve: "CWE-538",
      host: "192.168.0.10", port: 443, banner: "nginx/1.18.0",
      desc: "Pasta .git acessível publicamente permite baixar o código-fonte completo e segredos commitados.",
      evidence: "GET /.git/config retornou 200 com a URL do repositório." },
    { title: "Painel administrativo com senha padrão", category: "web", sev: "high", cvss: 8.0, cve: "CWE-521",
      host: "192.168.0.10", port: 8080, banner: "Apache Tomcat/9.0.45",
      desc: "Console do Tomcat Manager acessível com admin/admin — permite deploy de WAR malicioso (RCE).",
      evidence: "Login admin:admin aceito em /manager/html." },
    { title: "Provável EternalBlue (MS17-010)", category: "smb_ad", sev: "crit", cvss: 9.8, cve: "CVE-2017-0144",
      host: "192.168.0.20", port: 445, banner: "Windows Server 2012 R2 — SMBv1",
      desc: "Host responde a SMBv1 e aparenta não ter o patch MS17-010 — explorável remotamente para execução de código (WannaCry).",
      evidence: "SMBv1 habilitado; resposta compatível com alvo não corrigido." },
    { title: "SMB signing desabilitado", category: "smb_ad", sev: "med", cvss: 5.3, cve: "CWE-287",
      host: "192.168.0.20", port: 445, banner: "Windows Server 2012 R2",
      desc: "Assinatura SMB não exigida, viabilizando ataques de NTLM relay dentro da rede.",
      evidence: "Negociação SMB indicou signing: not required." },
    { title: "Broker MQTT sem autenticação", category: "iot_ot", sev: "crit", cvss: 9.4, cve: "CWE-306",
      host: "192.168.0.30", port: 1883, banner: "Eclipse Mosquitto 1.6.9",
      desc: "Broker MQTT aceita conexões anônimas com permissão de publicar e assinar — controle de dispositivos de automação.",
      evidence: "SUBSCRIBE em '#' recebeu telemetria de sensores; PUBLISH aceito." },
    { title: "SSH exposto com autenticação por senha", category: "remote_access", sev: "med", cvss: 6.5, cve: "CWE-262",
      host: "192.168.0.40", port: 22, banner: "OpenSSH 8.2p1 Ubuntu",
      desc: "SSH acessível com login por senha habilitado e sem limite de tentativas — sujeito a força bruta.",
      evidence: "Banner OpenSSH; PasswordAuthentication yes." },
    { title: "RDP exposto à rede", category: "remote_access", sev: "high", cvss: 7.8, cve: "CVE-2019-0708",
      host: "192.168.0.40", port: 3389, banner: "Microsoft Terminal Services",
      desc: "Serviço RDP acessível; versão potencialmente vulnerável a BlueKeep (pré-autenticação, worm).",
      evidence: "3389/tcp aberto; handshake RDP compatível com alvo legado." },
  ];

  const AREAS_SEED = {
    recon: { label: "Reconhecimento", desc: "Descoberta de hosts e portas abertas", services: [] },
    web: { label: "Web / OWASP", desc: "SQLi, traversal, arquivos sensíveis, credenciais padrão",
      services: [{ name: "HTTP/HTTPS", ports: [80, 443, 8080, 8443] }] },
    database: { label: "Bancos de Dados", desc: "MySQL, PostgreSQL, Redis, MongoDB, Elasticsearch",
      services: [{ name: "MySQL", ports: [3306] }, { name: "Redis", ports: [6379] }, { name: "MongoDB", ports: [27017] }, { name: "Elasticsearch", ports: [9200] }, { name: "PostgreSQL", ports: [5432] }] },
    smb_ad: { label: "SMB / Active Directory", desc: "Signing, EternalBlue, enumeração de shares",
      services: [{ name: "SMB", ports: [139, 445] }] },
    iot_ot: { label: "IoT / OT / SCADA", desc: "Brokers MQTT, painéis Node-RED",
      services: [{ name: "MQTT", ports: [1883, 8883] }, { name: "Node-RED", ports: [1880] }] },
    remote_access: { label: "Acesso Remoto", desc: "SSH, Telnet, VNC, RDP, FTP",
      services: [{ name: "SSH", ports: [22] }, { name: "RDP", ports: [3389] }, { name: "VNC", ports: [5900] }, { name: "FTP", ports: [21] }, { name: "Telnet", ports: [23] }] },
    post_exploit: { label: "Pós-exploração", desc: "Encadeamento e movimento lateral (planejado pela IA)", services: [] },
  };

  const USERS = {
    owner:    { id: 2, email: "dono@pme.com",        name: "Ana — Dona da PME",       role: "owner",    view: "owner",     is_staff: false, account: { id: 2, name: "PME Demo Ltda" } },
    operator: { id: 3, email: "ti@pme.com",          name: "Bruno — Analista de TI",  role: "operator", view: "secops",    is_staff: false, account: { id: 2, name: "PME Demo Ltda" } },
    viewer:   { id: 7, email: "diretoria@pme.com",   name: "Diretoria",               role: "viewer",   view: "executive", is_staff: false, account: { id: 2, name: "PME Demo Ltda" } },
    cymag:    { id: 4, email: "consultor@cymag.com", name: "Consultor CYMAG",         role: "cymag",    view: "secops",    is_staff: true,  account: { id: 1, name: "CYMAG (equipe)" } },
    admin:    { id: 1, email: "admin@cymag.com",     name: "Administrador",           role: "admin",    view: "secops",    is_staff: true,  account: { id: 1, name: "CYMAG (equipe)" } },
  };

  /* ─────────────────────────────────────────────────────────────────────
     ESTADO PERSISTENTE (localStorage)
  ───────────────────────────────────────────────────────────────────── */
  const DEFAULT_STATE = {
    role: "owner", planKey: "profissional", cycle: "month",
    budget: {}, engagements: null, nextEngId: 100, scanDone: true, runs: {},
  };
  function load() {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return Object.assign({}, DEFAULT_STATE, JSON.parse(raw)); }
    catch (e) {}
    return clone(DEFAULT_STATE);
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(ST)); } catch (e) {} }
  const ST = load();
  if (!ST.engagements) {
    ST.engagements = [
      { id: 1, name: "Rede do escritório", client: "", scope: ["192.168.0.0/24"], status: "authorized", created_at: addDaysISO(-12), authorized_at: addDaysISO(-12) },
      { id: 2, name: "Servidores de produção", client: "", scope: ["10.0.0.0/24"], status: "draft", created_at: addDaysISO(-3) },
    ];
    save();
  }

  // findings com finding_id estável
  const FINDINGS = FINDINGS_SEED.map((f, i) => Object.assign({ finding_id: i + 1 }, f));
  const SCAN = { id: 1001, target: SCAN_TARGET, status: "done", risk_score: riskScore(FINDINGS),
    findings_count: FINDINGS.length, started_at: addDaysISO(-1), finished_at: addDaysISO(-1), review_status: "none" };
  const HISTORY = [
    SCAN,
    { id: 1000, target: "192.168.0.10", status: "done", risk_score: 41, findings_count: 3, started_at: addDaysISO(-8), finished_at: addDaysISO(-8), review_status: "none" },
    { id: 999, target: "192.168.0.40", status: "done", risk_score: 22, findings_count: 2, started_at: addDaysISO(-20), finished_at: addDaysISO(-20), review_status: "none" },
  ];

  function currentUser() {
    const u = clone(USERS[ST.role] || USERS.owner);
    const pk = u.is_staff ? "enterprise" : ST.planKey;
    u.plan = planView(pk);
    return u;
  }
  function withDecisions(list) {
    return list.map((f) => { const d = ST.budget[f.finding_id]; return d ? Object.assign(clone(f), { decision: d }) : clone(f); });
  }
  const execRisksFor = (list) => list.map(offlineExecRisk);

  /* ─────────────────────────────────────────────────────────────────────
     SIMULAÇÃO DE SCAN / OPERAÇÃO AUTÔNOMA
  ───────────────────────────────────────────────────────────────────── */
  function findingsForTarget(target) {
    const t = (target || "").trim();
    if (!t || t.includes("/")) return FINDINGS;            // CIDR → tudo
    const sub = FINDINGS.filter((f) => f.host === t);      // host único
    return sub.length ? sub : FINDINGS;
  }
  function buildRunEvents(target, findings, aiOn) {
    const hosts = [...new Set(findings.map((f) => f.host))];
    const ev = [];
    const push = (phase, message, data) => ev.push({ ts: nowISO(), phase, message, data: data || {} });
    push("start", `Iniciando operação autônoma em ${target}`);
    push("recon", `Descobrindo hosts ativos em ${target}…`);
    push("recon", `${hosts.length} host(s) ativo(s).`, { hosts });
    for (const h of hosts) {
      const hf = findings.filter((f) => f.host === h);
      const ports = [...new Set(hf.map((f) => f.port))];
      push("enum", `Enumerando serviços em ${h}…`, { host: h });
      push("enum", `${h}: ${ports.length} porta(s) aberta(s).`, { host: h, ports });
      push("exploit", `Analisando vulnerabilidades em ${h}…`, { host: h });
      for (const f of hf) push("finding", `[${f.sev.toUpperCase()}] ${f.title} em ${h}:${f.port}`, { finding: f.title, sev: f.sev });
    }
    push("ai", "AEGIS planejando a cadeia de ataque…");
    push("ai", "Plano de ataque " + (aiOn ? "gerado." : "indisponível (modo offline)."));
    push("done", `Operação concluída: ${findings.length} achado(s), score ${riskScore(findings)}/100.`,
      { risk_score: riskScore(findings), findings_total: findings.length });
    return ev;
  }
  function runReport(target, findings, aiOn) {
    const bySev = {}, byArea = {};
    findings.forEach((f) => { bySev[f.sev] = (bySev[f.sev] || 0) + 1; byArea[f.category] = (byArea[f.category] || 0) + 1; });
    return { target, generated_at: nowISO(), hosts_scanned: new Set(findings.map((f) => f.host)).size,
      hosts: [...new Set(findings.map((f) => f.host))], findings_total: findings.length, risk_score: riskScore(findings),
      by_severity: bySev, by_area: byArea, top_findings: findings.slice().sort((a, b) => (b.cvss || 0) - (a.cvss || 0)).slice(0, 10),
      findings, attack_plan: aiOn ? offlineChain(findings) : null };
  }

  /* ─────────────────────────────────────────────────────────────────────
     ROTEADOR DA API FALSA
  ───────────────────────────────────────────────────────────────────── */
  function reject(status, error, extra) { return Promise.reject(Object.assign(new Error(error), { status, data: Object.assign({ error }, extra || {}) })); }

  async function demoApi(path, opts) {
    opts = opts || {};
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body || {};
    const url = path.split("?")[0];
    const qs = new URLSearchParams((path.split("?")[1]) || "");
    await delay(method === "GET" ? 90 : 230);   // latência leve, para parecer real

    // ── auth / identidade ──
    if (url === "/api/me") return Object.assign({ authenticated: true }, identity());
    if (url === "/api/login" && method === "POST") return identity();
    if (url === "/api/logout") return { ok: true };

    // ── IA / AEGIS (painel admin) — simulado no modo demo ──
    if (url === "/api/admin/ai/status") return demoAIStatus();
    if (url === "/api/admin/ai/test" && method === "POST") {
      if (!(body.api_key || "").trim()) return reject(400, "Informe uma chave de API para testar.");
      return { ok: true, latency_ms: 540 + Math.floor(Math.random() * 480),
        model: (body.model || DEMO_AI.model), provider: (body.base_url && body.base_url !== DEMO_AI.base ? "custom" : "groq"),
        answer: "AEGIS operacional. Pronto para analisar vulnerabilidades, estimar impacto financeiro e sugerir remediação. (resposta simulada no modo demonstração)",
        usage: { prompt_tokens: 38, completion_tokens: 41, total_tokens: 79 } };
    }
    if (url === "/api/admin/ai/apply" && method === "POST") {
      if (!(body.api_key || "").trim()) return reject(400, "Informe uma chave de API para aplicar.");
      DEMO_AI.online = true; DEMO_AI.model = body.model || DEMO_AI.model;
      DEMO_AI.base = body.base_url || DEMO_AI.base; DEMO_AI.mask = "demo…" + (body.api_key.trim().slice(-4) || "key");
      return { ok: true, status: demoAIStatus() };
    }
    if (url === "/api/admin/ai/reset" && method === "POST") {
      DEMO_AI.online = false; DEMO_AI.mask = ""; return { ok: true, status: demoAIStatus() };
    }

    if (url === "/api/account") {
      const u = currentUser(), pk = u.is_staff ? "enterprise" : ST.planKey, p = PLANS[pk];
      return { account: { id: u.account.id, name: u.account.name, onboarding_done: pk !== "comunidade",
          managed_cadence_days: p.managed_cadence_days, next_managed_at: p.managed_cadence_days ? addDaysISO(p.managed_cadence_days) : null },
        plan: Object.assign(planView(pk), { tagline: p.tagline, price_month: p.price_month }),
        team: (ST.role === "owner" || u.is_staff) ? [
          { id: 2, email: "dono@pme.com", name: "Ana — Dona da PME", role: "owner", last_login: addDaysISO(0) },
          { id: 3, email: "ti@pme.com", name: "Bruno — Analista de TI", role: "operator", last_login: addDaysISO(-1) },
          { id: 7, email: "diretoria@pme.com", name: "Diretoria", role: "viewer", last_login: addDaysISO(-5) },
        ] : [] };
    }
    if (url === "/api/accounts") return { accounts: [
      { id: 2, name: "PME Demo Ltda", plan: ST.planKey, managed_cadence_days: PLANS[ST.planKey].managed_cadence_days, next_managed_at: PLANS[ST.planKey].managed_cadence_days ? addDaysISO(PLANS[ST.planKey].managed_cadence_days) : null },
      { id: 3, name: "Loja Verde", plan: "gerenciado", managed_cadence_days: 60, next_managed_at: addDaysISO(14) },
      { id: 5, name: "Clínica Bem-Estar", plan: "gerenciado", managed_cadence_days: 60, next_managed_at: addDaysISO(31) },
    ] };

    // ── planos / billing ──
    if (url === "/api/plans") return { plans: PLAN_ORDER.map((k) => Object.assign({}, PLANS[k])) };
    if (url === "/api/billing/summary") {
      const p = PLANS[ST.planKey];
      return { plan: { key: p.key, name: p.name, price_month: p.price_month, price_year: p.price_year, tagline: p.tagline },
        cycle: ST.cycle, amount: ST.cycle === "year" ? p.price_year : p.price_month,
        managed_cadence_days: p.managed_cadence_days, next_managed_at: p.managed_cadence_days ? addDaysISO(p.managed_cadence_days) : null,
        next_charge_at: p.price_month === 0 ? null : addDaysISO(ST.cycle === "year" ? 365 : 30) };
    }
    if (url === "/api/account/plan" && method === "POST") {
      const pk = (body.plan || "").toLowerCase(), cycle = body.cycle === "year" ? "year" : "month";
      if (!PLANS[pk]) return reject(400, "Plano inválido.");
      if (pk === "enterprise") return reject(409, "O plano Enterprise é sob consulta. Fale com o time comercial.", { contact: true });
      if (pk === ST.planKey) return reject(409, "Este já é o plano atual da sua conta.", { plan: pk });
      const prev = ST.planKey; ST.planKey = pk; ST.cycle = cycle; save();
      const p = PLANS[pk];
      return { ok: true, previous: prev, plan: Object.assign(planView(pk), { tagline: p.tagline, price_month: p.price_month }),
        cycle, amount: cycle === "year" ? p.price_year : p.price_month,
        next_charge_at: p.price_month === 0 ? null : addDaysISO(cycle === "year" ? 365 : 30), managed_cadence_days: p.managed_cadence_days };
    }

    // ── engagements ──
    if (url === "/api/engagements" && method === "GET") return { engagements: clone(ST.engagements) };
    if (url === "/api/engagements" && method === "POST") {
      const eng = { id: ST.nextEngId++, name: body.name || "Novo engagement", client: body.client || "",
        scope: body.scope || [], status: "draft", created_at: nowISO() };
      ST.engagements.unshift(eng); save(); return clone(eng);
    }
    const authM = url.match(/^\/api\/engagements\/(\d+)\/authorize$/);
    if (authM && method === "POST") {
      const e = ST.engagements.find((x) => x.id === Number(authM[1]));
      if (!e) return reject(404, "Engagement não encontrado.");
      e.status = "authorized"; e.authorized_at = nowISO(); save(); return clone(e);
    }
    const engM = url.match(/^\/api\/engagements\/(\d+)$/);
    if (engM) { const e = ST.engagements.find((x) => x.id === Number(engM[1])); return e ? clone(e) : reject(404, "Engagement não encontrado."); }

    // ── áreas / scans / histórico ──
    if (url === "/api/areas") return { areas: clone(AREAS_SEED) };
    if (url === "/api/auto_discover") return { subnets: [{ subnet: "192.168.0.0/24" }, { subnet: "10.0.0.0/24" }] };
    if (url === "/api/scans") return { scans: clone(HISTORY) };
    const sfM = url.match(/^\/api\/scans\/(\d+)\/findings$/);
    if (sfM) {
      const id = Number(sfM[1]);
      if (id === SCAN.id) return { scan_id: id, findings: clone(FINDINGS) };
      return { scan_id: id, findings: clone(FINDINGS.slice(0, id === 1000 ? 3 : 2)) };
    }
    const revM = url.match(/^\/api\/scans\/(\d+)\/review$/);
    if (revM && method === "POST") return { scan_id: Number(revM[1]), review_status: body.status, reviewed_by: currentUser().id };
    if (url === "/api/reviews") return { queue: [
      { id: 1001, target: SCAN_TARGET, findings_count: FINDINGS.length, risk_score: SCAN.risk_score, finished_at: SCAN.finished_at, started_at: SCAN.started_at },
    ] };

    if (url === "/api/scan" && method === "POST") {
      const target = body.target || "192.168.0.0/24";
      const list = clone(findingsForTarget(target));
      const aiOn = currentUser().plan.ai;
      return { scan_id: SCAN.id, target, engagement_id: body.engagement_id || 1,
        cyber_vulns: list, exec_risks: execRisksFor(list), risk_score: riskScore(list), ai_enabled: aiOn, review_status: "none" };
    }

    // ── autônomo ──
    if (url === "/api/autonomous/run" && method === "POST") {
      const target = body.target || "192.168.0.0/24";
      const list = clone(findingsForTarget(target));
      const aiOn = currentUser().plan.ai;
      const runId = "demo-" + Date.now();
      ST.runs[runId] = { startedAt: Date.now(), events: buildRunEvents(target, list, aiOn), target,
        report: runReport(target, list, aiOn), scanId: SCAN.id };
      // não persistimos runs no localStorage (voláteis); guardamos em memória
      return { run_id: runId, scan_id: SCAN.id, target, status: "running" };
    }
    const runM = url.match(/^\/api\/autonomous\/([\w-]+)$/);
    if (runM) {
      const r = ST.runs[runM[1]];
      if (!r) return reject(404, "Run não encontrado.");
      const since = Number(qs.get("since") || 0);
      const perEv = 650;                                   // ms por evento revelado
      const revealed = Math.min(r.events.length, Math.floor((Date.now() - r.startedAt) / perEv) + 2);
      const done = revealed >= r.events.length;
      return { run_id: runM[1], status: done ? "done" : "running", target: r.target, scan_id: r.scanId,
        error: null, event_count: revealed, events: r.events.slice(since, revealed), report: done ? r.report : null };
    }

    // ── IA (remediação / cadeia) ──
    if (url === "/api/remediation" && method === "POST") {
      const v = body.vuln || {};
      return body.persona === "exec" ? offlineExec(v) : offlineSecops(v);
    }
    if (url === "/api/exploit_chain" && method === "POST") {
      const f = body.findings || [];
      return f.length ? offlineChain(f) : reject(400, "Nenhum finding fornecido");
    }

    // ── dono: resumo + orçamento ──
    if (url === "/api/owner/summary") {
      const list = withDecisions(FINDINGS);
      const sum = summarize(list);
      const top = list.slice().sort(sortKey).slice(0, 20).map((f) => {
        const item = businessItem(f); const d = ST.budget[f.finding_id];
        item.decision = d ? { status: d.status, budget: d.budget, note: d.note, decided_by_name: d.decided_by_name, decided_at: d.decided_at } : null;
        return item;
      });
      return { account: { name: "PME Demo Ltda", managed_cadence_days: PLANS[ST.planKey].managed_cadence_days },
        plan: { name: PLANS[ST.planKey].name, ai: PLANS[ST.planKey].ai },
        scan: { id: SCAN.id, target: SCAN.target, risk_score: SCAN.risk_score, findings_count: SCAN.findings_count, finished_at: SCAN.finished_at },
        problems: top, summary: sum };
    }
    if (url === "/api/owner/budget" && method === "POST") {
      const fid = body.finding_id;
      if (!Number.isInteger(fid)) return reject(400, "finding_id (inteiro) é obrigatório.");
      const status = body.status === "dismissed" ? "dismissed" : "authorized";
      ST.budget[fid] = { status, budget: body.budget != null ? Number(body.budget) : null, note: body.note || null,
        decided_by_name: currentUser().name, decided_at: nowISO() };
      save();
      return { finding_id: fid, status, budget: ST.budget[fid].budget };
    }

    return reject(404, "Recurso não encontrado (demo): " + url);
  }

  function identity() {
    const u = currentUser();
    return { id: u.id, email: u.email, name: u.name, role: u.role, view: u.view,
      is_staff: u.is_staff, account: u.account, plan: u.plan };
  }

  /* ─────────────────────────────────────────────────────────────────────
     API PÚBLICA DO MÓDULO DEMO (consumida pelo cymag.js)
  ───────────────────────────────────────────────────────────────────── */
  window.__demoApi = demoApi;
  window.CYMAG_DEMO = {
    get active() { return this._active; },
    _active: false,
    roles: ["owner", "operator", "viewer", "cymag", "admin"],
    roleLabels: { owner: "Dono", operator: "Analista de TI", viewer: "Diretoria", cymag: "Equipe CYMAG", admin: "Admin" },
    get role() { return ST.role; },
    setRole(r) { if (USERS[r]) { ST.role = r; save(); } },
    enable() { this._active = true; },
    identity,
    reset() { try { localStorage.removeItem(LS_KEY); } catch (e) {} Object.assign(ST, clone(DEFAULT_STATE)); ST.engagements = null; },
  };
})();
