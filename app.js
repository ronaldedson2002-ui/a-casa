// A CASA · login, navegação, Central da Casa, ambientes e backup
import { $, esc, root, db, S, toast, erro, dialog, closeDialog, memberName, loadRooms } from "./core.js";
import { vTarefas, loadTasks, painelCentral, taskTitle, tarefasOk, abertasNaSala } from "./tarefas.js";

/* ---------- login ---------- */
function showLogin(msg = "") {
  root.innerHTML = `
  <main class="login"><div class="card login-card">
    <div class="brand big">A Casa</div>
    <p class="lema">Administrar o presente. Preparar o futuro. Preservar a história.</p>
    <form id="f-login">
      <label>E-mail<input type="email" name="email" autocomplete="username" required></label>
      <label>Senha<input type="password" name="senha" autocomplete="current-password" required></label>
      <p class="erro" id="login-erro">${esc(msg)}</p>
      <button class="btn pri" style="width:100%">Entrar</button>
    </form>
  </div></main>`;
  $("#f-login").onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target, btn = f.querySelector("button");
    btn.disabled = true;
    const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.senha.value });
    if (error) { $("#login-erro").textContent = erro(error); btn.disabled = false; return; }
    boot();
  };
}
db.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") { S.user = S.me = null; showLogin(); } });

/* ---------- carga de dados ---------- */
async function loadContext() {
  const { data: ms, error } = await db.from("household_members").select("household_id,user_id,display_name,role").order("created_at");
  if (error) throw error;
  S.members = ms;
  S.me = ms.find(m => m.user_id === S.user.id) || null;
  if (!S.me) return;
  const { data: h, error: e2 } = await db.from("households").select("id,name").eq("id", S.me.household_id).single();
  if (e2) throw e2;
  S.household = h;
  await loadRooms();
}

/* ---------- estrutura da tela ---------- */
function shell() {
  root.innerHTML = `
  <header class="top"><div class="brand">${esc(S.household.name)}</div>
    <div class="who"><span>${esc(S.me.display_name)}</span><button class="link" id="b-sair">Sair</button></div></header>
  <main id="view"></main>
  <nav class="tabs" id="nav"><a href="#/central" data-r="central">Central</a><a href="#/tarefas" data-r="tarefas">Tarefas</a><a href="#/ambientes" data-r="ambientes">Ambientes</a></nav>`;
  $("#b-sair").onclick = () => db.auth.signOut();
}
const views = { central: vCentral, tarefas: vTarefas, ambientes: vAmbientes };
function route() {
  const r = location.hash.replace(/^#\/?/, "") || "central";
  const name = views[r] ? r : "central";
  document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.r === name));
  const el = $("#view");
  el.innerHTML = "";
  window.scrollTo(0, 0);
  views[name](el).catch(e => toast(erro(e), true));
}
window.addEventListener("hashchange", () => { if (S.me) route(); });

