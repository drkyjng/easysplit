const STORAGE_KEY = "hkdBillSplitterData_v2";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        yourName: "",
        projects: [],
        currentProjectId: null,
      };
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load state", e);
    return {
      yourName: "",
      projects: [],
      currentProjectId: null,
    };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function newId() {
  return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let state = loadState();

const els = {
  yourNameInput: document.getElementById("yourNameInput"),
  projectsList: document.getElementById("projectsList"),
  addProjectBtn: document.getElementById("addProjectBtn"),
  editProjectBtn: document.getElementById("editProjectBtn"),
  projectView: document.getElementById("projectView"),
  noProjectMessage: document.getElementById("noProjectMessage"),
  projectName: document.getElementById("projectName"),
  projectMeta: document.getElementById("projectMeta"),
  membersList: document.getElementById("membersList"),
  balancesTableBody: document.querySelector("#balancesTable tbody"),

  addExpenseForm: document.getElementById("addExpenseForm"),
  expDescription: document.getElementById("expDescription"),
  expDate: document.getElementById("expDate"),
  expPayer: document.getElementById("expPayer"),
  expCurrency: document.getElementById("expCurrency"),
  expAmount: document.getElementById("expAmount"),
  expRateSource: document.getElementById("expRateSource"),
  expRateRaw: document.getElementById("expRateRaw"),
  expFeePercent: document.getElementById("expFeePercent"),
  fetchRateBtn: document.getElementById("fetchRateBtn"),
  expParticipants: document.getElementById("expParticipants"),
  customSplitContainer: document.getElementById("customSplitContainer"),
  customSplitBody: document.getElementById("customSplitBody"),
  customSplitSummary: document.getElementById("customSplitSummary"),
  expensesTableBody: document.querySelector("#expensesTable tbody"),

  projectModal: document.getElementById("projectModal"),
  projectModalTitle: document.getElementById("projectModalTitle"),
  projectForm: document.getElementById("projectForm"),
  projectNameInput: document.getElementById("projectNameInput"),
  projectMembersInput: document.getElementById("projectMembersInput"),
  cancelProjectBtn: document.getElementById("cancelProjectBtn"),
};

let editingProjectId = null;

function init() {
  els.yourNameInput.value = state.yourName || "";
  els.yourNameInput.addEventListener("input", () => {
    state.yourName = els.yourNameInput.value.trim();
    saveState();
    renderCurrentProject();
  });

  els.addProjectBtn.addEventListener("click", () => openProjectModal(null));
  els.editProjectBtn.addEventListener("click", () => {
    if (!state.currentProjectId) return;
    openProjectModal(state.currentProjectId);
  });

  els.cancelProjectBtn.addEventListener("click", closeProjectModal);
  els.projectForm.addEventListener("submit", onProjectFormSubmit);

  els.addExpenseForm.addEventListener("submit", onAddExpense);
  els.fetchRateBtn.addEventListener("click", onFetchRate);

  // split mode toggle
  els.addExpenseForm.elements["splitMode"].forEach((r) => {
    r.addEventListener("change", () => {
      const mode = getSplitMode();
      if (mode === "custom") {
        els.customSplitContainer.classList.remove("hidden");
        updateCustomSplitSummary();
      } else {
        els.customSplitContainer.classList.add("hidden");
      }
    });
  });

  renderProjectsList();
  renderCurrentProject();
}

document.addEventListener("DOMContentLoaded", init);

function getCurrentProject() {
  return state.projects.find((p) => p.id === state.currentProjectId) || null;
}

function renderProjectsList() {
  els.projectsList.innerHTML = "";
  if (!state.projects.length) {
    const li = document.createElement("li");
    li.textContent = "No projects yet";
    li.className = "muted small";
    els.projectsList.appendChild(li);
    return;
  }

  state.projects.forEach((p) => {
    const li = document.createElement("li");
    li.className = "project-item" + (p.id === state.currentProjectId ? " active" : "");
    li.addEventListener("click", () => {
      state.currentProjectId = p.id;
      saveState();
      renderProjectsList();
      renderCurrentProject();
    });

    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.name;
    li.appendChild(nameSpan);

    els.projectsList.appendChild(li);
  });
}

function renderCurrentProject() {
  const project = getCurrentProject();

  if (!project) {
    els.projectView.style.display = "none";
    els.noProjectMessage.style.display = "block";
    return;
  }

  els.noProjectMessage.style.display = "none";
  els.projectView.style.display = "block";

  els.projectName.textContent = project.name;
  els.projectMeta.textContent = `${project.members.length} member(s) • Created ${new Date(
    project.createdAt
  ).toLocaleDateString()}`;

  renderMembers(project);
  renderExpenseFormMembers(project);
  renderExpenses(project);
  renderBalances(project);
}

function renderMembers(project) {
  els.membersList.innerHTML = "";
  project.members.forEach((m) => {
    const li = document.createElement("li");
    li.className = "pill" + (isMe(m) ? " me" : "");
    li.textContent = m.name + (isMe(m) ? " (you)" : "");
    els.membersList.appendChild(li);
  });
}

function isMe(member) {
  if (!state.yourName) return false;
  return member.name.toLowerCase() === state.yourName.trim().toLowerCase();
}

function computeBalances(project) {
  const balances = {};
  project.members.forEach((m) => {
    balances[m.id] = 0;
  });

  project.expenses.forEach((exp) => {
    const participants = exp.participantIds || [];
    if (!participants.length) return;

    if (exp.splitMode === "custom" && exp.shares) {
      // shares: { memberId: hkAmount }
      Object.entries(exp.shares).forEach(([memberId, share]) => {
        const s = Number(share) || 0;
        if (!project.members.find((m) => m.id === memberId)) return;
        if (memberId === exp.payerId) return;
        balances[memberId] += s;
        balances[exp.payerId] -= s;
      });
    } else {
      const perPerson = exp.amountHKD / participants.length;
      participants.forEach((pid) => {
        if (pid === exp.payerId) return;
        balances[pid] += perPerson;
        balances[exp.payerId] -= perPerson;
      });
    }
  });

  return balances;
}

function renderBalances(project) {
  const balances = computeBalances(project);
  els.balancesTableBody.innerHTML = "";

  project.members.forEach((m) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = m.name + (isMe(m) ? " (you)" : "");
    tr.appendChild(nameTd);

    const balTd = document.createElement("td");
    const value = balances[m.id] || 0;
    balTd.textContent = value.toFixed(2);
    if (value > 0.01) {
      balTd.style.color = "#4ade80";
    } else if (value < -0.01) {
      balTd.style.color = "#f97373";
    } else {
      balTd.style.color = "#9ca3af";
    }
    tr.appendChild(balTd);

    const settledTd = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!(project.settled && project.settled[m.id]);
    checkbox.addEventListener("change", () => {
      project.settled = project.settled || {};
      project.settled[m.id] = checkbox.checked;
      saveState();
    });
    settledTd.appendChild(checkbox);
    tr.appendChild(settledTd);

    els.balancesTableBody.appendChild(tr);
  });
}

