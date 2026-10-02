/* ═══════════════════════════════════════════════════════════════════════
   CYMAG Enterprise — Frontend (Fase 5)
   SPA conectada a toda a API: auth, scan, autônomo, engagements, áreas,
   histórico, visão executiva e relatórios PDF.
═══════════════════════════════════════════════════════════════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = { user: null, lastScan: null, engagements: [], section: null, autoTimer: null };

/* Feature liberada pelo plano DA CONTA (autonomous | ai | training | managed). */
const hasFeature = (f) => !!(state.user && state.user.plan && state.user.plan[f]);
const ROLE_LABEL = { owner: "Dono", operator: "Operador", viewer: "Executivo", cymag: "Equipe CYMAG", admin: "Admin" };

/* ─── API ───
   Quando o modo demonstração está ativo (window.CYMAG_DEMO.active), toda chamada
   é atendida client-side por window.__demoApi — mesmo formato de resposta do
   backend real. É isso que permite hospedar o projeto de graça, sem servidor. */
function isDemo() { return !!(window.CYMAG_DEMO && window.CYMAG_DEMO.active); }

async function api(path, { method = "GET", body = null } = {}) {
  if (isDemo()) return window.__demoApi(path, { method, body });
  const opts = { method, headers: {} };
  if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await fetch(path, opts);
  if (r.status === 401) { if (state.user) { state.user = null; toast("Sessão expirada.", "err"); showLogin(); } throw new Error("unauthorized"); }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw Object.assign(new Error((data && data.error) || "HTTP " + r.status), { status: r.status, data });
  return data;
}

/* ─── UI helpers ─── */
function toast(msg, kind = "info", ms = 3800) {
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function openModal(html, wide) { const m = $("#modal"); m.innerHTML = html; m.classList.toggle("wide", !!wide); $("#modal-back").classList.add("open"); }
function closeModal() { $("#modal-back").classList.remove("open"); }
$("#modal-back").addEventListener("click", e => { if (e.target.id === "modal-back") closeModal(); });

const ICONS = {
  overview: '<path d="M3 13h8V3H3zM13 21h8V3h-8zM3 21h8v-6H3z"/>',
  scan: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  autonomous: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/><circle cx="12" cy="12" r="3"/>',
  engagements: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  areas: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  exec: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  resumo: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>',
  central: '<path d="M9 11l3 3L22 4"/><path d="M22 12v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  conta: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  billing: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  planos: '<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ""}</svg>`;

const SECTION_META = {
  overview:    { title: "Painel", sub: "Visão geral da operação" },
  scan:        { title: "Scan Manual", sub: "Descoberta e análise de um alvo" },
  autonomous:  { title: "Pentester Autônomo", sub: "Operação automática dentro do escopo autorizado" },
  engagements: { title: "Engagements", sub: "Escopos autorizados de teste" },
  areas:       { title: "Áreas de Cobertura", sub: "Serviços verificados por área" },
  history:     { title: "Histórico", sub: "Scans persistidos" },
  exec:        { title: "Painel Executivo", sub: "Risco de negócio consolidado" },
  resumo:      { title: "Resumo", sub: "O que encontramos, o risco e o que decidir — em português" },
  central:     { title: "Central CYMAG", sub: "Entrega dos pentests gerenciados aos clientes" },
  conta:       { title: "Minha Conta", sub: "Plano, equipe e serviços da sua empresa" },
  billing:     { title: "Assinatura", sub: "Seu plano, cobrança e gestão da assinatura" },
  planos:      { title: "Planos", sub: "Assinaturas, recursos e preços" },
};
// A tela é escolhida pelo PAPEL:
//   owner (dono)     → só o resumo de negócio + conta. Não vê o console técnico.
//   operator (TI)    → console técnico: scan, autônomo, engagements, áreas, histórico.
//   viewer           → painel executivo (leitura).
//   cymag/admin      → console técnico + Central (entrega gerenciada).
const NAV = {
  operator: ["overview", "scan", "autonomous", "engagements", "areas", "history"],
  owner:    ["resumo", "conta", "billing"],
  viewer:   ["exec", "history"],
  cymag:    ["overview", "scan", "autonomous", "engagements", "areas", "history", "central"],
  admin:    ["overview", "scan", "autonomous", "engagements", "areas", "history", "central", "resumo"],
};

/* ─── Severidade / score ─── */
const SEV = { crit: "Crítica", high: "Alta", med: "Média", low: "Baixa", info: "Info" };
const SEV_ORDER = { crit: 0, high: 1, med: 2, low: 3, info: 4 };
const sevBadge = (s) => `<span class="badge sev-${s || "info"}">${SEV[s] || "Info"}</span>`;
const gaugeColor = (v) => v >= 60 ? "var(--red)" : v >= 30 ? "var(--yellow)" : "var(--green)";

/* ─── LOGIN ─── */
function showLogin() {
  clearInterval(state.autoTimer);
  $("#view-app").classList.remove("active");
  $("#view-login").classList.add("active");
}
function showApp() {
  $("#view-login").classList.remove("active");
  $("#view-app").classList.add("active");
}

async function doLogin() {
  const email = $("#login-email").value.trim().toLowerCase();
  const password = $("#login-pass").value;
  const err = $("#login-error");
  err.classList.add("hidden");
  if (!email || !password) { err.textContent = "Informe e-mail e chave de acesso."; err.classList.remove("hidden"); return; }
  const btn = $("#login-btn");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Autenticando…';
  try {
    const user = await api("/api/login", { method: "POST", body: { email, password } });
    enterApp(user);
  } catch (e) {
    err.textContent = e.message === "unauthorized" ? "Credenciais inválidas." : (e.message || "Falha no login.");
    err.classList.remove("hidden");
  } finally {
    btn.disabled = false; btn.textContent = "Acessar plataforma";
  }
}
$("#login-btn").addEventListener("click", doLogin);
$("#view-login").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });

/* ─── MODO DEMONSTRAÇÃO ─── */
function enterDemo(role) {
  if (!window.CYMAG_DEMO) { toast("Demo indisponível.", "err"); return; }
  window.CYMAG_DEMO.enable();
  if (role) window.CYMAG_DEMO.setRole(role);
  renderDemoBar();
  enterApp(window.CYMAG_DEMO.identity());
}
function renderDemoBar() {
  const bar = $("#demobar"), sw = $("#role-switch");
  if (!isDemo()) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const D = window.CYMAG_DEMO;
  sw.innerHTML = D.roles.map(r =>
    `<button class="${r === D.role ? "active" : ""}" data-role="${r}">${D.roleLabels[r]}</button>`).join("");
  $$("#role-switch button").forEach(b => b.addEventListener("click", () => {
    D.setRole(b.dataset.role);
    enterApp(D.identity());           // re-entra com o novo papel (nav e telas mudam)
    renderDemoBar();
    toast(`Agora você vê como: ${D.roleLabels[b.dataset.role]}`, "info");
  }));
}
$("#demo-btn").addEventListener("click", () => enterDemo("owner"));
$("#demo-reset").addEventListener("click", () => {
  window.CYMAG_DEMO.reset();
  toast("Demonstração reiniciada.", "ok");
  enterApp(window.CYMAG_DEMO.identity());
  renderDemoBar();
});

/* ─── APP INIT ─── */
function enterApp(user) {
  state.user = user;
  $("#u-name").textContent = user.name;
  const org = user.account?.name || ROLE_LABEL[user.role] || user.role;
  $("#u-role").textContent = `${org} · ${user.plan?.name || "—"}`;
  $("#u-avatar").textContent = (user.name || "?")[0].toUpperCase();

  let items = [...(NAV[user.role] || NAV.operator)];
  // Gate por plano: sem modo autônomo, tira a seção.
  if (!hasFeature("autonomous")) items = items.filter(x => x !== "autonomous");
  // Planos: sempre visível (upsell / transparência).
  if (!items.includes("planos")) items.push("planos");

  $("#nav").innerHTML = items.map(id =>
    `<button class="nav-item" data-sec="${id}">${icon(id)}<span>${SECTION_META[id].title}</span></button>`
  ).join("");
  $$("#nav .nav-item").forEach(b => b.addEventListener("click", () => { showSection(b.dataset.sec); closeSidebar(); }));

  showApp();
  primeDemoScan(items[0]);
  showSection(items[0]);
}

/* No modo demo, as telas técnicas (Painel/Executivo) ficariam vazias porque o
   usuário ainda não rodou um scan. Pré-carregamos o último scan semeado para a
   demonstração já abrir com dados. */
function primeDemoScan(firstSection) {
  if (!isDemo() || state.lastScan) return;
  const technical = ["operator", "cymag", "admin", "viewer"].includes(state.user.role);
  if (!technical) return;
  api("/api/scans/1001/findings").then(d => {
    const f = d.findings || [];
    if (!f.length) return;
    state.lastScan = { target: "192.168.0.0/24", cyber_vulns: f,
      exec_risks: [], risk_score: Math.min(100, f.reduce((t, x) => t + ({ crit: 15, high: 8, med: 3, low: 1, info: 0 }[x.sev] ?? 1), 0)),
      scan_id: 1001 };
    if (["overview", "exec"].includes(state.section)) showSection(state.section);
  }).catch(() => {});
}

async function logout() {
  try { await api("/api/logout", { method: "POST" }); } catch (e) {}
  if (window.CYMAG_DEMO) window.CYMAG_DEMO._active = false;
  $("#demobar").classList.add("hidden");
  state.user = null; state.lastScan = null; clearInterval(state.autoTimer);
  showLogin();
}
$("#logout-btn").addEventListener("click", logout);

/* ─── Sidebar mobile ─── */
function openSidebar() { $("#sidebar").classList.add("open"); $("#scrim").classList.add("open"); }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").classList.remove("open"); }
$("#menu-toggle").addEventListener("click", openSidebar);
$("#scrim").addEventListener("click", closeSidebar);

/* ─── NAV / SECTIONS ─── */
function showSection(id) {
  state.section = id;
  clearInterval(state.autoTimer);
  $$(".section").forEach(s => s.classList.remove("active"));
  $("#sec-" + id).classList.add("active");
  $$("#nav .nav-item").forEach(b => b.classList.toggle("active", b.dataset.sec === id));
  const meta = SECTION_META[id];
  $("#page-title").textContent = meta.title;
  $("#page-sub").textContent = meta.sub;
  $("#topbar-actions").innerHTML = "";
  (RENDER[id] || (() => {}))();
}

const RENDER = {
  overview: renderOverview,
  scan: renderScan,
  autonomous: renderAutonomous,
  engagements: renderEngagements,
  areas: renderAreas,
  history: renderHistory,
  exec: renderExec,
  resumo: renderResumo,
  central: renderCentral,
  conta: renderConta,
  billing: renderBilling,
  planos: renderPlans,
};

/* ═══════════ OVERVIEW ═══════════ */
function renderOverview() {
  const s = state.lastScan;
  const score = s ? s.risk_score : 0;
  const counts = { crit: 0, high: 0, med: 0, low: 0, info: 0 };
  (s?.cyber_vulns || []).forEach(f => counts[f.sev] = (counts[f.sev] || 0) + 1);
  $("#sec-overview").innerHTML = `
    <div class="grid grid-3">
      <div class="card" style="text-align:center">
        <h3>Índice de Risco</h3>
        <div class="gauge" style="--v:${score};--gcolor:${gaugeColor(score)}">
          <div><div class="g-num">${score}</div><div class="g-lbl">/ 100</div></div>
        </div>
        <p class="mut" style="margin:.8rem 0 0;font-size:.82rem">${s ? "Alvo: " + esc(s.target) : "Nenhum scan executado ainda."}</p>
      </div>
      <div class="card">
        <h3>Achados por severidade</h3>
        ${sevBars(counts)}
      </div>
      <div class="card">
        <h3>Ações rápidas</h3>
        <button class="btn btn-primary btn-block mb" id="ov-scan">Novo scan manual</button>
        <button class="btn btn-block mb" id="ov-auto">Operação autônoma</button>
        <button class="btn btn-block" id="ov-report" ${s ? "" : "disabled"}>Gerar relatório PDF</button>
      </div>
    </div>
    ${s ? `<div class="card" style="margin-top:1rem"><div class="card-title-row"><h3>Últimos achados</h3><span class="mut">${s.cyber_vulns.length} no total</span></div>${findingsTable(s.cyber_vulns.slice(0, 8))}</div>` : ""}`;
  $("#ov-scan").addEventListener("click", () => showSection("scan"));
  $("#ov-auto").addEventListener("click", () => showSection("autonomous"));
  $("#ov-report")?.addEventListener("click", () => downloadPDF("detailed"));
  wireFindingButtons($("#sec-overview"));
}

/* ═══════════ SCAN MANUAL ═══════════ */
async function renderScan() {
  const box = $("#sec-scan");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando engagements…</span></div>`;
  let engs = [];
  try { engs = (await api("/api/engagements")).engagements || []; } catch (e) {}
  const authorized = engs.filter(e => e.status === "authorized");

  if (!authorized.length) {
    box.innerHTML = `
      <div class="card mb">
        <h3>Alvo</h3>
        <p class="mut">Toda varredura exige um engagement <b>autorizado</b> que contenha o alvo — é o contrato que autoriza o teste.
        Crie um em <a style="color:var(--blue)" id="go-eng">Engagements</a>${state.user.role === "admin" ? " e autorize-o" : " e peça a um admin para autorizar"}.</p>
      </div>`;
    $("#go-eng")?.addEventListener("click", () => showSection("engagements"));
    return;
  }

  box.innerHTML = `
    <div class="card mb">
      <h3>Alvo</h3>
      <div class="field"><label class="field-label">Engagement autorizado</label>
        <select class="input" id="scan-eng">${authorized.map(e => `<option value="${e.id}" data-scope="${esc((e.scope || []).join(", "))}">${esc(e.name)} — ${esc((e.scope || []).join(", "))}</option>`).join("")}</select>
      </div>
      <div class="field"><label class="field-label">Alvo (opcional — vazio usa o 1º do escopo; precisa estar dentro do escopo)</label>
        <div class="row">
          <input class="input" id="scan-target" placeholder="Ex.: 192.168.0.0/24 ou 10.0.0.5" value="${esc(state.lastScan?.target || "")}" style="flex:1;min-width:220px">
          <button class="btn" id="scan-auto" title="Auto-detectar rede">Auto-detectar</button>
          <button class="btn btn-primary" id="scan-run">Escanear</button>
        </div>
      </div>
      <p class="mut" style="margin:.7rem 0 0;font-size:.82rem">O scan roda: descoberta → portas → checagens por área → risco executivo (IA). Hosts fora do escopo são descartados.</p>
    </div>
    <div id="scan-results"></div>`;
  $("#scan-auto").addEventListener("click", autoDiscover);
  $("#scan-run").addEventListener("click", runScan);
  if (state.lastScan) renderScanResults(state.lastScan);
}

