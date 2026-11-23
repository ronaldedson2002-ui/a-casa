// A CASA · Fase 2 · Tarefas
import { $, esc, db, S, toast, erro, dialog, closeDialog, memberName, hojeISO, fmtDia } from "./core.js";

const T = { ok: true, err: null, tasks: [], open: [], closed: [], filtro: "abertas" };
const ABERTAS = ["pending", "in_progress", "postponed"];
const MODO = { fixed: "Fixa (um responsável)", shared: "Compartilhada (os dois)", flexible: "Flexível (quem puder)" };
const FREQ = { none: "Não se repete", daily: "Todo dia", weekly: "Toda semana", biweekly: "A cada 15 dias", monthly: "Todo mês", custom: "Personalizada" };
const DEPT = { rotina: "Rotina e vida familiar", limpeza: "Limpeza e organização", alimentacao: "Alimentação e cozinha", compras: "Compras e abastecimento", manutencao: "Manutenção e patrimônio", financas: "Finanças domésticas", memoria: "Memória e projetos" };
const ST = { pending: "Pendente", in_progress: "Em andamento", postponed: "Adiada", done: "Concluída", canceled: "Cancelada" };

const taskById = id => T.tasks.find(t => t.id === id);
export const taskTitle = id => (taskById(id) || {}).title || "uma tarefa";
export const tarefasOk = () => T.ok;
const roomName = id => (S.rooms.find(r => r.id === id) || {}).name || "";
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v)}</option>`).join("");

export async function loadTasks() {
  const [a, b, c] = await Promise.all([
    db.from("tasks").select("*").order("created_at"),
    db.from("task_occurrences").select("*").in("status", ABERTAS),
    db.from("task_occurrences").select("*").in("status", ["done", "canceled"]).order("completed_at", { ascending: false, nullsFirst: false }).limit(40)
  ]);
  const err = a.error || b.error || c.error;
  if (err) { T.ok = false; T.err = err; return T; }
  T.ok = true; T.err = null; T.tasks = a.data; T.open = b.data; T.closed = c.data;
  return T;
}
export const abertasNaSala = roomId => T.ok ? T.open.filter(o => (taskById(o.task_id) || {}).room_id === roomId).length : 0;

/* ---------- apresentação ---------- */
const sortOcc = l => [...l].sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.created_at.localeCompare(b.created_at));
const freqLabel = t => t.recurrence === "custom" ? `A cada ${t.recurrence_days} dias` : FREQ[t.recurrence];
const respLabel = t => t.mode === "fixed" ? memberName(t.assignee_id) : t.mode === "shared" ? "Compartilhada" : "Flexível";

function meta(o, t) {
  const hoje = hojeISO(), p = [];
  if (o.due_date) p.push(o.due_date < hoje ? `<span class="late">${esc(fmtDia(o.due_date))} (atrasada)</span>` : esc(fmtDia(o.due_date)));
  if (t.room_id) p.push(esc(roomName(t.room_id)));
  p.push(esc(respLabel(t)));
  if (t.recurrence !== "none") p.push("↻ " + esc(freqLabel(t)));
  return p.join(" · ") + (o.status !== "pending" ? ` <span class="tag">${ST[o.status]}</span>` : "");
}

/* ---------- Painel para a Central da Casa ---------- */
export function painelCentral() {
  if (!T.ok) return { stat: "", lista: "" };
  const hoje = hojeISO();
  const atras = T.open.filter(o => o.due_date && o.due_date < hoje).length;
  const stat = `<a class="card stat" href="#/tarefas"><b>${T.open.length}</b><span>tarefas em aberto${atras ? ` · <span class="late">${atras} atrasada${atras > 1 ? "s" : ""}</span>` : ""}</span></a>`;
  const top = sortOcc(T.open).slice(0, 5);
  const lista = `<h2>Próximas tarefas</h2><div class="card">` + (top.length
    ? `<ul class="atv">` + top.map(o => { const t = taskById(o.task_id); return t ? `<li><a class="tl" href="#/tarefas"><b>${esc(t.title)}</b></a><div class="mu sm">${meta(o, t)}</div></li>` : ""; }).join("") + `</ul>`
    : `<span class="mu">Nenhuma tarefa em aberto.</span>`) + `</div>`;
  return { stat, lista };
}

/* ---------- tela de Tarefas ---------- */
export async function vTarefas(el) {
  el.innerHTML = `<div class="head"><h1>Tarefas</h1><button class="btn pri" id="b-nova">Nova tarefa</button></div>
    <div class="filtros" id="fil"></div><div id="lista">Carregando…</div>`;
  await loadTasks();
  draw();

  $("#b-nova").onclick = () => { if (T.ok) formTarefa(null); };
  $("#fil").onclick = ev => {
    const b = ev.target.closest("button[data-f]");
    if (b) { T.filtro = b.dataset.f; draw(); }
  };
  $("#lista").onclick = ev => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const occ = T.open.find(o => o.id === b.dataset.id);
    if (!occ) return;
    if (b.dataset.act === "done") concluir(occ); else formTarefa(occ);
  };
}

function draw() {
  const fil = $("#fil"), box = $("#lista");
  if (!fil || !box) return;
  if (!T.ok) {
    fil.innerHTML = "";
    box.innerHTML = `<div class="card"><p>O módulo de tarefas ainda não está instalado no banco. Execute o script <b>003_tarefas.sql</b> no SQL Editor do Supabase e recarregue a página.</p><p class="mu sm">${esc(erro(T.err))}</p></div>`;
    return;
  }
  const F = { abertas: "Em aberto", minhas: "Minhas", concluidas: "Concluídas" };
  fil.innerHTML = Object.entries(F).map(([k, v]) => `<button class="${T.filtro === k ? "on" : ""}" data-f="${k}">${v}</button>`).join("");

  if (T.filtro === "concluidas") {
    box.innerHTML = T.closed.length ? `<div class="card">` + T.closed.map(o => {
      const t = taskById(o.task_id); if (!t) return "";
      const quando = o.completed_at ? new Date(o.completed_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
      return `<div class="trow done"><div class="fx"><div class="t">${esc(t.title)}</div><div class="mu sm">${o.status === "done" ? "Concluída" : "Cancelada"} por ${esc(memberName(o.completed_by))} · ${esc(quando)}</div></div></div>`;
    }).join("") + `</div>` : `<p class="mu">Nenhuma tarefa concluída ainda.</p>`;
    return;
  }

  let lista = sortOcc(T.open);
  if (T.filtro === "minhas") lista = lista.filter(o => { const t = taskById(o.task_id); return t && (t.mode === "shared" || (t.mode === "fixed" && t.assignee_id === S.user.id)); });
  if (!lista.length) { box.innerHTML = `<p class="mu">${T.filtro === "minhas" ? "Nenhuma tarefa sua em aberto." : "Nenhuma tarefa em aberto. Use “Nova tarefa” para começar."}</p>`; return; }

  const hoje = hojeISO();
  const grupos = [["Atrasadas", o => o.due_date && o.due_date < hoje], ["Hoje", o => o.due_date === hoje], ["Próximas", o => o.due_date && o.due_date > hoje], ["Sem prazo", o => !o.due_date]];
  box.innerHTML = grupos.map(([nome, f]) => {
    const g = lista.filter(f);
    if (!g.length) return "";
    return `<h2>${nome}</h2><div class="card">` + g.map(o => {
      const t = taskById(o.task_id); if (!t) return "";
      return `<div class="trow"><button class="chk" data-act="done" data-id="${o.id}" aria-label="Concluir ${esc(t.title)}"></button>
        <div class="fx"><div class="t">${esc(t.title)}</div><div class="mu sm">${meta(o, t)}</div></div>
        <button class="btn sm" data-act="edit" data-id="${o.id}">Editar</button></div>`;
    }).join("") + `</div>`;
  }).join("");
}

/* ---------- criar / editar ---------- */
function formTarefa(occ) {
  const t = occ ? taskById(occ.task_id) : null;
  const salas = `<option value="">Sem ambiente</option>` + S.rooms.map(r => `<option value="${r.id}"${t && t.room_id === r.id ? " selected" : ""}>${esc(r.name)}</option>`).join("");
  const pessoas = S.members.map(m => `<option value="${m.user_id}"${(t ? t.assignee_id : S.user.id) === m.user_id ? " selected" : ""}>${esc(m.display_name)}</option>`).join("");
  dialog(`<h3>${t ? "Editar tarefa" : "Nova tarefa"}</h3>
  <form id="f-t">
    <label>Título<input name="title" required maxlength="100" value="${esc(t && t.title)}"></label>
    <label>Descrição<textarea name="description" rows="2" maxlength="500">${esc(t && t.description)}</textarea></label>
    <div class="two"><label>Ambiente<select name="room_id">${salas}</select></label>
      <label>Departamento<select name="department">${opts(DEPT, t ? t.department : "rotina")}</select></label></div>
    <div class="two"><label>Modalidade<select name="mode">${opts(MODO, t ? t.mode : "shared")}</select></label>
      <label id="l-resp">Responsável<select name="assignee_id">${pessoas}</select></label></div>
    <div class="two"><label>Repetição<select name="recurrence">${opts(FREQ, t ? t.recurrence : "none")}</select></label>
      <label id="l-dias">A cada quantos dias<input type="number" name="recurrence_days" min="1" max="365" value="${esc(t && t.recurrence_days)}"></label></div>
    <div class="two"><label>Prazo<input type="date" name="due_date" value="${esc(occ && occ.due_date)}"></label>
      ${occ ? `<label>Situação<select name="status">${opts({ pending: ST.pending, in_progress: ST.in_progress, postponed: ST.postponed }, occ.status)}</select></label>` : ""}</div>
    <label>Materiais necessários<input name="materials" maxlength="200" value="${esc(t && t.materials)}"></label>
    <p class="erro" id="t-erro"></p>
    <div class="dacts wrap">${t ? `<button type="button" class="btn dn" id="b-apagar">Apagar</button>` : ""}<button type="button" class="btn" data-close>Cancelar</button><button class="btn pri" id="b-salvar">Salvar</button></div>
  </form>`);

  const f = $("#f-t"), aviso = m => ($("#t-erro").textContent = m);
  const sync = () => { $("#l-resp").hidden = f.mode.value !== "fixed"; $("#l-dias").hidden = f.recurrence.value !== "custom"; };
  f.mode.onchange = f.recurrence.onchange = sync; sync();

  f.onsubmit = async ev => {
    ev.preventDefault();
    const v = new FormData(f), title = v.get("title").trim();
    if (!title) return aviso("Informe o título.");
    const mode = v.get("mode"), rec = v.get("recurrence");
    const assignee = mode === "fixed" ? v.get("assignee_id") || null : null;
    if (mode === "fixed" && !assignee) return aviso("Escolha o responsável.");
    const dias = rec === "custom" ? parseInt(v.get("recurrence_days"), 10) : null;
    if (rec === "custom" && !(dias > 0)) return aviso("Informe de quantos em quantos dias a tarefa se repete.");
    const campos = { title, description: v.get("description").trim() || null, room_id: v.get("room_id") || null, department: v.get("department"),
      mode, assignee_id: assignee, recurrence: rec, recurrence_days: dias, materials: (v.get("materials") || "").trim() || null };
    const due = v.get("due_date") || null;
    const btn = $("#b-salvar"); btn.disabled = true;
    try {
      if (!t) {
        const { data: nova, error } = await db.from("tasks").insert({ household_id: S.me.household_id, ...campos }).select().single();
        if (error) throw error;
        const { error: e2 } = await db.from("task_occurrences").insert({ household_id: S.me.household_id, task_id: nova.id, due_date: due, status: "pending" });
        if (e2) { await db.from("tasks").delete().eq("id", nova.id); throw e2; }
      } else {
        const r1 = await db.from("tasks").update(campos).eq("id", t.id).select();
        if (r1.error) throw r1.error;
        if (!r1.data.length) throw new Error("Não foi possível salvar a alteração.");
        const r2 = await db.from("task_occurrences").update({ due_date: due, status: v.get("status") }).eq("id", occ.id).select();
        if (r2.error) throw r2.error;
        if (!r2.data.length) throw new Error("Não foi possível salvar o prazo.");
      }
      closeDialog(); await loadTasks(); draw(); toast(t ? "Tarefa atualizada." : "Tarefa criada.");
    } catch (e) { aviso(erro(e)); btn.disabled = false; }
  };

  if (t) $("#b-apagar").onclick = () => {
    dialog(`<h3>Apagar tarefa?</h3><p>Apagar “${esc(t.title)}”${t.recurrence !== "none" ? " e todas as suas repetições" : ""}? Isso não pode ser desfeito.</p>
      <div class="dacts"><button class="btn" data-close>Voltar</button><button class="btn dn" id="b-ok">Apagar</button></div>`);
    $("#b-ok").onclick = async () => {
      const { data, error } = await db.from("tasks").delete().eq("id", t.id).select();
      if (error) return toast(erro(error), true);
      if (!data.length) return toast("Não foi possível apagar a tarefa.", true);
      closeDialog(); await loadTasks(); draw(); toast("Tarefa apagada.");
    };
  };
}

/* ---------- concluir ---------- */
function previsao(t) {
  const [y, m, d] = hojeISO().split("-").map(Number);
  if (t.recurrence === "monthly") {
    const ultimo = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d, ultimo), 12).toISOString().slice(0, 10);
  }
  const passo = { daily: 1, weekly: 7, biweekly: 14, custom: t.recurrence_days }[t.recurrence];
  const x = new Date(y, m - 1, d + passo, 12);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function concluir(occ) {
  const t = taskById(occ.task_id), rec = t.recurrence !== "none";
  dialog(`<h3>Concluir tarefa?</h3><p><b>${esc(t.title)}</b></p>
    ${rec ? `<p class="mu sm">Esta tarefa se repete: a próxima ficará para ${esc(fmtDia(previsao(t)))}, contando a partir de hoje.</p>` : ""}
    <div class="dacts wrap"><button class="btn" data-close>Voltar</button><button class="btn" id="b-skip">${rec ? "Pular desta vez" : "Cancelar tarefa"}</button><button class="btn pri" id="b-ok">Concluir</button></div>`);
  const fim = async status => {
    $("#b-ok").disabled = $("#b-skip").disabled = true;
    const { error } = await db.rpc("finish_occurrence", { p_id: occ.id, p_status: status });
    if (error) { toast(erro(error), true); $("#b-ok").disabled = $("#b-skip").disabled = false; return; }
    closeDialog(); await loadTasks(); draw(); toast(status === "done" ? "Tarefa concluída." : "Tarefa cancelada.");
  };
  $("#b-ok").onclick = () => fim("done");
  $("#b-skip").onclick = () => fim("canceled");
}