function renderExpenseFormMembers(project) {
  // payer select
  els.expPayer.innerHTML = "";
  project.members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name + (isMe(m) ? " (you)" : "");
    els.expPayer.appendChild(opt);
  });

  // participants check list
  els.expParticipants.innerHTML = "";
  project.members.forEach((m) => {
    const label = document.createElement("label");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = m.id;
    checkbox.checked = true;

    const span = document.createElement("span");
    span.textContent = m.name + (isMe(m) ? " (you)" : "");

    label.appendChild(checkbox);
    label.appendChild(span);
    els.expParticipants.appendChild(label);
  });

  buildCustomSplitRows(project);
}

function buildCustomSplitRows(project) {
  els.customSplitBody.innerHTML = "";
  project.members.forEach((m) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = m.name + (isMe(m) ? " (you)" : "");
    tr.appendChild(nameTd);

    const shareTd = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "0.01";
    input.dataset.memberId = m.id;
    input.placeholder = "0.00";
    input.addEventListener("input", updateCustomSplitSummary);
    shareTd.appendChild(input);
    tr.appendChild(shareTd);

    els.customSplitBody.appendChild(tr);
  });
  updateCustomSplitSummary();
}

function getParticipants() {
  return Array.from(
    els.expParticipants.querySelectorAll("input[type=checkbox]:checked")
  ).map((cb) => cb.value);
}

function getSplitMode() {
  const checked = Array.from(els.addExpenseForm.elements["splitMode"]).find(
    (r) => r.checked
  );
  return checked ? checked.value : "equal";
}

