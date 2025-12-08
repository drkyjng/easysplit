// ---------- Firebase wiring ----------

const {
  app,
  auth,
  db,
  firebaseAuth,
  firebaseFirestore
} = window._firebase;

const {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} = firebaseAuth;

const {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} = firebaseFirestore;

// ---------- Minimal UI state ----------

let currentUser = null;
let projectsCache = [];      // [{ id, name, ownerUid, members, settled, createdAt, expenses? }]
let currentProjectId = null;
let yourName = localStorage.getItem("yourName") || "";

// ---------- DOM refs ----------

const els = {
  userStatus: document.getElementById("userStatus"),
  googleSignInBtn: document.getElementById("googleSignInBtn"),
  signOutBtn: document.getElementById("signOutBtn"),

  yourNameInput: document.getElementById("yourNameInput"),
  projectsList: document.getElementById("projectsList"),
  addProjectBtn: document.getElementById("addProjectBtn"),
  editProjectBtn: document.getElementById("editProjectBtn"),
  shareProjectBtn: document.getElementById("shareProjectBtn"),

  projectView: document.getElementById("projectView"),
  noProjectMessage: document.getElementById("noProjectMessage"),
  projectName: document.getElementById("projectName"),
  projectMeta: document.getElementById("projectMeta"),
  membersList: document.getElementById("membersList"),
  balancesTableBody: document.querySelector("#balancesTable tbody"),
  editModeBadge: document.getElementById("editModeBadge"),

  addExpenseCard: document.getElementById("addExpenseCard"),
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

// ---------- Utility ----------

function newId() {
  return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getProjectIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("project");
}

// ---------- Firestore helpers ----------

function projectsCol() {
  return collection(db, "projects");
}

function projectDoc(projectId) {
  return doc(db, "projects", projectId);
}

function expensesCol(projectId) {
  return collection(db, "projects", projectId, "expenses");
}

async function loadProjectsForUser(uid) {
  try {
    const q = query(
      projectsCol(),
      where("ownerUid", "==", uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    projectsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("loadProjectsForUser failed:", e);
    alert("Failed to load your projects: " + (e.message || e.code));
  }
}

async function loadExpensesForProject(projectId) {
  const q = query(expensesCol(projectId), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const idx = projectsCache.findIndex((p) => p.id === projectId);
  if (idx !== -1) {
    projectsCache[idx].expenses = expenses;
  }
}

async function saveProject(project, isNew) {
  if (isNew) {
    const docRef = await addDoc(projectsCol(), {
      ...project,
      createdAt: serverTimestamp()
    });
    project.id = docRef.id;
    projectsCache.unshift(project);
  } else {
    const { id, ...data } = project;
    await setDoc(projectDoc(id), data, { merge: true });
    const idx = projectsCache.findIndex((p) => p.id === id);
    if (idx !== -1) projectsCache[idx] = project;
  }
}

async function saveExpense(projectId, expense, isNew) {
  if (isNew) {
    const ref = await addDoc(expensesCol(projectId), {
      ...expense,
      createdAt: serverTimestamp()
    });
    expense.id = ref.id;
  } else {
    const { id, ...data } = expense;
    await setDoc(doc(expensesCol(projectId), id), data, { merge: true });
  }

  const idx = projectsCache.findIndex((p) => p.id === projectId);
  if (idx !== -1) {
    projectsCache[idx].expenses = projectsCache[idx].expenses || [];
    const eIdx = projectsCache[idx].expenses.findIndex((e) => e.id === expense.id);
    if (eIdx === -1) {
      projectsCache[idx].expenses.unshift(expense);
    } else {
      projectsCache[idx].expenses[eIdx] = expense;
    }
  }
}

// ---------- State helpers ----------

function getCurrentProject() {
  return projectsCache.find((p) => p.id === currentProjectId) || null;
}

function isOwner(project) {
  return currentUser && project && project.ownerUid === currentUser.uid;
}

function isMe(member) {
  if (!yourName) return false;
  return member.name.trim().toLowerCase() === yourName.trim().toLowerCase();
}

// ---------- Auth UI ----------

function updateAuthUI() {
  if (!els.userStatus) return;
  if (currentUser) {
    const name = currentUser.displayName || currentUser.email || "Signed in";
    els.userStatus.textContent = `Signed in as ${name}`;
    els.googleSignInBtn.style.display = "none";
    els.signOutBtn.style.display = "inline-flex";
    els.addProjectBtn.style.display = "inline-flex";
  } else {
    els.userStatus.textContent = "Not signed in";
    els.googleSignInBtn.style.display = "inline-flex";
    els.signOutBtn.style.display = "none";
    els.addProjectBtn.style.display = "none";
  }
}

async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    alert("Google sign-in failed: " + (e.message || e.code));
  }
}

async function handleSignOut() {
  try {
    await signOut(auth);
  } catch (e) {
    console.error(e);
    alert("Sign-out failed: " + (e.message || e.code));
  }
}

// ---------- Rendering: projects ----------

function renderProjectsList() {
  const list = els.projectsList;
  list.innerHTML = "";

  if (!projectsCache.length) {
    const li = document.createElement("li");
    li.textContent = currentUser
      ? "No projects yet. Click + New to create one."
      : "No projects. Sign in to create your own.";
    li.className = "muted small";
    list.appendChild(li);
    return;
  }

  projectsCache.forEach((p) => {
    const li = document.createElement("li");
    li.className = "project-item" + (p.id === currentProjectId ? " active" : "");
    li.addEventListener("click", async () => {
      currentProjectId = p.id;
      await loadExpensesForProject(p.id);
      renderProjectsList();
      renderCurrentProject();
    });
    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.name;
    li.appendChild(nameSpan);
    list.appendChild(li);
  });
}

// ---------- Rendering: current project ----------

function renderCurrentProject() {
  const project = getCurrentProject();

  if (!project) {
    els.projectView.style.display = "none";
    els.noProjectMessage.style.display = "block";
    els.editModeBadge.classList.add("readonly");
    els.editModeBadge.textContent = currentUser ? "No project selected" : "Sign in or open a shared link";
    return;
  }

  els.noProjectMessage.style.display = "none";
  els.projectView.style.display = "block";

  els.projectName.textContent = project.name;

  let createdAtDate = null;
  if (project.createdAt && typeof project.createdAt.toDate === "function") {
    createdAtDate = project.createdAt.toDate();
  } else if (project.createdAt) {
    createdAtDate = new Date(project.createdAt);
  } else {
    createdAtDate = new Date();
  }

  const memberCount = (project.members || []).length;
  els.projectMeta.textContent = `${memberCount} member(s) • Created ${createdAtDate.toLocaleDateString()}`;

  const canEdit = isOwner(project);

  // Toggle edit controls
  els.editProjectBtn.style.display = canEdit ? "inline-flex" : "none";
  if (els.addExpenseCard) {
    els.addExpenseCard.style.display = canEdit ? "block" : "none";
  }

  if (canEdit) {
    els.editModeBadge.classList.remove("readonly");
    els.editModeBadge.textContent = "Owner mode";
  } else {
    els.editModeBadge.classList.add("readonly");
    els.editModeBadge.textContent = currentUser ? "View only (not owner)" : "View only (guest)";
  }

  renderMembers(project);
  renderExpenseFormMembers(project);
  renderExpenses(project);
  renderBalances(project);
}

function renderMembers(project) {
  els.membersList.innerHTML = "";
  (project.members || []).forEach((m) => {
    const li = document.createElement("li");
    li.className = "pill" + (isMe(m) ? " me" : "");
    li.textContent = m.name + (isMe(m) ? " (you)" : "");
    els.membersList.appendChild(li);
  });
}

// ---------- Balances ----------

function computeBalances(project) {
  const balances = {};
  (project.members || []).forEach((m) => {
    balances[m.id] = 0;
  });

  (project.expenses || []).forEach((exp) => {
    const participants = exp.participantIds || [];
    if (!participants.length) return;

    if (exp.splitMode === "custom" && exp.shares) {
      Object.entries(exp.shares).forEach(([memberId, share]) => {
        const s = Number(share) || 0;
        if (!(project.members || []).find((m) => m.id === memberId)) return;
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
  const canEdit = isOwner(project);
  els.balancesTableBody.innerHTML = "";

  (project.members || []).forEach((m) => {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = m.name + (isMe(m) ? " (you)" : "");
    tr.appendChild(nameTd);

    const balTd = document.createElement("td");
    const value = balances[m.id] || 0;
    balTd.textContent = value.toFixed(2);
    if (value > 0.01) {
      balTd.style.color = "#16a34a";
    } else if (value < -0.01) {
      balTd.style.color = "#ef4444";
    } else {
      balTd.style.color = "#9ca3af";
    }
    tr.appendChild(balTd);

    const settledTd = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!(project.settled && project.settled[m.id]);
    checkbox.disabled = !canEdit;
    if (canEdit) {
      checkbox.addEventListener("change", async () => {
        project.settled = project.settled || {};
        project.settled[m.id] = checkbox.checked;
        await saveProject(project, false);
      });
    }
    settledTd.appendChild(checkbox);
    tr.appendChild(settledTd);

    els.balancesTableBody.appendChild(tr);
  });
}

// ---------- Expense form & splits ----------

function renderExpenseFormMembers(project) {
  // payer select
  els.expPayer.innerHTML = "";
  (project.members || []).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name + (isMe(m) ? " (you)" : "");
    els.expPayer.appendChild(opt);
  });

  // participants
  els.expParticipants.innerHTML = "";
  (project.members || []).forEach((m) => {
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
  (project.members || []).forEach((m) => {
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
  const radios = els.addExpenseForm.elements["splitMode"];
  const checked = Array.from(radios).find((r) => r.checked);
  return checked ? checked.value : "equal";
}

function updateCustomSplitSummary() {
  const inputs = Array.from(
    els.customSplitBody.querySelectorAll("input[type=number]")
  );
  let sum = 0;
  inputs.forEach((inp) => {
    const v = parseFloat(inp.value || "0");
    if (v > 0) sum += v;
  });
  if (sum > 0) {
    els.customSplitSummary.textContent = `Total custom shares: ${sum.toFixed(
      2
    )} HKD (this should match the HKD total).`;
  } else {
    els.customSplitSummary.textContent = "No custom shares entered yet.";
  }
}

// ---------- FX rate fetch ----------

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

// ---------- Add expense (Firestore) ----------

async function onAddExpense(event) {
  event.preventDefault();
  const project = getCurrentProject();
  if (!project) return;

  if (!isOwner(project)) {
    alert("Only the project owner can add expenses.");
    return;
  }

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
      const ok = confirm(
        `Warning: total custom shares (${sumShares.toFixed(
          2
        )} HKD) differ from HKD total (${amountHKD.toFixed(
          2
        )} HKD) by ${diff.toFixed(2)}. Save anyway?`
      );
      if (!ok) return;
    }
  }

  const expense = {
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
    shares: splitMode === "custom" ? shares : null
  };

  await saveExpense(project.id, expense, true);
  const refreshedProject = getCurrentProject();
  await loadExpensesForProject(refreshedProject.id);
  renderExpenses(refreshedProject);
  renderBalances(refreshedProject);

  els.expDescription.value = "";
  els.expAmount.value = "";
}

// ---------- deleteExpense with Firestore ----------

async function deleteExpense(project, expenseId) {
  if (!isOwner(project)) {
    alert("Only the project owner can delete expenses.");
    return;
  }
  if (!confirm("Delete this expense?")) return;

  await deleteDoc(doc(expensesCol(project.id), expenseId));

  project.expenses = (project.expenses || []).filter((e) => e.id !== expenseId);
  const idx = projectsCache.findIndex((p) => p.id === project.id);
  if (idx !== -1) {
    projectsCache[idx].expenses = project.expenses;
  }

  renderExpenses(project);
  renderBalances(project);
}

// ---------- Render expenses table ----------

function renderExpenses(project) {
  const expenses = project.expenses || [];
  const canEdit = isOwner(project);
  els.expensesTableBody.innerHTML = "";
  if (!expenses.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 10;
    td.textContent = "No expenses yet.";
    td.className = "muted small";
    tr.appendChild(td);
    els.expensesTableBody.appendChild(tr);
    return;
  }

  expenses.forEach((exp) => {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    dateTd.textContent = exp.date;
    tr.appendChild(dateTd);

    const descTd = document.createElement("td");
    descTd.textContent = exp.description;
    tr.appendChild(descTd);

    const payer = (project.members || []).find((m) => m.id === exp.payerId);
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
    const names = (exp.participantIds || [])
      .map((id) => (project.members || []).find((m) => m.id === id))
      .filter(Boolean)
      .map((m) => m.name);
    participantsTd.textContent = names.join(", ");
    tr.appendChild(participantsTd);

    const splitTd = document.createElement("td");
    if (exp.splitMode === "custom" && exp.shares) {
      const parts = Object.entries(exp.shares)
        .map(([id, share]) => {
          const m = (project.members || []).find((mm) => mm.id === id);
          return m ? `${m.name}: ${Number(share).toFixed(2)}` : null;
        })
        .filter(Boolean);
      splitTd.textContent = parts.join(" | ");
    } else {
      const perPerson = exp.amountHKD / ((exp.participantIds || []).length || 1);
      splitTd.textContent = `Equal: ${perPerson.toFixed(2)} each`;
    }
    tr.appendChild(splitTd);

    const actionsTd = document.createElement("td");
    if (canEdit) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn secondary small";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteExpense(project, exp.id));
      actionsTd.appendChild(delBtn);
    } else {
      actionsTd.textContent = "";
    }
    tr.appendChild(actionsTd);

    els.expensesTableBody.appendChild(tr);
  });
}

// ---------- Project modal ----------

function openProjectModal(projectId) {
  editingProjectId = projectId;
  const isEdit = !!projectId;
  els.projectModalTitle.textContent = isEdit ? "Edit project" : "New project";

  if (isEdit) {
    const project = projectsCache.find((p) => p.id === projectId);
    if (!project) return;
    els.projectNameInput.value = project.name;
    els.projectMembersInput.value = (project.members || [])
      .map((m) => m.name)
      .join(", ");
  } else {
    els.projectNameInput.value = "";
    els.projectMembersInput.value = yourName ? yourName : "";
  }

  els.projectModal.classList.remove("hidden");
}

function closeProjectModal() {
  els.projectModal.classList.add("hidden");
  editingProjectId = null;
}

async function onProjectFormSubmit(event) {
  event.preventDefault();
  if (!currentUser) {
    alert("You must be signed in to save projects.");
    return;
  }

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
    name: n
  }));

  if (editingProjectId) {
    const project = projectsCache.find((p) => p.id === editingProjectId);
    if (!project) {
      alert("Project not found.");
      return;
    }
    if (!isOwner(project)) {
      alert("Only the owner can edit this project.");
      return;
    }
    project.name = name;
    project.members = members;
    await saveProject(project, false);
  } else {
    const newProject = {
      name,
      ownerUid: currentUser.uid,
      members,
      settled: {}
    };
    await saveProject(newProject, true);
    currentProjectId = newProject.id;
    await loadExpensesForProject(newProject.id);
  }

  renderProjectsList();
  renderCurrentProject();
  closeProjectModal();
}

// ---------- Share link ----------

function onShareProject() {
  const project = getCurrentProject();
  if (!project) {
    alert("No project selected.");
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("project", project.id);
  const shareUrl = url.toString();

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        alert("Share link copied to clipboard:\n" + shareUrl);
      })
      .catch(() => {
        alert("Share link:\n" + shareUrl);
      });
  } else {
    alert("Share link:\n" + shareUrl);
  }
}

// ---------- Init ----------

function init() {
  // yourName
  els.yourNameInput.value = yourName;
  els.yourNameInput.addEventListener("input", () => {
    yourName = els.yourNameInput.value.trim();
    localStorage.setItem("yourName", yourName);
    const project = getCurrentProject();
    if (project) renderCurrentProject();
  });

  // Buttons
  els.googleSignInBtn.addEventListener("click", signInWithGoogle);
  els.signOutBtn.addEventListener("click", handleSignOut);

  els.addProjectBtn.addEventListener("click", () => openProjectModal(null));
  els.editProjectBtn.addEventListener("click", () => {
    const project = getCurrentProject();
    if (!project) return;
    openProjectModal(project.id);
  });
  els.shareProjectBtn.addEventListener("click", onShareProject);

  els.cancelProjectBtn.addEventListener("click", closeProjectModal);
  els.projectForm.addEventListener("submit", onProjectFormSubmit);

  els.addExpenseForm.addEventListener("submit", onAddExpense);
  els.fetchRateBtn.addEventListener("click", onFetchRate);

  // split mode toggle
  Array.from(els.addExpenseForm.elements["splitMode"]).forEach((r) => {
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

  // Auth + data
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    updateAuthUI();

        // If signed in and no "yourName" saved yet, prefill from Google account
    if (user && !yourName) {
      const guessedName =
        user.displayName ||
        (user.email ? user.email.split("@")[0] : "");
      if (guessedName) {
        yourName = guessedName;
        localStorage.setItem("yourName", yourName);
        if (els.yourNameInput) {
          els.yourNameInput.value = yourName;
        }
      }
    }
    
    projectsCache = [];
    currentProjectId = null;

    const urlProjectId = getProjectIdFromUrl();

    if (user) {
      await loadProjectsForUser(user.uid);
    }

    if (urlProjectId) {
      const snap = await getDoc(projectDoc(urlProjectId));
      if (snap.exists()) {
        const data = snap.data();
        const sharedProject = { id: snap.id, ...data };
        const idx = projectsCache.findIndex((p) => p.id === sharedProject.id);
        if (idx === -1) {
          projectsCache.unshift(sharedProject);
        } else {
          projectsCache[idx] = sharedProject;
        }
        currentProjectId = sharedProject.id;
        await loadExpensesForProject(sharedProject.id);
      }
    }

    if (!currentProjectId && projectsCache.length) {
      currentProjectId = projectsCache[0].id;
      await loadExpensesForProject(currentProjectId);
    }

    renderProjectsList();
    renderCurrentProject();
  });
}

document.addEventListener("DOMContentLoaded", init);
