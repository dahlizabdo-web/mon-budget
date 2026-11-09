const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const monthNow = () => today().slice(0, 7);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();

// State par défaut
let db;
let state = {
  opening: { "CCP1": 0, "CCP2": 0, "Espèces": 0, "Épargne": 0 },
  operations: [],
  theme: "dark",
  currency: "DZD",
  accounts: ["CCP1", "CCP2", "Espèces", "Épargne"],
  categories: ["Alimentations", "Voiture", "Santé", "Cadeaux", "Houssam", "Safa", "Maroua", "Maison", "Autres"],
  limits: { global: 0 }
};

// Formateur de devise
const money = n => {
  let sym = state.currency === "EUR" ? " €" : state.currency === "USD" ? " $" : state.currency === "CAD" ? " $CA" : state.currency === "MAD" ? " MAD" : state.currency === "TND" ? " DT" : " DA";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(n) || 0) + sym;
};

function formatDate(date) {
  if (!date) return "";
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// -----------------------------------------------------
// IndexedDB Storage & Migrations
// -----------------------------------------------------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("MonBudgetDB", 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("state")) d.createObjectStore("state");
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function readState() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readonly");
    const r = tx.objectStore("state").get("main");
    r.onsuccess = () => {
      if (r.result) {
        state = { ...state, ...r.result };
        
        // MIGRATION DES PRÉNOMS: Enfant1 -> Houssam, etc.
        let migrated = false;
        state.operations.forEach(o => {
          if (o.category === "Enfant1") { o.category = "Houssam"; migrated = true; }
          if (o.category === "Enfant2") { o.category = "Safa"; migrated = true; }
          if (o.category === "Enfant3") { o.category = "Maroua"; migrated = true; }
        });
        
        if (state.categories) {
          state.categories = state.categories.map(c => {
            if (c === "Enfant1") return "Houssam";
            if (c === "Enfant2") return "Safa";
            if (c === "Enfant3") return "Maroua";
            return c;
          });
        }
        
        if(!state.accounts) state.accounts = ["CCP1", "CCP2", "Espèces", "Épargne"];
        if(!state.categories) state.categories = ["Alimentations", "Voiture", "Santé", "Cadeaux", "Houssam", "Safa", "Maroua", "Maison", "Autres"];
        if(!state.limits) state.limits = { global: 0 };
        
        if(migrated) save(); // auto-save migrated data
      }
      resolve();
    };
    r.onerror = () => reject(r.error);
  });
}

function save() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(state, "main");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// -----------------------------------------------------
// UI Utilities
// -----------------------------------------------------
function showToast(msg, type="normal") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  $("toastContainer").append(t);
  setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

function customConfirm(msg) {
  return new Promise(resolve => {
    const d = $("confirmDialog");
    $("confirmMsg").textContent = msg;
    const onOk = () => { cleanup(); resolve(true); d.close(); };
    const onCancel = () => { cleanup(); resolve(false); d.close(); };
    const btnOk = $("okConfirm");
    const btnCancel = $("cancelConfirm");
    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
    function cleanup() {
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
    }
    d.showModal();
  });
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// -----------------------------------------------------
// Calculs
// -----------------------------------------------------
function balance(account) {
  return Number(state.opening[account] || 0) + state.operations.reduce((s, o) => {
    if (o.type === "income" && o.account === account) return s + o.amount;
    if (o.type === "expense" && o.account === account) return s - o.amount;
    if (o.type === "transfer") {
      if (o.account === account) return s - o.amount;
      if (o.destination === account) return s + o.amount;
    }
    return s;
  }, 0);
}

function totals(month) {
  const ops = state.operations.filter(o => o.date.startsWith(month));
  return {
    income: ops.filter(o => o.type === "income").reduce((s, o) => s + o.amount, 0),
    expense: ops.filter(o => o.type === "expense").reduce((s, o) => s + o.amount, 0)
  };
}

function expensesByCategory(month) {
  const map = Object.fromEntries(state.categories.map(c => [c, 0]));
  state.operations.filter(o => o.type === "expense" && o.date.startsWith(month)).forEach(o => {
    map[o.category] = (map[o.category] || 0) + o.amount;
  });
  return map;
}

// -----------------------------------------------------
// Rendu UI
// -----------------------------------------------------
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("themeToggle").textContent = state.theme === "dark" ? "☼" : "☾";
}