function updateCustomSplitSummary() {
  const inputs = Array.from(els.customSplitBody.querySelectorAll("input[type=number]"));
  const shares = {};
  let sum = 0;
  inputs.forEach((inp) => {
    const v = parseFloat(inp.value || "0");
    if (v > 0) {
      shares[inp.dataset.memberId] = v;
      sum += v;
    }
  });
  if (sum > 0) {
    els.customSplitSummary.textContent = `Total custom shares: ${sum.toFixed(
      2
    )} HKD (this should match the HKD total).`;
  } else {
    els.customSplitSummary.textContent = "No custom shares entered yet.";
  }
}

async function onFetchRate() {
  const currency = els.expCurrency.value.trim().toUpperCase();
  const date = els.expDate.value;
  if (!currency || !date) {
    alert("Please fill in currency and date first.");
    return;
  }
  if (currency === "HKD") {
    els.expRateRaw.value = "1";
    return;
  }

  try {
    els.fetchRateBtn.disabled = true;
    els.fetchRateBtn.textContent = "Fetching...";
    const url = `https://api.frankfurter.app/${encodeURIComponent(
      date
    )}?from=${encodeURIComponent(currency)}&to=HKD`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.rates || typeof data.rates.HKD !== "number") {
      throw new Error("No HKD rate found");
    }
    els.expRateRaw.value = data.rates.HKD.toFixed(6);
  } catch (err) {
    console.error(err);
    alert("Failed to fetch rate. You can enter it manually.");
  } finally {
    els.fetchRateBtn.disabled = false;
    els.fetchRateBtn.textContent = "Fetch official";
  }
}

function onAddExpense(event) {
  event.preventDefault();
  const project = getCurrentProject();
  if (!project) return;

  const description = els.expDescription.value.trim();
  const date = els.expDate.value;
  const payerId = els.expPayer.value;
  const currency = els.expCurrency.value.trim().toUpperCase();
  const amountForeign = parseFloat(els.expAmount.value);
  const rateSource = els.expRateSource.value;
  const rateRaw = parseFloat(els.expRateRaw.value || "0");
  const feePercent = parseFloat(els.expFeePercent.value || "0") || 0;

  if (!description || !date || !payerId || !currency || !amountForeign || !rateRaw) {
    alert("Please fill in all fields and make sure amount and raw rate are valid.");
    return;
  }

  const participantIds = getParticipants();
  if (!participantIds.length) {
    alert("Choose at least one participant.");
    return;
  }

  const effectiveRate = rateRaw * (1 + feePercent / 100);
  const amountHKD = amountForeign * effectiveRate;

  const splitMode = getSplitMode();
  const shares = {};

  if (splitMode === "custom") {
    const inputs = Array.from(
      els.customSplitBody.querySelectorAll("input[type=number]")
    );
    let sumShares = 0;
    inputs.forEach((inp) => {
      const v = parseFloat(inp.value || "0");
      const memberId = inp.dataset.memberId;
      if (participantIds.includes(memberId) && v > 0) {
        shares[memberId] = v;
        sumShares += v;
      }
    });
    if (Object.keys(shares).length === 0) {
      alert("Enter custom shares for at least one participant.");
      return;
    }
    const diff = Math.abs(sumShares - amountHKD);
    if (diff > 0.5) {
      if (
        !confirm(
          `Warning: total custom shares (${sumShares.toFixed(
            2
          )} HKD) differ from HKD total (${amountHKD.toFixed(
            2
          )} HKD) by ${diff.toFixed(2)}. Save anyway?`
        )
      ) {
        return;
      }
    }
  }

  const expense = {
    id: newId(),
    description,
    date,
    payerId,
    currency,
    amountForeign,
    rateSource,
    rateRaw,
    feePercent,
    effectiveRate,
    amountHKD,
    participantIds,
    splitMode,
    shares: splitMode === "custom" ? shares : null,
    createdAt: new Date().toISOString(),
  };

  project.expenses.unshift(expense);
  saveState();

  els.expDescription.value = "";
  els.expAmount.value = "";
  // keep date / currency / rates to ease repeated input

  renderExpenses(project);
  renderBalances(project);
}

function deleteExpense(project, expenseId) {
  if (!confirm("Delete this expense?")) return;
  project.expenses = project.expenses.filter((e) => e.id !== expenseId);
  saveState();
  renderExpenses(project);
  renderBalances(project);
}

