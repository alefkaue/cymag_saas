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

/* ─── API ─── */
async function api(path, { method = "GET", body = null } = {}) {
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
function openModal(html) { $("#modal").innerHTML = html; $("#modal-back").classList.add("open"); }
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
  planos:      { title: "Planos", sub: "Assinaturas, recursos e preços" },
};
// A tela é escolhida pelo PAPEL:
//   owner (dono)     → só o resumo de negócio + conta. Não vê o console técnico.
//   operator (TI)    → console técnico: scan, autônomo, engagements, áreas, histórico.
//   viewer           → painel executivo (leitura).
//   cymag/admin      → console técnico + Central (entrega gerenciada).
const NAV = {
  operator: ["overview", "scan", "autonomous", "engagements", "areas", "history"],
  owner:    ["resumo", "conta"],
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
  showSection(items[0]);
}

async function logout() {
  try { await api("/api/logout", { method: "POST" }); } catch (e) {}
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
        ${["crit", "high", "med", "low", "info"].map(k =>
          `<div class="row spread" style="padding:.35rem 0;border-bottom:1px solid var(--line)">${sevBadge(k)}<b class="mono">${counts[k] || 0}</b></div>`).join("")}
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
    <div class="card mb" style="border-left:3px solid ${gaugeColor(score)}">
      <p style="margin:0">${riskPlainText(score, sum)}</p>
    </div>
    <div class="card-title-row"><h3 style="margin:.4rem 0">Problemas encontrados</h3><span class="mut">${d.problems.length} listado(s), do mais grave ao mais leve</span></div>
    <div id="resumo-problems">${d.problems.map(problemCard).join("") || '<div class="card"><p class="empty">Nenhum problema encontrado. 🎉</p></div>'}</div>`;

  $$("[data-budget]", box).forEach(btn => btn.addEventListener("click", () => {
    const item = d.problems.find(p => String(p.finding_id) === btn.dataset.budget);
    if (item) openBudgetModal(item);
  }));
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

/* ═══════════ PLANOS ═══════════ */
const BRL = (v) => v === 0 ? "Grátis" : "R$ " + Number(v).toLocaleString("pt-BR");
function renderPlans() {
  const box = $("#sec-planos");
  box.innerHTML = `<div class="card"><span class="spinner"></span> <span class="mut">Carregando planos…</span></div>`;
  api("/api/plans").then(({ plans }) => {
    const cur = state.user?.plan?.key;
    box.innerHTML = `<div class="grid grid-4">${plans.map(p => {
      const feats = [
        { on: true, t: "Scanner Python + Go" },
        { on: p.autonomous, t: "Agente autônomo" },
        { on: p.ai, t: "Copiloto de IA (AEGIS)" },
        { on: p.training, t: "Treinamento / onboarding" },
        { on: p.managed, t: "Pentest gerenciado + laudo assinado" },
      ];
      return `<div class="card" style="${p.key === cur ? "border:1px solid var(--blue)" : ""}">
        <div class="row spread"><h3>${esc(p.name)}</h3>${p.key === cur ? '<span class="badge badge-area">Seu plano</span>' : ""}</div>
        <div style="font-size:1.5rem;font-weight:700;margin:.3rem 0">${BRL(p.price_month)}<span class="mut" style="font-size:.8rem;font-weight:400">/mês</span></div>
        <div class="mut" style="font-size:.78rem;margin-bottom:.6rem">${p.price_year ? BRL(p.price_year) + "/ano" : "sob consulta"} · ${p.scans_per_month === null ? "scans ilimitados" : p.scans_per_month + " scans/mês"}</div>
        <p class="mut" style="font-size:.76rem;min-height:2.4em;margin:0 0 .5rem">${esc(p.tagline || "")}</p>
        <div style="font-size:.82rem">${feats.map(f => `<div style="padding:.2rem 0;${f.on ? "" : "opacity:.4"}">${f.on ? "✅" : "—"} ${f.t}</div>`).join("")}</div>
        <p class="mut" style="font-size:.74rem;margin:.6rem 0 0">${esc(p.audience)}</p>
      </div>`;
    }).join("")}</div>
    <p class="mut" style="margin-top:1rem;font-size:.8rem">Enterprise: preço a partir do exibido, sob consulta (per-IP, on-prem, integrações e OT/IoT).</p>`;
  }).catch(() => { box.innerHTML = `<div class="card"><p class="mut">Falha ao carregar planos.</p></div>`; });
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

/* ─── PDF ─── */
async function downloadPDF(kind) {
  const s = state.lastScan;
  if (!s) { toast("Rode um scan primeiro.", "err"); return; }
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

/* ─── BOOT: retoma sessão se houver ─── */
(async function boot() {
  try {
    const me = await api("/api/me");
    if (me.authenticated) enterApp(me);
  } catch (e) { /* não autenticado — fica no login */ }
})();