function renderBars(target, month) {
  const map = expensesByCategory(month);
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  $(target).innerHTML = "";
  if (!total) {
    $(target).innerHTML = '<p class="empty">Aucune dépense pour ce mois.</p>';
    return;
  }
  
  const sortedCats = Object.keys(map).sort((a,b) => map[b] - map[a]).filter(c => map[c] > 0);
  
  sortedCats.forEach(c => {
    const amount = map[c];
    const pct = (amount / total) * 100;
    
    // Check Limits for visual warning
    const catLimit = state.limits?.[c] || 0;
    const isWarning = catLimit > 0 && amount >= catLimit;
    
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label" title="${escapeHTML(c)}">${escapeHTML(c)}</div>
      <div class="bar-track" title="${pct.toFixed(1)}%">
        <div class="bar-fill ${isWarning ? 'warning' : ''}" style="width:${Math.min(pct, 100)}%"></div>
      </div>
      <div class="bar-numbers">
        <strong class="${isWarning ? 'text-red' : ''}">${isWarning ? '⚠️ ' : ''}${pct.toFixed(1).replace(".", ",")}%</strong>
        ${money(amount)} ${catLimit > 0 ? `<span class="muted small">/ ${money(catLimit)}</span>` : ''}
      </div>
    `;
    $(target).append(row);
  });
}

function renderMonthly(target) {
  const host = $(target);
  host.innerHTML = "";
  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(x.toISOString().slice(0, 7));
  }
  const vals = months.map(m => totals(m).expense);
  const max = Math.max(...vals, 1);
  months.forEach((m, i) => {
    const col = document.createElement("div");
    col.className = "month-col";
    const label = new Date(m + "-01").toLocaleDateString("fr-FR", { month: "short" });
    col.title = `${label}: ${money(vals[i])}`;
    col.innerHTML = `
      <div class="month-value">${vals[i] ? Math.round(vals[i] / 1000) + "k" : "0"}</div>
      <div class="month-stick" style="height:${Math.max(2, (vals[i] / max) * 90)}px"></div>
      <div class="month-label">${label}</div>
    `;
    host.append(col);
  });
}

function opDescription(o) {
  return o.note || (o.type === "expense" ? o.category : o.type === "income" ? "Revenu" : "Transfert");
}

function operationHTML(o) {
  const sign = o.type === "expense" ? "−" : o.type === "income" ? "+" : "⇄";
  const amount = o.type === "transfer" ? `${money(o.amount)} · ${o.account} → ${o.destination}` : money(o.amount);
  return `<div class="operation-row">
    <div class="op-main">
      <div class="op-icon">${sign}</div>
      <div>
        <div class="op-title">${escapeHTML(opDescription(o))}</div>
        <div class="op-sub">${escapeHTML(formatDate(o.date))} · ${escapeHTML(o.account)}${o.type === "expense" ? " · " + escapeHTML(o.category) : ""}</div>
      </div>
    </div>
    <div class="op-amount ${o.type}">${o.type === "expense" ? "−" : o.type === "income" ? "+" : ""}${amount}</div>
  </div>`;
}

function renderAccounts() {
  $("accountCards").innerHTML = state.accounts.map(a => `
    <div class="account-card">
      <div class="account-name">${escapeHTML(a)}</div>
      <div class="account-balance">${money(balance(a))}</div>
      <div class="muted small">Solde actuel</div>
    </div>`).join("");

  $("openingForm").innerHTML = state.accounts.map(a => `
    <label>${escapeHTML(a)} — solde initial
      <input type="number" min="0" step="0.01" data-opening="${escapeHTML(a)}" value="${Number(state.opening[a] || 0)}">
    </label>`).join("");
}

function renderOperations() {
  const q = $("operationSearch").value.toLowerCase();
  const type = $("typeFilter").value;
  const ops = [...state.operations]
    .filter(o => (type === "all" || o.type === type) && [opDescription(o), o.account, o.category || "", o.date].join(" ").toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
    
  $("allOperations").innerHTML = ops.length ? ops.map(o => operationHTML(o) + `<div class="row-actions"><button class="text-btn delete-op" data-id="${o.id}">Supprimer</button></div>`).join("") : '<p class="empty">Aucune opération correspondante.</p>';
}

function renderSettings() {
  $("currencySelect").value = state.currency;
  
  $("catList").innerHTML = state.categories.map(c => `
    <span class="badge">${escapeHTML(c)} 
      <button class="del-btn del-cat" data-name="${escapeHTML(c)}">×</button>
    </span>`).join("");
    
  $("accList").innerHTML = state.accounts.map(a => `
    <span class="badge">${escapeHTML(a)} 
      <button class="del-btn del-acc" data-name="${escapeHTML(a)}">×</button>
    </span>`).join("");
    
  // Limits settings
  $("globalLimit").value = state.limits?.global || 0;
  $("catLimitsList").innerHTML = state.categories.map(c => `
    <label>${escapeHTML(c)}
      <input type="number" class="cat-limit-input" data-cat="${escapeHTML(c)}" value="${state.limits?.[c] || 0}" min="0" step="1">
    </label>
  `).join("");
    
  $("appFooter").innerHTML = `MON BUDGET <span>•</span> ${escapeHTML(state.currency)} <span>•</span> STOCKAGE LOCAL`;
}

function render() {
  applyTheme();
  const month = $("monthFilter").value || monthNow();
  
  const totalBal = state.accounts.reduce((s, a) => s + balance(a), 0);
  $("totalBalance").textContent = money(totalBal);
  $("totalBalanceNote").textContent = state.accounts.join(" · ");
  
  const t = totals(month);
  $("monthIncome").textContent = money(t.income);
  
  // Affichage du plafond global sur le tableau de bord
  let globalExpenseHtml = money(t.expense);
  if (state.limits?.global > 0) {
    const isWarnGlobal = t.expense >= state.limits.global;
    globalExpenseHtml += ` <span class="muted small ${isWarnGlobal?'text-red':''}"><br>/ ${money(state.limits.global)}</span>`;
  }
  $("monthExpense").innerHTML = globalExpenseHtml;
  $("categoryTotal").textContent = money(t.expense);
  
  renderBars("categoryBars", month);
  renderMonthly("monthlyBars");
  
  $("accountSummary").innerHTML = state.accounts.map(a => `
    <div class="account-item">
      <span>${escapeHTML(a)}</span>
      <strong>${money(balance(a))}</strong>
    </div>`).join("");
    
  const recent = [...state.operations].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  $("recentOperations").innerHTML = recent.length ? recent.map(operationHTML).join("") : '<p class="empty">Aucune opération enregistrée.</p>';
  
  renderAccounts();
  renderOperations();
  renderSettings();
  
  const rm = $("reportMonth").value || month;
  $("reportMonth").value = rm;
  renderBars("reportCategories", rm);
  renderMonthly("reportMonthly");
}

function switchView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === view));
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openOperation(type) {
  if (state.accounts.length === 0) {
    showToast("Veuillez d'abord créer un compte dans les paramètres.");
    return;
  }
  $("operationForm").reset();
  $("opType").value = type;
  $("dialogTitle").textContent = type === "expense" ? "Ajouter une dépense" : type === "income" ? "Ajouter un revenu" : "Transférer de l'argent";
  $("opDate").value = today();
  
  $("opAccount").innerHTML = state.accounts.map(a => `<option value="${escapeHTML(a)}">${escapeHTML(a)}</option>`).join("");
  $("opCategory").innerHTML = state.categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
  updateDestinationSelect();
  
  $("categoryField").classList.toggle("hidden", type !== "expense");
  $("transferField").classList.toggle("hidden", type !== "transfer");
  $("opCategory").required = type === "expense";
  $("formError").textContent = "";
  $("operationDialog").showModal();
}

function updateDestinationSelect() {
  const currentAcc = $("opAccount").value;
  $("opDestination").innerHTML = state.accounts.filter(a => a !== currentAcc).map(a => `<option value="${escapeHTML(a)}">${escapeHTML(a)}</option>`).join("");
}

function closeDialog() {
  $("operationDialog").close();
}

// -----------------------------------------------------
// Événements
// -----------------------------------------------------
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => switchView(b.dataset.goto)));
document.querySelectorAll("[data-new]").forEach(b => b.addEventListener("click", () => openOperation(b.dataset.new)));

$("themeToggle").addEventListener("click", async () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  await save();
  render();
});

$("monthFilter").value = monthNow();
$("reportMonth").value = monthNow();
$("monthFilter").addEventListener("change", render);
$("reportMonth").addEventListener("change", render);
$("operationSearch").addEventListener("input", renderOperations);
$("typeFilter").addEventListener("change", renderOperations);
$("closeDialog").addEventListener("click", closeDialog);
$("cancelDialog").addEventListener("click", closeDialog);
$("opAccount").addEventListener("change", updateDestinationSelect);

$("operationForm").addEventListener("submit", async e => {
  e.preventDefault();
  const type = $("opType").value;
  const amount = Number($("opAmount").value);
  const account = $("opAccount").value;
  const destination = $("opDestination").value;
  const dateStr = $("opDate").value;
  
  if (!Number.isFinite(amount) || amount <= 0) {
    $("formError").textContent = "Saisissez un montant supérieur à zéro."; return;
  }
  if (type === "transfer" && account === destination) {
    $("formError").textContent = "Choisissez deux comptes différents."; return;
  }
  if (new Date(dateStr) > new Date()) {
    $("formError").textContent = "La date ne peut pas être dans le futur."; return;
  }
  
  const o = { id: uid(), type, amount, account, date: dateStr, note: $("opNote").value.trim() };
  if (type === "expense") o.category = $("opCategory").value;
  if (type === "transfer") o.destination = destination;
  
  // VERIFICATION DES PLAFONDS AVANT AJOUT
  let alertMsg = null;
  if (type === "expense") {
    const month = dateStr.slice(0, 7);
    const t = totals(month);
    const cats = expensesByCategory(month);
    const newGlobalTotal = t.expense + amount;
    const newCatTotal = (cats[o.category] || 0) + amount;
    
    let warnings = [];
    if (state.limits?.global > 0 && newGlobalTotal >= state.limits.global) {
      warnings.push(`Plafond global dépassé`);
    }
    if (state.limits?.[o.category] > 0 && newCatTotal >= state.limits[o.category]) {
      warnings.push(`Plafond ${o.category} dépassé`);
    }
    if (warnings.length > 0) alertMsg = "⚠️ Alerte Dépassement : " + warnings.join(" | ");
  }

  state.operations.push(o);
  await save();
  closeDialog();
  render();
  
  if (alertMsg) showToast(alertMsg, "alert");
  else showToast("Opération enregistrée !");
});

$("openingForm").addEventListener("change", async e => {
  const a = e.target.dataset.opening;
  if (!a) return;
  const v = Number(e.target.value);
  if (!Number.isFinite(v) || v < 0) { showToast("Solde invalide."); return; }
  state.opening[a] = v;
  await save();
  render();
});

$("allOperations").addEventListener("click", async e => {
  const b = e.target.closest(".delete-op");
  if (!b) return;
  const confirmed = await customConfirm("Voulez-vous vraiment supprimer cette opération ?");
  if (confirmed) {
    state.operations = state.operations.filter(o => o.id !== b.dataset.id);
    await save();
    render();
    showToast("Opération supprimée.");
  }
});

// Settings Management
$("currencySelect").addEventListener("change", async e => {
  state.currency = e.target.value; await save(); render(); showToast("Devise mise à jour.");
});
$("addAccBtn").addEventListener("click", async () => {
  const val = $("newAccInput").value.trim(); if(!val) return;
  if(state.accounts.includes(val)) { showToast("Ce compte existe déjà."); return; }
  state.accounts.push(val); $("newAccInput").value = ""; await save(); render(); showToast("Compte ajouté.");
});
$("addCatBtn").addEventListener("click", async () => {
  const val = $("newCatInput").value.trim(); if(!val) return;
  if(state.categories.includes(val)) { showToast("Cette catégorie existe déjà."); return; }
  state.categories.push(val); $("newCatInput").value = ""; await save(); render(); showToast("Catégorie ajoutée.");
});
$("accList").addEventListener("click", async e => {
  if(!e.target.classList.contains("del-acc")) return;
  const name = e.target.dataset.name;
  if(state.accounts.length <= 1) { showToast("Vous devez garder au moins un compte."); return; }
  const confirmed = await customConfirm(`Supprimer le compte "${name}" ? Les opérations liées seront conservées mais le solde ne sera plus calculé.`);
  if (confirmed) { state.accounts = state.accounts.filter(a => a !== name); await save(); render(); }
});
$("catList").addEventListener("click", async e => {
  if(!e.target.classList.contains("del-cat")) return;
  const name = e.target.dataset.name;
  const confirmed = await customConfirm(`Supprimer la catégorie "${name}" ?`);
  if (confirmed) { state.categories = state.categories.filter(c => c !== name); await save(); render(); }
});

// LIMITES EVENT LISTENERS
$("globalLimit").addEventListener("change", async e => {
  if(!state.limits) state.limits = {};
  state.limits.global = Number(e.target.value) || 0;
  await save(); render(); showToast("Plafond global mis à jour.");
});
$("catLimitsList").addEventListener("change", async e => {
  if(e.target.classList.contains("cat-limit-input")) {
    if(!state.limits) state.limits = {};
    state.limits[e.target.dataset.cat] = Number(e.target.value) || 0;
    await save(); render(); showToast("Plafond de catégorie mis à jour.");
  }
});

// EXCEL (CSV) EXPORT
$("exportExcelBtn").addEventListener("click", () => {
  let csv = "Date;Type;Compte;Catégorie;Montant;Description\n";
  const ops = [...state.operations].sort((a,b) => b.date.localeCompare(a.date));
  ops.forEach(o => {
    const t = o.type === 'expense' ? 'Dépense' : o.type === 'income' ? 'Revenu' : 'Transfert';
    const desc = (o.note || "").replace(/;/g, ","); // escape separator
    csv += `${o.date};${t};${o.account};${o.category||''};${o.amount};${desc}\n`;
  });
  // Add UTF-8 BOM for Excel compatibility
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mon-budget-export-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// Backup
$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ app: "Mon Budget", version: 1.2, ...state }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mon-budget-sauvegarde-${today()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
});

$("importFile").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.opening || !Array.isArray(data.operations)) throw new Error("Format invalide");
    const confirmed = await customConfirm("La restauration remplacera toutes les données actuelles. Continuer ?");
    if (!confirmed) return;
    state = { 
      opening: { ...data.opening }, operations: data.operations, theme: data.theme === "light" ? "light" : "dark",
      currency: data.currency || "DZD", accounts: data.accounts || Object.keys(data.opening || {}),
      categories: data.categories || ["Alimentations", "Voiture", "Santé", "Cadeaux", "Houssam", "Safa", "Maroua", "Maison", "Autres"],
      limits: data.limits || { global: 0 }
    };
    await save(); render(); showToast("Sauvegarde restaurée avec succès.");
  } catch (err) { showToast("Impossible de lire cette sauvegarde (format incorrect)."); }
  e.target.value = "";
});

async function init() {
  try {
    await openDB(); await readState(); render();
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});
  } catch (e) {
    alert("Erreur critique : Le stockage local n'est pas disponible.");
  }
}
init();