async function autoDiscover() {
  const btn = $("#scan-auto"); btn.disabled = true; btn.textContent = "Detectando…";
  try {
    const d = await api("/api/auto_discover");
    if (d.subnets?.length) { $("#scan-target").value = d.subnets[0].subnet; toast("Rede detectada: " + d.subnets[0].subnet, "ok"); }
    else toast("Nenhuma sub-rede local detectada.", "err");
  } catch (e) { toast("Falha na auto-detecção.", "err"); }
  finally { btn.disabled = false; btn.textContent = "Auto-detectar"; }
}

async function runScan() {
  const engId = $("#scan-eng")?.value;
  if (!engId) { toast("Selecione um engagement autorizado.", "err"); return; }
  const target = $("#scan-target").value.trim();
  const label = target || "escopo do engagement";
  const btn = $("#scan-run"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Escaneando…';
  $("#scan-results").innerHTML = `<div class="card"><div class="row"><span class="spinner"></span> <span class="mut">Escaneando ${esc(label)}… isso pode levar alguns minutos.</span></div></div>`;
  try {
    const body = { engagement_id: Number(engId) };
    if (target) body.target = target;
    const data = await api("/api/scan", { method: "POST", body });
    state.lastScan = { target: data.target || target, ...data };
    renderScanResults(state.lastScan);
    toast(`Scan concluído: ${data.cyber_vulns.length} achado(s).`, "ok");
  } catch (e) {
    $("#scan-results").innerHTML = `<div class="card"><p class="mut">Falha no scan: ${esc(e.message)}</p></div>`;
    toast(e.message || "Falha no scan.", "err");
  } finally { btn.disabled = false; btn.textContent = "Escanear"; }
}

function renderScanResults(s) {
  const box = $("#scan-results");
  if (!box) return;
  box.innerHTML = `
    <div class="grid grid-4 mb">
      ${statCard(s.risk_score, "Índice de risco")}
      ${statCard(s.cyber_vulns.length, "Achados")}
      ${statCard(new Set(s.cyber_vulns.map(f => f.host)).size, "Hosts afetados")}
      ${statCard(s.cyber_vulns.filter(f => f.sev === "crit").length, "Críticos")}
    </div>
    <div class="card">
      <div class="card-title-row"><h3>Vulnerabilidades</h3>
        <div class="row">
          <button class="btn btn-sm" id="pdf-quick">PDF rápido</button>
          ${hasFeature("ai") ? `<button class="btn btn-sm btn-primary" id="pdf-detailed">PDF com IA</button>` : ""}
        </div>
      </div>
      ${findingsTable(s.cyber_vulns)}
    </div>`;
  $("#pdf-quick").addEventListener("click", () => downloadPDF("quick"));
  $("#pdf-detailed")?.addEventListener("click", () => downloadPDF("detailed"));
  wireFindingButtons(box);
}

/* ═══════════ AUTÔNOMO ═══════════ */
async function renderAutonomous() {
  const box = $("#sec-autonomous");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando engagements…</span></div>`;
  let engs = [];
  try { engs = (await api("/api/engagements")).engagements || []; } catch (e) {}
  const authorized = engs.filter(e => e.status === "authorized");

  box.innerHTML = `
    <div class="card mb">
      <h3>Iniciar operação autônoma</h3>
      ${authorized.length ? `
        <div class="field"><label class="field-label">Engagement autorizado</label>
          <select class="input" id="auto-eng">${authorized.map(e => `<option value="${e.id}" data-scope="${esc((e.scope || []).join(", "))}">${esc(e.name)} — ${esc((e.scope || []).join(", "))}</option>`).join("")}</select>
        </div>
        <div class="field"><label class="field-label">Alvo (opcional — vazio usa o 1º do escopo)</label>
          <input class="input" id="auto-target" placeholder="Deixe vazio para usar o escopo"></div>
        <button class="btn btn-primary" id="auto-run">▶ Executar operação autônoma</button>
      ` : `<p class="mut">Nenhum engagement <b>autorizado</b>. Crie um em <a style="color:var(--blue)" id="go-eng">Engagements</a>${state.user.role === "admin" ? " e autorize-o" : " e peça a um admin para autorizar"}.</p>`}
    </div>
    <div id="auto-live"></div>`;
  $("#go-eng")?.addEventListener("click", () => showSection("engagements"));
  $("#auto-run")?.addEventListener("click", startAutonomous);
}

async function startAutonomous() {
  const engId = $("#auto-eng").value;
  const target = $("#auto-target").value.trim();
  const btn = $("#auto-run"); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Iniciando…';
  try {
    const body = { engagement_id: Number(engId) };
    if (target) body.target = target;
    const r = await api("/api/autonomous/run", { method: "POST", body });
    toast("Operação iniciada.", "ok");
    trackRun(r.run_id, r.target);
  } catch (e) {
    toast(e.message || "Falha ao iniciar.", "err");
  } finally { btn.disabled = false; btn.innerHTML = "▶ Executar operação autônoma"; }
}

function trackRun(runId, target) {
  const live = $("#auto-live");
  live.innerHTML = `
    <div class="card mb">
      <div class="card-title-row"><h3>Operação em ${esc(target)}</h3><span class="pill-live"><span class="dot"></span> ao vivo</span></div>
      <div class="feed" id="auto-feed"></div>
    </div>
    <div id="auto-report"></div>`;
  let since = 0;
  clearInterval(state.autoTimer);
  const poll = async () => {
    let r;
    try { r = await api(`/api/autonomous/${runId}?since=${since}`); }
    catch (e) { clearInterval(state.autoTimer); return; }
    (r.events || []).forEach(ev => appendFeed(ev));
    since = r.event_count;
    if (r.status === "done" || r.status === "error") {
      clearInterval(state.autoTimer);
      $(".pill-live", live)?.remove();
      if (r.report) renderAutoReport(r.report);
      else if (r.status === "error") toast("Operação falhou: " + (r.error || ""), "err");
    }
  };
  poll();
  state.autoTimer = setInterval(poll, 1500);
}

function appendFeed(ev) {
  const feed = $("#auto-feed"); if (!feed) return;
  const item = document.createElement("div");
  item.className = "feed-item ph-" + ev.phase;
  item.innerHTML = `<span class="dot"></span><div><div class="fi-phase">${esc(ev.phase)}</div><div>${esc(ev.message)}</div></div>`;
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
}

function renderAutoReport(rep) {
  state.lastScan = { target: rep.target, cyber_vulns: rep.findings, exec_risks: [], risk_score: rep.risk_score, scan_id: rep.scan_id };
  const areas = Object.entries(rep.by_area || {}).map(([k, v]) => `<span class="badge badge-area">${esc(k)}: ${v}</span>`).join(" ") || '<span class="mut">—</span>';
  const plan = rep.attack_plan;
  $("#auto-report").innerHTML = `
    <div class="grid grid-4 mb">
      ${statCard(rep.risk_score, "Índice de risco")}
      ${statCard(rep.findings_total, "Achados")}
      ${statCard(rep.hosts_scanned, "Hosts")}
      ${statCard((rep.by_severity?.crit) || 0, "Críticos")}
    </div>
    <div class="card mb"><h3>Áreas afetadas</h3><div class="row">${areas}</div></div>
    ${plan ? `<div class="card mb"><h3>Plano de ataque (AEGIS)</h3>
      <p><b>Vetor inicial:</b> ${esc(plan.initial_vector?.finding_title || "—")} em ${esc(plan.initial_vector?.host || "?")}:${esc(plan.initial_vector?.port || "?")}</p>
      <p class="mut">${esc(plan.initial_vector?.why || "")}</p>
      <div class="divider"></div>
      <ol style="padding-left:1.1rem;margin:0">${(plan.attack_steps || []).map(st => `<li style="margin-bottom:.5rem"><b>${esc(st.action)}</b><br><code class="mut">${esc(st.command || "")}</code></li>`).join("")}</ol>
      <p style="margin-top:.8rem"><b>Tempo estimado até root:</b> ${esc(plan.estimated_time_to_root || "—")}</p>
    </div>` : `<div class="card mb"><p class="mut">Plano de ataque da IA indisponível (AEGIS offline — defina a chave GROQ).</p></div>`}
    <div class="card">
      <div class="card-title-row"><h3>Achados</h3><button class="btn btn-sm btn-primary" id="auto-pdf">PDF com IA</button></div>
      ${findingsTable(rep.findings)}
    </div>`;
  $("#auto-pdf").addEventListener("click", () => downloadPDF("detailed"));
  wireFindingButtons($("#auto-report"));
}

/* ═══════════ ENGAGEMENTS ═══════════ */
async function renderEngagements() {
  const box = $("#sec-engagements");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando…</span></div>`;
  let engs = [];
  try { engs = (await api("/api/engagements")).engagements || []; } catch (e) {}
  state.engagements = engs;
  const isAdmin = state.user.role === "admin";
  // O conceito de "cliente" só faz sentido para a equipe CYMAG (pentest PARA
  // terceiros). Para a PME que se testa a si mesma, o alvo é a própria empresa.
  const isStaff = !!state.user.is_staff;
  box.innerHTML = `
    <div class="card mb">
      <h3>Novo engagement</h3>
      <div class="${isStaff ? "grid grid-2" : ""}">
        <div class="field"><label class="field-label">Nome</label><input class="input" id="eng-name" placeholder="${isStaff ? "Pentest ACME Q3" : "Rede do escritório"}"></div>
        ${isStaff ? `<div class="field"><label class="field-label">Cliente</label><input class="input" id="eng-client" placeholder="ACME Corp"></div>` : ""}
      </div>
      <div class="field"><label class="field-label">Escopo autorizado (CIDRs/IPs, um por linha ou separados por vírgula)</label>
        <textarea class="input" id="eng-scope" placeholder="192.168.0.0/24&#10;10.0.0.5"></textarea></div>
      <button class="btn btn-primary" id="eng-create">Criar engagement</button>
    </div>
    <div class="card">
      <h3>Engagements</h3>
      ${engs.length ? `<table class="table"><thead><tr><th>Nome</th>${isStaff ? "<th>Cliente</th>" : ""}<th>Escopo</th><th>Status</th><th></th></tr></thead><tbody>
        ${engs.map(e => `<tr>
          <td><b>${esc(e.name)}</b></td>
          ${isStaff ? `<td>${esc(e.client || "—")}</td>` : ""}
          <td class="mono" style="font-size:.8rem">${esc((e.scope || []).join(", "))}</td>
          <td><span class="badge badge-status st-${e.status}">${esc(e.status)}</span></td>
          <td>${isAdmin && e.status !== "authorized" ? `<button class="btn btn-sm" data-auth="${e.id}">Autorizar</button>` : ""}</td>
        </tr>`).join("")}
      </tbody></table>` : `<p class="empty">Nenhum engagement ainda.</p>`}
    </div>`;
  $("#eng-create").addEventListener("click", createEngagement);
  $$("[data-auth]", box).forEach(b => b.addEventListener("click", () => authorizeEngagement(b.dataset.auth)));
}

async function createEngagement() {
  const name = $("#eng-name").value.trim();
  const client = $("#eng-client")?.value.trim() || "";
  const scope = $("#eng-scope").value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  if (!name) { toast("Informe o nome.", "err"); return; }
  if (!scope.length) { toast("Informe ao menos um IP/CIDR no escopo.", "err"); return; }
  try {
    await api("/api/engagements", { method: "POST", body: { name, client, scope } });
    toast("Engagement criado.", "ok");
    renderEngagements();
  } catch (e) { toast(e.message || "Falha ao criar.", "err"); }
}

async function authorizeEngagement(id) {
  try {
    await api(`/api/engagements/${id}/authorize`, { method: "POST" });
    toast("Engagement autorizado.", "ok");
    renderEngagements();
  } catch (e) { toast(e.message || "Falha ao autorizar.", "err"); }
}

/* ═══════════ ÁREAS ═══════════ */
async function renderAreas() {
  const box = $("#sec-areas");
  box.innerHTML = `<div class="card"><span class="spinner"></span></div>`;
  let areas = {};
  try { areas = (await api("/api/areas")).areas || {}; } catch (e) {}
  box.innerHTML = `<div class="grid grid-3">${Object.entries(areas).map(([k, a]) => `
    <div class="card">
      <h3>${esc(a.label)}</h3>
      <p class="mut" style="font-size:.83rem;margin:0 0 .8rem">${esc(a.desc)}</p>
      ${(a.services || []).length
        ? `<div class="row">${a.services.map(s => `<span class="badge badge-area">${esc(s.name)}</span>`).join(" ")}</div>`
        : `<span class="mut" style="font-size:.82rem">Nível de motor</span>`}
    </div>`).join("")}</div>`;
}

/* ═══════════ HISTÓRICO ═══════════ */
async function renderHistory() {
  const box = $("#sec-history");
  box.innerHTML = `<div class="card"><span class="spinner"></span></div>`;
  let scans = [];
  try { scans = (await api("/api/scans")).scans || []; } catch (e) {}
  box.innerHTML = `<div class="card"><h3>Scans</h3>${scans.length ? `
    <table class="table"><thead><tr><th>#</th><th>Alvo</th><th>Status</th><th>Achados</th><th>Risco</th><th>Data</th></tr></thead><tbody>
    ${scans.map(s => `<tr class="clickable" data-scan="${s.id}">
      <td class="mono">#${s.id}</td><td>${esc(s.target)}</td>
      <td><span class="badge badge-status st-${s.status}">${esc(s.status)}</span></td>
      <td class="mono">${s.findings_count}</td><td class="mono">${s.risk_score}</td>
      <td class="mut" style="font-size:.8rem">${esc((s.started_at || "").replace("T", " ").slice(0, 16))}</td>
    </tr>`).join("")}</tbody></table>` : `<p class="empty">Nenhum scan no histórico.</p>`}</div>
    <div id="hist-detail"></div>`;
  $$("[data-scan]", box).forEach(tr => tr.addEventListener("click", () => loadScanFindings(tr.dataset.scan)));
}

async function loadScanFindings(id) {
  const box = $("#hist-detail");
  box.innerHTML = `<div class="card" style="margin-top:1rem"><span class="spinner"></span></div>`;
  try {
    const d = await api(`/api/scans/${id}/findings`);
    box.innerHTML = `<div class="card" style="margin-top:1rem"><h3>Achados do scan #${id}</h3>${d.findings.length ? findingsTable(d.findings) : '<p class="empty">Sem achados.</p>'}</div>`;
    wireFindingButtons(box);
  } catch (e) { box.innerHTML = ""; toast("Falha ao carregar achados.", "err"); }
}

/* ═══════════ EXECUTIVO ═══════════ */
function renderExec() {
  const s = state.lastScan;
  const box = $("#sec-exec");
  const score = s ? s.risk_score : 0;
  box.innerHTML = `
    <div class="grid grid-3 mb">
      <div class="card" style="text-align:center">
        <h3>Índice de Risco</h3>
        <div class="gauge" style="--v:${score};--gcolor:${gaugeColor(score)}"><div><div class="g-num">${score}</div><div class="g-lbl">/ 100</div></div></div>
      </div>
      <div class="card">
        <h3>Postura</h3>
        <p class="mut">${s ? `Alvo avaliado: <b style="color:var(--text)">${esc(s.target)}</b>` : "Nenhuma avaliação disponível. Solicite um scan à equipe de SecOps."}</p>
        ${s ? `<div class="divider"></div><div class="row spread"><span>Achados críticos</span><b class="mono" style="color:var(--red)">${s.cyber_vulns.filter(f => f.sev === "crit").length}</b></div>
        <div class="row spread"><span>Total de exposições</span><b class="mono">${s.cyber_vulns.length}</b></div>` : ""}
      </div>
      <div class="card"><h3>Relatório</h3>
        <p class="mut" style="font-size:.85rem">Gere o relatório executivo com narrativa de risco de negócio (LGPD, impacto financeiro).</p>
        <button class="btn btn-primary btn-block" id="exec-pdf" ${s ? "" : "disabled"}>Gerar relatório executivo</button>
      </div>
    </div>
    ${s && s.exec_risks?.length ? `<div class="card"><h3>Riscos de negócio</h3>
      <table class="table"><thead><tr><th>Risco</th><th>Categoria</th><th>Impacto</th><th>Probabilidade</th></tr></thead><tbody>
      ${s.exec_risks.map(r => `<tr><td>${esc(r.risk || "—")}</td><td>${esc(r.category || "—")}</td><td class="mono">${esc(r.impact || "—")}</td><td>${esc(r.probability || "—")}</td></tr>`).join("")}
      </tbody></table></div>` : ""}`;
  $("#exec-pdf")?.addEventListener("click", () => downloadPDF("detailed"));
}

/* ═══════════ RESUMO DO DONO (linguagem de negócio + orçamento) ═══════════ */
async function renderResumo() {
  const box = $("#sec-resumo");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando seu resumo…</span></div>`;
  let d;
  try { d = await api("/api/owner/summary"); }
  catch (e) { box.innerHTML = `<div class="card"><p class="mut">Falha ao carregar o resumo: ${esc(e.message)}</p></div>`; return; }

  if (!d.scan) {
    box.innerHTML = `<div class="card" style="text-align:center;padding:2.5rem 1rem">
      <h3>Ainda não há uma avaliação</h3>
      <p class="mut" style="max-width:520px;margin:.6rem auto 0">Nenhuma varredura foi concluída na sua empresa ainda.
      Peça ao seu responsável de TI para rodar uma avaliação — assim que terminar, você verá aqui,
      em português, o que foi encontrado, o risco e quanto custa resolver.</p></div>`;
    return;
  }

  const s = d.scan, sum = d.summary;
  const score = s.risk_score || 0;
  const verdict = score >= 60 ? "Atenção urgente" : score >= 30 ? "Requer cuidado" : "Situação controlada";
  const when = (s.finished_at || "").replace("T", " ").slice(0, 16);

  box.innerHTML = `
    <div class="grid grid-3 mb">
      <div class="card" style="text-align:center">
        <h3>Nível de risco</h3>
        <div class="gauge" style="--v:${score};--gcolor:${gaugeColor(score)}"><div><div class="g-num">${score}</div><div class="g-lbl">/ 100</div></div></div>
        <p style="margin:.7rem 0 0;font-weight:600;color:${gaugeColor(score)}">${verdict}</p>
        <p class="mut" style="font-size:.8rem;margin:.2rem 0 0">Avaliado em ${esc(when)}</p>
      </div>
      <div class="card">
        <h3>Se nada for feito</h3>
        <p class="mut" style="font-size:.82rem;margin:0 0 .4rem">Prejuízo estimado dos problemas em aberto:</p>
        <div style="font-size:1.6rem;font-weight:700;color:var(--red)">${esc(sum.open_loss_label)}</div>
        <div class="divider"></div>
        <div class="row spread"><span>Problemas em aberto</span><b class="mono">${sum.pending}</b></div>
        <div class="row spread"><span>Críticos</span><b class="mono" style="color:var(--red)">${sum.by_severity.crit || 0}</b></div>
      </div>
      <div class="card">
        <h3>Para resolver tudo</h3>
        <p class="mut" style="font-size:.82rem;margin:0 0 .4rem">Investimento estimado de correção:</p>
        <div style="font-size:1.6rem;font-weight:700;color:var(--green)">${esc(sum.open_fix_label)}</div>
        <div class="divider"></div>
        <div class="row spread"><span>Orçamentos autorizados</span><b class="mono">${sum.authorized}</b></div>
        <div class="row spread"><span>Verba autorizada</span><b class="mono">${esc(sum.authorized_budget_label)}</b></div>
      </div>
    </div>
    <div class="grid grid-2 mb">
      <div class="card ${score >= 60 ? "callout warn" : score >= 30 ? "callout" : "callout good"}" style="display:flex;align-items:center">
        <p style="margin:0">${riskPlainText(score, sum)} ${roiText(sum)}</p>
      </div>
      <div class="card">
        <h3>Distribuição por gravidade</h3>
        ${sevBars(sum.by_severity)}
      </div>
    </div>
    <div class="card-title-row"><h3 style="margin:.4rem 0">Problemas encontrados</h3><span class="mut">${d.problems.length} listado(s), do mais grave ao mais leve</span></div>
    <div id="resumo-problems">${d.problems.map(problemCard).join("") || '<div class="card"><p class="empty">Nenhum problema encontrado. 🎉</p></div>'}</div>`;

  $$("[data-budget]", box).forEach(btn => btn.addEventListener("click", () => {
    const item = d.problems.find(p => String(p.finding_id) === btn.dataset.budget);
    if (item) openBudgetModal(item);
  }));
}

function roiText(sum) {
  const loss = (sum.open_loss_min + sum.open_loss_max) / 2;
  const fix = (sum.open_fix_min + sum.open_fix_max) / 2;
  if (!fix || !loss) return "";
  const ratio = Math.round(loss / fix);
  return `<b>Retorno:</b> cada R$ 1 investido em correção protege cerca de <b>R$ ${ratio}</b> em prejuízo potencial.`;
}

function sevBars(bySev) {
  const order = ["crit", "high", "med", "low", "info"];
  const max = Math.max(1, ...order.map(k => bySev[k] || 0));
  return `<div class="sevbars">${order.map(k => {
    const n = bySev[k] || 0;
    return `<div class="sevbar"><span>${SEV[k]}</span>
      <div class="track"><div class="fill ${k}" style="width:${Math.round((n / max) * 100)}%"></div></div>
      <b>${n}</b></div>`;
  }).join("")}</div>`;
}

function riskPlainText(score, sum) {
  const crit = sum.by_severity.crit || 0;
  if (score >= 60)
    return `<b>Sua empresa está exposta.</b> Encontramos ${crit > 0 ? `<b>${crit} problema(s) crítico(s)</b> e ` : ""}${sum.pending} ponto(s) que um invasor poderia usar. Recomendamos autorizar as correções o quanto antes — o prejuízo potencial supera de longe o custo de resolver.`;
  if (score >= 30)
    return `<b>Há pontos a corrigir.</b> Nada em estado de emergência, mas ${sum.pending} problema(s) em aberto merecem atenção nas próximas semanas para evitar que virem porta de entrada.`;
  return `<b>Boa notícia:</b> sua postura está em bom nível. Mantenha as avaliações periódicas e resolva os poucos pontos abertos para continuar assim.`;
}

function problemCard(p) {
  const decided = p.decision;
  let action;
  if (decided && decided.status === "authorized") {
    action = `<span class="badge sev-low">✅ Orçamento autorizado${decided.budget ? " · " + BRL(decided.budget) : ""}</span>
      <div class="mut" style="font-size:.76rem;margin-top:.3rem">por ${esc(decided.decided_by_name || "—")} em ${esc((decided.decided_at || "").replace("T", " ").slice(0, 16))}</div>`;
  } else if (decided && decided.status === "dismissed") {
    action = `<span class="badge">Dispensado (risco aceito)</span>
      <div class="row" style="margin-top:.4rem"><button class="btn btn-sm" data-budget="${p.finding_id}">Rever decisão</button></div>`;
  } else {
    action = `<button class="btn btn-sm btn-primary" data-budget="${p.finding_id}">Autorizar orçamento</button>`;
  }
  return `<div class="card mb">
    <div class="card-title-row">
      <div class="row" style="gap:.5rem;align-items:center">${sevBadge(p.severity)}<b>${esc(p.area_label)}</b></div>
      <span class="mono mut" style="font-size:.8rem">${esc(p.host || "")}:${esc(p.port || "")}</span>
    </div>
    <p style="margin:.4rem 0 .8rem">${esc(p.problem)}</p>
    <div class="grid grid-2 mb">
      <div style="background:var(--bg);border-radius:.5rem;padding:.7rem .9rem">
        <div class="mut" style="font-size:.76rem">Se não corrigir, prejuízo estimado</div>
        <div style="font-weight:700;color:var(--red)">${esc(p.loss_label)}</div>
      </div>
      <div style="background:var(--bg);border-radius:.5rem;padding:.7rem .9rem">
        <div class="mut" style="font-size:.76rem">Custo estimado para corrigir</div>
        <div style="font-weight:700;color:var(--green)">${esc(p.fix_cost_label)}</div>
      </div>
    </div>
    <p class="mut" style="font-size:.85rem;margin:0 0 .8rem"><b>O que precisa mudar:</b> ${esc(p.fix)}</p>
    <div>${action}</div>
  </div>`;
}

function openBudgetModal(item) {
  openModal(`<h2>Autorizar orçamento de correção</h2>
    <div class="row mb" style="gap:.5rem;align-items:center">${sevBadge(item.severity)}<b>${esc(item.area_label)}</b>
      <span class="mono mut" style="font-size:.8rem">${esc(item.host || "")}:${esc(item.port || "")}</span></div>
    <p class="mut">${esc(item.problem)}</p>
    <div style="background:var(--bg);border-radius:.5rem;padding:.7rem .9rem;margin:.6rem 0">
      <div class="row spread"><span>Prejuízo se não corrigir</span><b style="color:var(--red)">${esc(item.loss_label)}</b></div>
      <div class="row spread"><span>Custo estimado de correção</span><b style="color:var(--green)">${esc(item.fix_cost_label)}</b></div>
    </div>
    <div class="field"><label class="field-label">Verba autorizada (R$, opcional)</label>
      <input class="input" id="bud-value" type="number" min="0" step="100" placeholder="Ex.: 10000"></div>
    <div class="field"><label class="field-label">Observação (opcional)</label>
      <input class="input" id="bud-note" placeholder="Ex.: aprovado, priorizar esta semana"></div>
    <p class="mut" style="font-size:.76rem">Valores são estimativas de ordem de grandeza para priorização, não uma cotação.</p>
    <div class="row" style="justify-content:space-between;margin-top:1rem">
      <button class="btn" id="bud-dismiss">Dispensar (aceitar o risco)</button>
      <div class="row">
        <button class="btn" onclick="closeModalGlobal()">Cancelar</button>
        <button class="btn btn-primary" id="bud-ok">Autorizar</button>
      </div>
    </div>`);
  $("#bud-ok").addEventListener("click", () => submitBudget(item.finding_id, "authorized"));
  $("#bud-dismiss").addEventListener("click", () => submitBudget(item.finding_id, "dismissed"));
}

async function submitBudget(findingId, status) {
  const body = { finding_id: findingId, status };
  const v = $("#bud-value")?.value;
  const note = $("#bud-note")?.value.trim();
  if (status === "authorized" && v) body.budget = Number(v);
  if (note) body.note = note;
  try {
    await api("/api/owner/budget", { method: "POST", body });
    toast(status === "authorized" ? "Orçamento autorizado." : "Problema dispensado.", "ok");
    closeModal();
    renderResumo();
  } catch (e) { toast(e.message || "Falha ao registrar.", "err"); }
}

/* ═══════════ COMPONENTES COMPARTILHADOS ═══════════ */
function statCard(num, lbl) {
  return `<div class="card stat"><span class="num">${esc(num)}</span><span class="lbl">${esc(lbl)}</span></div>`;
}

function findingsTable(list) {
  if (!list || !list.length) return '<p class="empty">Nenhuma vulnerabilidade encontrada. 🎉</p>';
  const sorted = [...list].sort((a, b) => (SEV_ORDER[a.sev] ?? 9) - (SEV_ORDER[b.sev] ?? 9));
  return `<table class="table"><thead><tr><th>Severidade</th><th>Vulnerabilidade</th><th>Área</th><th>Ativo</th><th>CVSS</th><th></th></tr></thead><tbody>
    ${sorted.map((f, i) => `<tr>
      <td>${sevBadge(f.sev)}</td>
      <td><b>${esc(f.title)}</b><div class="finding-detail">${esc((f.desc || "").slice(0, 120))}</div></td>
      <td>${f.category ? `<span class="badge badge-area">${esc(f.category)}</span>` : "—"}</td>
      <td class="mono" style="font-size:.82rem">${esc(f.host || "")}:${esc(f.port || "")}</td>
      <td class="mono">${esc(f.cvss ?? "—")}</td>
      <td>${hasFeature("ai")
        ? `<button class="btn btn-sm" data-remediate="${i}">Analisar</button>`
        : `<button class="btn btn-sm" data-upsell="ai" title="Análise por IA — requer plano Profissional">🔒 IA</button>`}</td>
    </tr>`).join("")}</tbody></table>`;
}

function wireFindingButtons(scope) {
  $$("[data-remediate]", scope).forEach(btn => {
    btn.addEventListener("click", () => {
      const list = state.lastScan?.cyber_vulns || [];
      const sorted = [...list].sort((a, b) => (SEV_ORDER[a.sev] ?? 9) - (SEV_ORDER[b.sev] ?? 9));
      openRemediation(sorted[Number(btn.dataset.remediate)]);
    });
  });
  $$("[data-upsell]", scope).forEach(btn => {
    btn.addEventListener("click", () => { toast("Recurso do plano Profissional. Veja em Planos.", "info"); showSection("planos"); });
  });
}

async function openRemediation(vuln) {
  if (!vuln) return;
  const persona = state.user.view === "executive" ? "exec" : "secops";
  openModal(`<h2>${esc(vuln.title)}</h2><div class="row mb">${sevBadge(vuln.sev)} ${vuln.category ? `<span class="badge badge-area">${esc(vuln.category)}</span>` : ""} <span class="mono mut">${esc(vuln.host || "")}:${esc(vuln.port || "")}</span></div>
    <p class="mut">${esc(vuln.desc || "")}</p><div class="divider"></div>
    <div id="rem-body"><div class="row"><span class="spinner"></span> <span class="mut">AEGIS analisando…</span></div></div>
    <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="btn" onclick="closeModalGlobal()">Fechar</button></div>`);
  try {
    const r = await api("/api/remediation", { method: "POST", body: { vuln, persona, all_findings: state.lastScan?.cyber_vulns || [] } });
    $("#rem-body").innerHTML = persona === "exec" ? execRemediationHTML(r) : secopsRemediationHTML(r);
  } catch (e) {
    $("#rem-body").innerHTML = `<p class="mut">Falha ao obter análise: ${esc(e.message)}</p>`;
  }
}
function secopsRemediationHTML(r) {
  return `
    ${r.steps ? `<h3>Passos</h3><ol style="padding-left:1.1rem">${r.steps.map(s => `<li style="margin-bottom:.3rem">${esc(s)}</li>`).join("")}</ol>` : ""}
    ${r.commands ? `<h3>Comandos</h3><pre class="mono" style="background:var(--bg);padding:.8rem;border-radius:.4rem;overflow:auto;font-size:.8rem">${esc(r.commands)}</pre>` : ""}
    ${r.attack_chain ? `<p><b>Cadeia de ataque:</b> ${esc(r.attack_chain)}</p>` : ""}
    ${r.mitre_tactics ? `<p><b>MITRE:</b> ${esc((r.mitre_tactics || []).join(", "))}</p>` : ""}
    ${r.next_recon ? `<p><b>Próximo recon:</b> <code>${esc(r.next_recon)}</code></p>` : ""}`;
}
function execRemediationHTML(r) {
  return `
    ${r.rationale ? `<p>${esc(r.rationale)}</p>` : ""}
    ${r.financial_impact ? `<p><b>Impacto financeiro:</b> ${esc(r.financial_impact)}</p>` : ""}
    ${r.regulatory_risk ? `<p><b>Risco regulatório:</b> ${esc(r.regulatory_risk)}</p>` : ""}
    ${r.email ? `<h3>E-mail sugerido</h3><pre class="mono" style="background:var(--bg);padding:.8rem;border-radius:.4rem;overflow:auto;font-size:.78rem;white-space:pre-wrap">${esc(r.email)}</pre>` : ""}`;
}
window.closeModalGlobal = closeModal;

/* ═══════════ PLANOS / ASSINATURA ═══════════ */
const BRL = (v) => v === 0 ? "Grátis" : "R$ " + Number(v).toLocaleString("pt-BR");
const POPULAR_PLAN = "profissional";
const canManagePlan = () => ["owner", "admin"].includes(state.user?.role);
state.cycle = state.cycle || "month";

const PLAN_FEATS = (p) => [
  { on: true, t: "Scanner de rede (Python + Go)" },
  { on: p.autonomous, t: "Agente autônomo" },
  { on: p.ai, t: "Copiloto de IA (AEGIS)" },
  { on: p.training, t: "Treinamento / onboarding" },
  { on: p.managed, t: "Pentest gerenciado + laudo assinado" },
];

function applyPlanChange(resp) {
  // Atualiza o plano em memória e o chip da sidebar sem recarregar a sessão.
  if (resp && resp.plan) {
    state.user.plan = Object.assign({}, state.user.plan, resp.plan);
    const org = state.user.account?.name || state.user.role;
    $("#u-role").textContent = `${org} · ${state.user.plan.name}`;
    // Modo autônomo pode ter sido liberado/retirado → recria a navegação.
    enterApp(state.user);
  }
}

function renderPlans() {
  const box = $("#sec-planos");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando planos…</span></div>`;
  api("/api/plans").then(({ plans }) => {
    const cur = state.user?.plan?.key;
    const annual = state.cycle === "year";
    box.innerHTML = `
      <div class="row spread mb" style="align-items:flex-end">
        <div><p class="mut" style="margin:0;max-width:60ch">Escolha o quanto a CYMAG faz <b>por você</b>. Do scan manual ao pentest gerenciado com laudo assinado. Troque de plano quando quiser.</p></div>
        <div class="seg" id="cycle-seg">
          <button data-cycle="month" class="${annual ? "" : "active"}">Mensal</button>
          <button data-cycle="year" class="${annual ? "active" : ""}">Anual <span class="save-pill">2 meses grátis</span></button>
        </div>
      </div>
      <div class="pricing-grid">${plans.map(p => planCard(p, cur, annual)).join("")}</div>
      <p class="mut" style="margin-top:1rem;font-size:.8rem">Valores em BRL. Enterprise é venda consultiva (per-IP, on-prem, integrações e OT/IoT). Esta é uma assinatura <b>simulada</b> para fins de demonstração — nenhuma cobrança real é feita.</p>`;
    $$("#cycle-seg button").forEach(b => b.addEventListener("click", () => { state.cycle = b.dataset.cycle; renderPlans(); }));
    $$("[data-choose]", box).forEach(b => b.addEventListener("click", () => choosePlan(b.dataset.choose, plans)));
  }).catch(() => { box.innerHTML = `<div class="card"><p class="mut">Falha ao carregar planos.</p></div>`; });
}

function planCard(p, cur, annual) {
  const isCur = p.key === cur;
  const isEnt = p.key === "enterprise";
  const price = annual ? p.price_year : p.price_month;
  const per = annual ? "/ano" : "/mês";
  const cls = ["plan-card", "hover", isCur ? "current" : "", p.key === POPULAR_PLAN ? "popular" : ""].join(" ");
  let cta;
  if (isCur) cta = `<button class="btn btn-block" disabled>✓ Plano atual</button>`;
  else if (isEnt) cta = `<button class="btn btn-block" data-choose="${p.key}">Falar com vendas</button>`;
  else if (!canManagePlan()) cta = `<button class="btn btn-block" disabled title="Só o dono da conta troca o plano">Gerenciado pelo dono</button>`;
  else cta = `<button class="btn btn-block ${p.key === POPULAR_PLAN ? "btn-gradient" : "btn-primary"}" data-choose="${p.key}">${p.price_month === 0 ? "Começar grátis" : "Assinar"}</button>`;
  return `<div class="${cls}">
    ${p.key === POPULAR_PLAN ? `<span class="plan-ribbon">Mais popular</span>` : ""}
    <div class="plan-name">${esc(p.name)}</div>
    <div class="plan-price"><span class="amt">${BRL(price)}</span><span class="per">${price ? per : (isEnt ? "sob consulta" : "para sempre")}</span></div>
    <div class="mut" style="font-size:.76rem;margin-bottom:.3rem">${p.scans_per_month === null ? "Scans ilimitados" : p.scans_per_month + " scan(s)/mês"}${annual && p.price_month ? " · equivale a " + BRL(Math.round(p.price_year / 12)) + "/mês" : ""}</div>
    <p class="plan-sub">${esc(p.tagline || "")}</p>
    <div class="plan-feats">${PLAN_FEATS(p).map(f => `<div class="plan-feat ${f.on ? "" : "off"}"><span class="${f.on ? "ck" : "xk"}">${f.on ? "✓" : "—"}</span> ${f.t}</div>`).join("")}</div>
    ${cta}
    <p class="plan-aud">${esc(p.audience)}</p>
  </div>`;
}

function choosePlan(key, plans) {
  const p = plans.find(x => x.key === key);
  if (!p) return;
  if (key === "enterprise") {
    openModal(`<h2>Plano Enterprise</h2>
      <p class="mut">O Enterprise é sob consulta: contínuo, dedicado, com integrações, on-premise e cobertura OT/IoT. Preço a partir de ${BRL(p.price_month)}/mês conforme o número de IPs e o escopo.</p>
      <div class="callout mb">Deixe seu contato que o time comercial da CYMAG retorna em até 1 dia útil.</div>
      <div class="field"><label class="field-label">E-mail para contato</label><input class="input" id="ent-email" value="${esc(state.user?.email || "")}"></div>
      <div class="row" style="justify-content:flex-end;margin-top:1rem"><button class="btn" onclick="closeModalGlobal()">Fechar</button>
        <button class="btn btn-primary" id="ent-send">Solicitar contato</button></div>`);
    $("#ent-send").addEventListener("click", () => { closeModal(); toast("Solicitação registrada! O comercial entrará em contato.", "ok"); });
    return;
  }
  openCheckout(p);
}

/* ═══════════ CHECKOUT (assinatura simulada) ═══════════ */
function openCheckout(p) {
  const annual = state.cycle === "year";
  const amount = annual ? p.price_year : p.price_month;
  const free = amount === 0;
  const period = annual ? "ano" : "mês";
  openModal(`<h2>${free ? "Começar no plano" : "Assinar plano"} ${esc(p.name)}</h2>
    <div class="checkout-grid">
      <div>
        ${free ? `<div class="callout good mb">O plano ${esc(p.name)} é gratuito. Nenhum pagamento é necessário.</div>` : `
        <div class="card-visual">
          <div class="chip"></div>
          <div class="num" id="cc-preview">•••• •••• •••• 4242</div>
          <div class="meta"><span id="cc-name-preview">NOME NO CARTÃO</span><span id="cc-exp-preview">MM/AA</span></div>
        </div>
        <div class="seg mb" id="co-cycle">
          <button data-cycle="month" class="${annual ? "" : "active"}">Mensal · ${BRL(p.price_month)}</button>
          <button data-cycle="year" class="${annual ? "active" : ""}">Anual · ${BRL(p.price_year)}</button>
        </div>
        <div class="field"><label class="field-label">Nome no cartão</label><input class="input" id="cc-name" placeholder="Ana Souza" value="${esc(state.user?.name || "")}"></div>
        <div class="field"><label class="field-label">Número do cartão</label><input class="input" id="cc-num" inputmode="numeric" placeholder="4242 4242 4242 4242" value="4242 4242 4242 4242"></div>
        <div class="row">
          <div class="field" style="flex:1"><label class="field-label">Validade</label><input class="input" id="cc-exp" placeholder="12/28" value="12/28"></div>
          <div class="field" style="flex:1"><label class="field-label">CVV</label><input class="input" id="cc-cvv" placeholder="123" value="123"></div>
        </div>`}
        <p class="sim-note">🔒 Pagamento <b>simulado</b> (ambiente de demonstração/MVP). Não insira dados reais — nenhuma cobrança é processada.</p>
      </div>
      <div>
        <div class="summary-box">
          <h3 style="margin-top:0">Resumo do pedido</h3>
          <div class="summary-line"><span>Plano ${esc(p.name)}</span><span>${BRL(amount)}</span></div>
          <div class="summary-line"><span>Ciclo</span><span id="co-cycle-label">${annual ? "Anual" : "Mensal"}</span></div>
          ${annual && p.price_month ? `<div class="summary-line" style="color:var(--green)"><span>Economia anual</span><span>${BRL(p.price_month * 12 - p.price_year)}</span></div>` : ""}
          <div class="summary-total"><span>Total hoje</span><span id="co-total">${BRL(amount)}</span></div>
          <p class="mut" style="font-size:.74rem;margin:.6rem 0 0">${free ? "Sem cobrança." : `Renova automaticamente a cada ${period}. Cancele quando quiser.`}</p>
          <button class="btn btn-gradient btn-block btn-lg" id="co-confirm" style="margin-top:1rem">${free ? "Ativar plano" : "Confirmar assinatura"}</button>
          <button class="btn btn-block btn-ghost btn-sm" style="margin-top:.4rem" onclick="closeModalGlobal()">Cancelar</button>
        </div>
      </div>
    </div>`, true);

  // live preview do cartão
  const sync = () => {
    const nm = $("#cc-name")?.value.trim().toUpperCase() || "NOME NO CARTÃO";
    const num = ($("#cc-num")?.value || "").replace(/\s+/g, "").slice(-4);
    if ($("#cc-name-preview")) $("#cc-name-preview").textContent = nm;
    if ($("#cc-exp-preview")) $("#cc-exp-preview").textContent = $("#cc-exp")?.value || "MM/AA";
    if ($("#cc-preview")) $("#cc-preview").textContent = "•••• •••• •••• " + (num || "4242");
  };
  ["cc-name", "cc-num", "cc-exp"].forEach(id => $("#" + id)?.addEventListener("input", sync));
  $$("#co-cycle button").forEach(b => b.addEventListener("click", () => { state.cycle = b.dataset.cycle; closeModal(); openCheckout(p); }));
  $("#co-confirm").addEventListener("click", () => confirmSubscription(p));
}

async function confirmSubscription(p) {
  const btn = $("#co-confirm");
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Processando pagamento…'; }
  try {
    const resp = await api("/api/account/plan", { method: "POST", body: { plan: p.key, cycle: state.cycle } });
    closeModal();
    applyPlanChange(resp);
    toast(`Assinatura do plano ${p.name} ativada! 🎉`, "ok");
    showSection("billing");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar assinatura"; }
    toast(e.message || "Falha ao assinar.", "err");
  }
}

/* ═══════════ FATURAMENTO / ASSINATURA ═══════════ */
function renderBilling() {
  const box = $("#sec-billing");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando assinatura…</span></div>`;
  api("/api/billing/summary").then(b => {
    const p = b.plan;
    const cycleLabel = b.cycle === "year" ? "Anual" : "Mensal";
    const nextCharge = b.next_charge_at ? b.next_charge_at.replace("T", " ").slice(0, 10) : null;
    box.innerHTML = `
      <div class="grid grid-3 mb">
        <div class="card">
          <h3>Plano atual</h3>
          <div style="font-size:1.6rem;font-weight:800">${esc(p.name)}</div>
          <p class="mut" style="font-size:.82rem;margin:.2rem 0 .8rem">${esc(p.tagline || "")}</p>
          <button class="btn btn-primary btn-block" id="bill-change">Trocar de plano</button>
        </div>
        <div class="card">
          <h3>Cobrança</h3>
          <div class="kpi-money">${BRL(b.amount)}<span class="kpi-sub">/${b.cycle === "year" ? "ano" : "mês"}</span></div>
          <div class="divider"></div>
          <div class="row spread"><span class="mut">Ciclo</span><b>${cycleLabel}</b></div>
          <div class="row spread"><span class="mut">Próxima cobrança</span><b>${nextCharge || "—"}</b></div>
          <div class="row spread"><span class="mut">Forma de pagamento</span><b>•••• 4242</b></div>
        </div>
        <div class="card">
          <h3>Serviço gerenciado</h3>
          ${b.managed_cadence_days
            ? `<p>A CYMAG executa o pentest <b>a cada ${b.managed_cadence_days} dias</b> e assina o laudo.</p>
               <p class="mut" style="font-size:.82rem">Próxima entrega: ${esc((b.next_managed_at || "a agendar").replace("T", " ").slice(0, 10))}</p>`
            : `<p class="mut">Seu plano é self-service. No plano <b>Gerenciado</b>, a CYMAG faz o pentest por você e assina o laudo.</p>`}
        </div>
      </div>
      <div class="card">
        <h3>Gerenciar assinatura</h3>
        <div class="row">
          <button class="btn" id="bill-upgrade">Ver todos os planos</button>
          <button class="btn" id="bill-invoice">Baixar recibo (demo)</button>
          ${p.key !== "comunidade" ? `<button class="btn btn-danger" id="bill-cancel">Cancelar assinatura</button>` : ""}
        </div>
        <p class="mut" style="font-size:.76rem;margin:.9rem 0 0">Histórico de cobranças e emissão de nota fiscal apareceriam aqui em produção. Nesta demonstração a cobrança é simulada.</p>
      </div>`;
    $("#bill-change").addEventListener("click", () => showSection("planos"));
    $("#bill-upgrade").addEventListener("click", () => showSection("planos"));
    $("#bill-invoice").addEventListener("click", () => toast("Recibo gerado (demo).", "ok"));
    $("#bill-cancel")?.addEventListener("click", cancelSubscription);
  }).catch(() => { box.innerHTML = `<div class="card"><p class="mut">Falha ao carregar a assinatura.</p></div>`; });
}

function cancelSubscription() {
  openModal(`<h2>Cancelar assinatura</h2>
    <p>Ao cancelar, sua conta volta ao plano <b>Comunidade</b> (gratuito): scan manual em um alvo, sem agente autônomo nem IA.</p>
    <div class="callout warn mb">Você perde o agente autônomo, o copiloto de IA e os relatórios profissionais.</div>
    <div class="row" style="justify-content:flex-end;margin-top:1rem">
      <button class="btn" onclick="closeModalGlobal()">Manter plano</button>
      <button class="btn btn-danger" id="cancel-confirm">Confirmar cancelamento</button>
    </div>`);
  $("#cancel-confirm").addEventListener("click", async () => {
    try {
      const resp = await api("/api/account/plan", { method: "POST", body: { plan: "comunidade", cycle: "month" } });
      closeModal(); applyPlanChange(resp); toast("Assinatura cancelada. Você está no plano Comunidade.", "info"); showSection("billing");
    } catch (e) { toast(e.message || "Falha ao cancelar.", "err"); }
  });
}

/* ═══════════ CENTRAL CYMAG (entrega dos pentests gerenciados) ═══════════ */
function renderCentral() {
  const box = $("#sec-central");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando fila…</span></div>`;
  const clientsCard = (accounts) => `<div class="card mb"><h3>Clientes gerenciados</h3>
    <table class="table"><thead><tr><th>Empresa</th><th>Plano</th><th>Cadência</th><th>Próximo pentest</th></tr></thead><tbody>
    ${accounts.filter(a => a.managed_cadence_days > 0).map(a => `<tr>
      <td><b>${esc(a.name)}</b></td><td><span class="badge badge-area">${esc(a.plan)}</span></td>
      <td>a cada ${a.managed_cadence_days} dias</td>
      <td class="mut" style="font-size:.8rem">${esc((a.next_managed_at || "—").replace("T", " "))}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="mut">Nenhum cliente em plano gerenciado.</td></tr>`}
    </tbody></table></div>`;
  Promise.all([
    api("/api/accounts").then(r => r.accounts).catch(() => []),
    api("/api/reviews").then(r => r.queue).catch(() => []),
  ]).then(([accounts, queue]) => {
    const head = clientsCard(accounts);
    if (!queue.length) { box.innerHTML = head + `<div class="card"><p class="empty">Nenhum scan aguardando entrega/laudo. 🎉</p></div>`; return; }
    box.innerHTML = head + `<div class="card"><h3>Scans aguardando validação e laudo (${queue.length})</h3>
      <table class="table"><thead><tr><th>#</th><th>Alvo</th><th>Achados</th><th>Risco</th><th>Quando</th><th></th></tr></thead><tbody>
      ${queue.map(s => `<tr>
        <td class="mono">${s.id}</td>
        <td class="mono" style="font-size:.82rem">${esc(s.target)}</td>
        <td>${s.findings_count ?? 0}</td>
        <td><b>${s.risk_score ?? 0}</b>/100</td>
        <td class="mut" style="font-size:.78rem">${esc((s.finished_at || s.started_at || "").replace("T", " "))}</td>
        <td class="row"><button class="btn btn-sm" data-review="${s.id}" data-st="reviewed">Validar</button>
            <button class="btn btn-sm btn-primary" data-review="${s.id}" data-st="signed">Assinar laudo</button></td>
      </tr>`).join("")}</tbody></table></div>`;
    $$("[data-review]", box).forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api(`/api/scans/${btn.dataset.review}/review`, { method: "POST", body: { status: btn.dataset.st } });
        toast(btn.dataset.st === "signed" ? "Laudo assinado." : "Scan validado.", "ok");
        renderCentral();
      } catch (e) { toast(e.message || "Falha ao registrar.", "err"); btn.disabled = false; }
    }));
  }).catch(() => { box.innerHTML = `<div class="card"><p class="mut">Falha ao carregar a fila.</p></div>`; });
}