/* ---------- Central da Casa ---------- */
function descAtividade(l) {
  const n = l.new_data || {}, o = l.old_data || {};
  const verbo = { INSERT: "cadastrou", UPDATE: "atualizou", DELETE: "removeu" }[l.action] || l.action;
  if (l.table_name === "rooms") return `${verbo} o ambiente <b>${esc(n.name || o.name)}</b>`;
  if (l.table_name === "tasks") return `${{ INSERT: "criou", UPDATE: "atualizou", DELETE: "apagou" }[l.action]} a tarefa <b>${esc(n.title || o.title)}</b>`;
  if (l.table_name === "task_occurrences") {
    const titulo = esc(taskTitle(n.task_id || o.task_id));
    const acao = n.status !== o.status ? (n.status === "done" ? "concluiu" : n.status === "canceled" ? "cancelou" : "alterou a situação de") : "alterou o prazo de";
    return `${acao} a tarefa <b>${titulo}</b>`;
  }
  return `${verbo} um registro de ${esc(l.table_name)}`;
}
async function vCentral(el) {
  const d = new Date(), h = d.getHours();
  const saud = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  let data = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  data = data.charAt(0).toUpperCase() + data.slice(1);
  await loadTasks();
  const p = painelCentral();
  el.innerHTML = `
    <section class="hero"><h1>${saud}, ${esc(S.me.display_name.split(" ")[0])}.</h1><div class="mu">${esc(data)}</div></section>
    <div class="grid">${p.stat}<a class="card stat" href="#/ambientes"><b>${S.rooms.length}</b><span>ambientes cadastrados</span></a></div>
    ${p.lista}
    <h2>Atividade recente</h2>
    <div class="card" id="atv">Carregando…</div>
    <p class="mu sm nota">Estoque, compras e os demais painéis aparecerão aqui conforme cada módulo for ativado. Esta tela mostra apenas dados realmente registrados.</p>
    <div class="foot"><button class="btn" id="b-bkp">Baixar backup (JSON)</button></div>`;
  $("#b-bkp").onclick = backup;

  const { data: logs, error } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(8);
  const box = $("#atv");
  if (error) { box.textContent = "Não foi possível carregar o histórico."; return; }
  if (!logs.length) { box.innerHTML = `<span class="mu">Nenhuma atividade registrada ainda.</span>`; return; }
  box.innerHTML = `<ul class="atv">` + logs.map(l => {
    const quando = new Date(l.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    return `<li><b>${esc(memberName(l.changed_by))}</b> ${descAtividade(l)}<div class="mu sm">${esc(quando)}</div></li>`;
  }).join("") + `</ul>`;
}

/* ---------- Ambientes ---------- */
async function vAmbientes(el) {
  el.innerHTML = `
    <h1>Ambientes</h1>
    <p class="mu sm">Os cômodos e espaços da casa. Bens e produtos serão ligados a eles nas próximas fases.</p>
    <form id="f-room" class="card row-form">
      <input name="name" placeholder="Novo ambiente (ex.: Escritório)" required maxlength="60">
      <input name="description" placeholder="Descrição (opcional)" maxlength="200">
      <button class="btn pri">Adicionar</button>
    </form>
    <div id="rooms"></div>`;
  await loadTasks();
  drawRooms();

  $("#f-room").onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target, name = f.name.value.trim();
    if (!name) return;
    const sort = S.rooms.reduce((m, r) => Math.max(m, r.sort_order || 0), 0) + 1;
    const { error } = await db.from("rooms").insert({ household_id: S.me.household_id, name, description: f.description.value.trim() || null, sort_order: sort });
    if (error) return toast(erro(error), true);
    await loadRooms(); drawRooms(); f.reset(); toast("Ambiente adicionado.");
  };
  $("#rooms").onclick = ev => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const room = S.rooms.find(r => r.id === b.dataset.id);
    if (!room) return;
    if (b.dataset.act === "edit") editRoom(room); else delRoom(room);
  };
}
function drawRooms() {
  const box = $("#rooms");
  if (!box) return;
  box.innerHTML = S.rooms.length ? S.rooms.map(r => {
    const n = abertasNaSala(r.id);
    return `<article class="card room"><div><h3>${esc(r.name)}</h3>${r.description ? `<p>${esc(r.description)}</p>` : ""}${n ? `<p>${n} tarefa${n > 1 ? "s" : ""} em aberto</p>` : ""}</div>
      <div class="acts"><button class="btn sm" data-act="edit" data-id="${r.id}">Editar</button><button class="btn sm" data-act="del" data-id="${r.id}">Apagar</button></div></article>`;
  }).join("") : `<p class="mu">Nenhum ambiente cadastrado.</p>`;
}
function editRoom(room) {
  dialog(`<h3>Editar ambiente</h3>
    <form id="f-ed"><label>Nome<input name="name" value="${esc(room.name)}" required maxlength="60"></label>
    <label>Descrição<textarea name="description" rows="3" maxlength="200">${esc(room.description || "")}</textarea></label>
    <div class="dacts"><button type="button" class="btn" data-close>Cancelar</button><button class="btn pri">Salvar</button></div></form>`);
  $("#f-ed").onsubmit = async ev => {
    ev.preventDefault();
    const f = ev.target, name = f.name.value.trim();
    if (!name) return;
    const { data, error } = await db.from("rooms").update({ name, description: f.description.value.trim() || null }).eq("id", room.id).select();
    if (error) return toast(erro(error), true);
    if (!data.length) return toast("Não foi possível salvar a alteração.", true);
    closeDialog(); await loadRooms(); drawRooms(); toast("Ambiente atualizado.");
  };
}
function delRoom(room) {
  dialog(`<h3>Apagar ambiente?</h3><p>Apagar “${esc(room.name)}”? As tarefas ligadas a ele continuam existindo, só ficam sem ambiente. A alteração fica registrada no histórico.</p>
    <div class="dacts"><button class="btn" data-close>Cancelar</button><button class="btn dn" id="b-del">Apagar</button></div>`);
  $("#b-del").onclick = async () => {
    const { data, error } = await db.from("rooms").delete().eq("id", room.id).select();
    if (error) return toast(erro(error), true);
    if (!data.length) return toast("Não foi possível apagar o ambiente.", true);
    closeDialog(); await loadRooms(); drawRooms(); toast("Ambiente apagado.");
  };
}

/* ---------- Backup ---------- */
async function fetchAll(tabela) {
  let todos = [], de = 0;
  for (;;) {
    const { data, error } = await db.from(tabela).select("*").range(de, de + 999);
    if (error) throw error;
    todos = todos.concat(data);
    if (data.length < 1000) return todos;
    de += 1000;
  }
}
async function backup() {
  const btn = $("#b-bkp");
  btn.disabled = true;
  try {
    const tabelas = ["households", "household_members", "rooms", "audit_logs", ...(tarefasOk() ? ["tasks", "task_occurrences"] : [])];
    const out = { app: "A Casa", versao: 2, exportado_em: new Date().toISOString() };
    for (const t of tabelas) out[t] = await fetchAll(t);
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `a-casa-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Backup baixado.");
  } catch (e) { toast("Falha no backup: " + erro(e), true); }
  btn.disabled = false;
}

/* ---------- início ---------- */
async function boot() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return showLogin();
    S.user = session.user;
    await loadContext();
    if (!S.me) {
      root.innerHTML = `<main class="login"><div class="card login-card"><p>Sua conta ainda não está vinculada a uma residência. Execute o script 002 no Supabase e entre de novo.</p><button class="btn" id="b-sair">Sair</button></div></main>`;
      $("#b-sair").onclick = () => db.auth.signOut();
      return;
    }
    shell(); route();
  } catch (e) {
    root.innerHTML = `<main class="login"><div class="card login-card"><p>Não foi possível carregar os dados: ${esc(erro(e))}</p><button class="btn" onclick="location.reload()">Tentar de novo</button></div></main>`;
  }
}
boot();
