// A CASA · núcleo compartilhado (cliente do banco, estado, utilidades)
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const $ = (s, r = document) => r.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const root = $("#root");
const dlg = $("#dlg");

if (!window.supabase) {
  root.innerHTML = `<main class="login"><div class="card login-card"><p>Não foi possível carregar a biblioteca do Supabase. Verifique a conexão e recarregue a página.</p></div></main>`;
  throw new Error("supabase-js não carregou");
}
export const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Estado em memória (os dados de verdade ficam no Supabase)
export const S = { user: null, me: null, household: null, members: [], rooms: [] };

let toastTimer;
export function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "on" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 5000);
}
export function erro(e) {
  const m = (e && e.message) || String(e);
  if (/Invalid login/i.test(m)) return "E-mail ou senha incorretos.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Sem conexão com o servidor. Tente de novo.";
  return m;
}
export function dialog(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); }
export const closeDialog = () => dlg.close();
dlg.addEventListener("click", e => { if (e.target.closest("[data-close]")) dlg.close(); });

export const memberName = id => (S.members.find(m => m.user_id === id) || {}).display_name || "Alguém";

const p2 = n => String(n).padStart(2, "0");
export const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export function fmtDia(iso) {
  if (!iso) return "Sem prazo";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
}

export async function loadRooms() {
  const { data, error } = await db.from("rooms").select("*").order("sort_order").order("name");
  if (error) throw error;
  S.rooms = data;
}