/* ═══════════ MINHA CONTA (visão do dono) ═══════════ */
function renderConta() {
  const box = $("#sec-conta");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando conta…</span></div>`;
  api("/api/account").then(({ account, plan, team }) => {
    const svc = (on, t) => `<div style="padding:.25rem 0;${on ? "" : "opacity:.4"}">${on ? "✅" : "—"} ${t}</div>`;
    box.innerHTML = `
      <div class="grid grid-3 mb">
        <div class="card">
          <h3>${esc(account.name)}</h3>
          <div style="font-size:1.4rem;font-weight:700;margin:.3rem 0">Plano ${esc(plan.name)}</div>
          <p class="mut" style="font-size:.82rem">${esc(plan.tagline || "")}</p>
          <button class="btn btn-primary btn-block" id="conta-upgrade" style="margin-top:.6rem">Ver planos / fazer upgrade</button>
        </div>
        <div class="card">
          <h3>Serviços incluídos</h3>
          ${svc(plan.autonomous, "Agente autônomo")}
          ${svc(plan.ai, "Copiloto de IA (AEGIS)")}
          ${svc(plan.training, "Treinamento / onboarding CYMAG")}
          ${svc(plan.managed, "Pentest gerenciado pela CYMAG")}
        </div>
        <div class="card">
          <h3>Serviço gerenciado</h3>
          ${account.managed_cadence_days
            ? `<p>A CYMAG executa o pentest <b>a cada ${account.managed_cadence_days} dias</b> e assina o laudo.</p>
               <p class="mut" style="font-size:.82rem">Próxima entrega: ${esc((account.next_managed_at || "a agendar").replace("T", " "))}</p>`
            : `<p class="mut">Seu plano é self-service: sua equipe roda a plataforma. No plano Gerenciado, a CYMAG faz o pentest por você.</p>`}
          <p class="mut" style="font-size:.82rem;margin-top:.5rem">Onboarding: ${account.onboarding_done ? "concluído ✅" : "pendente"}</p>
        </div>
      </div>
      ${team.length ? `<div class="card"><h3>Equipe da conta (${team.length})</h3>
        <table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th></tr></thead><tbody>
        ${team.map(m => `<tr><td>${esc(m.name)}</td><td class="mono" style="font-size:.82rem">${esc(m.email)}</td><td>${esc(ROLE_LABEL[m.role] || m.role)}</td></tr>`).join("")}
        </tbody></table></div>` : ""}`;
    $("#conta-upgrade").addEventListener("click", () => showSection("planos"));
  }).catch(() => { box.innerHTML = `<div class="card"><p class="mut">Falha ao carregar a conta.</p></div>`; });
}

/* ─── PDF / RELATÓRIO ─── */
async function downloadPDF(kind) {
  const s = state.lastScan;
  if (!s) { toast("Rode um scan primeiro.", "err"); return; }
  // No modo demonstração não há backend/fpdf: geramos um relatório imprimível no
  // navegador (o usuário salva como PDF pelo diálogo de impressão).
  if (isDemo()) { openPrintableReport(s, kind); return; }
  toast("Gerando PDF…", "info");
  const body = { target: s.target, findings: s.cyber_vulns, exec_risks: s.exec_risks || [], score: s.risk_score };
  if (kind === "detailed") body.instructions = "Relatório profissional de segurança do CYMAG.";
  try {
    const r = await fetch("/api/report/" + kind, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast(e.error || "Falha ao gerar PDF.", "err"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `cymag_${kind}.pdf`; a.click();
    URL.revokeObjectURL(url);
    toast("PDF gerado.", "ok");
  } catch (e) { toast("Falha ao gerar PDF.", "err"); }
}

/* Relatório imprimível (modo demo) — abre uma janela formatada; o usuário salva
   como PDF pelo próprio navegador (Ctrl+P → Salvar como PDF). */
function openPrintableReport(s, kind) {
  const list = [...(s.cyber_vulns || [])].sort((a, b) => (SEV_ORDER[a.sev] ?? 9) - (SEV_ORDER[b.sev] ?? 9));
  const counts = { crit: 0, high: 0, med: 0, low: 0, info: 0 };
  list.forEach(f => counts[f.sev] = (counts[f.sev] || 0) + 1);
  const when = new Date().toLocaleString("pt-BR");
  const rows = list.map(f => `<tr>
      <td><span class="s s-${f.sev}">${SEV[f.sev] || "Info"}</span></td>
      <td><b>${esc(f.title)}</b><div class="d">${esc((f.desc || "").slice(0, 200))}</div></td>
      <td>${esc(f.host || "")}:${esc(f.port || "")}</td>
      <td>${esc(f.cve || "—")}</td><td>${esc(f.cvss ?? "—")}</td></tr>`).join("");
  const w = window.open("", "_blank");
  if (!w) { toast("Permita pop-ups para gerar o relatório.", "err"); return; }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>CYMAG — Relatório ${kind === "detailed" ? "Executivo" : "Técnico"}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Inter,Arial,sans-serif;color:#111827;margin:0;padding:40px;line-height:1.5}
      .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:24px}
      .logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px}
      .logo .b{width:34px;height:34px;border-radius:9px;background:#4f46e5;color:#fff;display:grid;place-items:center}
      h1{font-size:22px;margin:0 0 4px} .mut{color:#6b7280;font-size:13px}
      .kpis{display:flex;gap:16px;margin:24px 0}
      .kpi{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:14px}
      .kpi .n{font-size:26px;font-weight:800} .kpi .l{font-size:12px;color:#6b7280}
      table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:10px}
      th{text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;border-bottom:1px solid #e5e7eb;padding:8px}
      td{padding:9px 8px;border-bottom:1px solid #eef0f3;vertical-align:top}
      .d{color:#6b7280;font-size:11.5px;margin-top:3px}
      .s{font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px}
      .s-crit{background:#fef2f2;color:#dc2626}.s-high{background:#fff5ed;color:#ea580c}
      .s-med{background:#fffbeb;color:#d97706}.s-low{background:#eff6ff;color:#2563eb}.s-info{background:#f3f4f6;color:#6b7280}
      .ft{margin-top:30px;color:#9ca3af;font-size:11px;border-top:1px solid #e5e7eb;padding-top:12px}
      @media print{body{padding:20px}}
    </style></head><body>
    <div class="hd"><div class="logo"><span class="b">C</span> CYMAG Enterprise</div>
      <div class="mut" style="text-align:right">Relatório ${kind === "detailed" ? "Executivo (com IA)" : "Técnico"}<br>${when}</div></div>
    <h1>Avaliação de segurança — ${esc(s.target || "")}</h1>
    <p class="mut">Documento gerado pela plataforma CYMAG. Valores de risco e impacto são estimativas para priorização.</p>
    <div class="kpis">
      <div class="kpi"><div class="n">${s.risk_score ?? 0}/100</div><div class="l">Índice de risco</div></div>
      <div class="kpi"><div class="n">${list.length}</div><div class="l">Vulnerabilidades</div></div>
      <div class="kpi"><div class="n">${counts.crit}</div><div class="l">Críticas</div></div>
      <div class="kpi"><div class="n">${new Set(list.map(f => f.host)).size}</div><div class="l">Hosts afetados</div></div>
    </div>
    <h2 style="font-size:15px">Vulnerabilidades encontradas</h2>
    <table><thead><tr><th>Sev.</th><th>Vulnerabilidade</th><th>Ativo</th><th>CVE</th><th>CVSS</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="ft">CYMAG Enterprise · Relatório de demonstração · As estimativas não constituem perícia contábil.</div>
    <script>setTimeout(function(){window.print()},400)<\/script>
    </body></html>`);
  w.document.close();
  toast("Relatório aberto — use Ctrl+P para salvar em PDF.", "ok");
}

/* ─── BOOT: retoma sessão se houver ─── */
(async function boot() {
  try {
    const me = await api("/api/me");
    if (me.authenticated) enterApp(me);
  } catch (e) { /* não autenticado — fica no login */ }
})();