function renderExpenses(project) {
  els.expensesTableBody.innerHTML = "";
  if (!project.expenses.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 10;
    td.textContent = "No expenses yet.";
    td.className = "muted small";
    tr.appendChild(td);
    els.expensesTableBody.appendChild(tr);
    return;
  }

  project.expenses.forEach((exp) => {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    dateTd.textContent = exp.date;
    tr.appendChild(dateTd);

    const descTd = document.createElement("td");
    descTd.textContent = exp.description;
    tr.appendChild(descTd);

    const payer = project.members.find((m) => m.id === exp.payerId);
    const payerTd = document.createElement("td");
    payerTd.textContent = payer ? payer.name : "Unknown";
    tr.appendChild(payerTd);

    const foreignTd = document.createElement("td");
    foreignTd.textContent = `${exp.amountForeign.toFixed(2)} ${exp.currency}`;
    tr.appendChild(foreignTd);

    const rateSourceTd = document.createElement("td");
    rateSourceTd.textContent =
      exp.rateSource === "official"
        ? "Official"
        : exp.rateSource === "visa"
        ? "Visa"
        : exp.rateSource === "mastercard"
        ? "Mastercard"
        : "Custom";
    tr.appendChild(rateSourceTd);

    const effTd = document.createElement("td");
    effTd.textContent = `${exp.effectiveRate.toFixed(6)} (fee ${exp.feePercent.toFixed(
      2
    )}%)`;
    tr.appendChild(effTd);

    const hkdTd = document.createElement("td");
    hkdTd.textContent = exp.amountHKD.toFixed(2);
    tr.appendChild(hkdTd);

    const participantsTd = document.createElement("td");
    const names = exp.participantIds
      .map((id) => project.members.find((m) => m.id === id))
      .filter(Boolean)
      .map((m) => m.name);
    participantsTd.textContent = names.join(", ");
    tr.appendChild(participantsTd);

    const splitTd = document.createElement("td");
    if (exp.splitMode === "custom" && exp.shares) {
      const parts = Object.entries(exp.shares)
        .map(([id, share]) => {
          const m = project.members.find((mm) => mm.id === id);
          return m ? `${m.name}: ${Number(share).toFixed(2)}` : null;
        })
        .filter(Boolean);
      splitTd.textContent = parts.join(" | ");
    } else {
      const perPerson = exp.amountHKD / (exp.participantIds.length || 1);
      splitTd.textContent = `Equal: ${perPerson.toFixed(2)} each`;
    }
    tr.appendChild(splitTd);

    const actionsTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "btn secondary small";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteExpense(project, exp.id));
    actionsTd.appendChild(delBtn);
    tr.appendChild(actionsTd);

    els.expensesTableBody.appendChild(tr);
  });
}

function openProjectModal(projectId) {
  editingProjectId = projectId;
  const isEdit = !!projectId;
  els.projectModalTitle.textContent = isEdit ? "Edit project" : "New project";

  if (isEdit) {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;
    els.projectNameInput.value = project.name;
    els.projectMembersInput.value = project.members.map((m) => m.name).join(", ");
  } else {
    els.projectNameInput.value = "";
    els.projectMembersInput.value = state.yourName ? state.yourName : "";
  }

  els.projectModal.classList.remove("hidden");
}

function closeProjectModal() {
  els.projectModal.classList.add("hidden");
  editingProjectId = null;
}

function onProjectFormSubmit(event) {
  event.preventDefault();
  const name = els.projectNameInput.value.trim();
  const membersRaw = els.projectMembersInput.value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (!name || !membersRaw.length) {
    alert("Please fill in project name and at least one member.");
    return;
  }

  const members = membersRaw.map((n) => ({
    id: newId(),
    name: n,
  }));

  if (editingProjectId) {
    const project = state.projects.find((p) => p.id === editingProjectId);
    if (!project) return;
    const keepExpenses = project.expenses || [];
    if (
      keepExpenses.length &&
      !confirm(
        "Editing members may make existing expenses inconsistent. Keep old expenses anyway?"
      )
    ) {
      project.expenses = [];
      project.settled = {};
    }
    project.name = name;
    project.members = members;
  } else {
    const newProject = {
      id: newId(),
      name,
      createdAt: new Date().toISOString(),
      members,
      expenses: [],
      settled: {},
    };
    state.projects.unshift(newProject);
    state.currentProjectId = newProject.id;
  }

  saveState();
  renderProjectsList();
  renderCurrentProject();
  closeProjectModal();
}
