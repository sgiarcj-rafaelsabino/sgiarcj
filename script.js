/* CONFIGURAÇÃO DA API DO GOOGLE APPS SCRIPT API GIAR V1 */
const API_URL =
    "https://script.google.com/macros/s/AKfycbznUZmhb-PDKWqR8Ujou-9rGooVZFVBdGaS75vzO8N_zZutVEwGxdhVpjFK53Q2DwKm/exec";

const uid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);
const fmtCurr = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function showLoading(show = true) {
    document.getElementById("loading-overlay").style.display = show ? "flex" : "none";
}

const modalLogin = new bootstrap.Modal(document.getElementById("modalLogin"));
const modalStudent = new bootstrap.Modal(document.getElementById("modalStudent"));
const modalTx = new bootstrap.Modal(document.getElementById("modalTransaction"));

let financeChart = null;
let classChart = null;
let globalStudentsCache = [];

async function apiGet(sheetName) {
    showLoading(true);
    try {
        const url = `${API_URL}?action=read&sheet=${encodeURIComponent(sheetName)}`;
        const res = await fetch(url, {
            method: "GET",
            mode: "cors",
            redirect: "follow",
        });

        if (!res.ok) {
            throw new Error(`Erro na requisição: ${res.statusText}`);
        }

        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error("Erro na leitura:", err);
        return [];
    } finally {
        showLoading(false);
    }
}

async function apiPost(sheetName, actionType, payload) {
    showLoading(true);
    try {
        const bodyObj = {
            action: actionType,
            sheet: sheetName,
        };

        if (actionType === "create" || actionType === "update") {
            bodyObj.data = payload;
            bodyObj.id = payload.id;
        } else if (actionType === "delete") {
            bodyObj.id = payload;
        }

        await fetch(API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(bodyObj),
        });

        await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (err) {
        console.error("Erro na gravação:", err);
    } finally {
        showLoading(false);
    }
}

document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();

    const alertEl = document.getElementById("login-alert");
    alertEl.classList.add("d-none");

    const email = document.getElementById("login-email").value;
    const pass = document.getElementById("login-password").value;

    const users = await apiGet("Usuarios");
    const user = users.find((u) => u.email === email && String(u.pass) === String(pass));

    if (user) {
        sessionStorage.setItem("giar_active_user", JSON.stringify(user));
        document.body.classList.remove("unauthenticated");
        modalLogin.hide();
        renderApp();
    } else {
        alertEl.classList.remove("d-none");
    }
});

document.getElementById("btn-logout").addEventListener("click", () => {
    sessionStorage.removeItem("giar_active_user");
    document.body.classList.add("unauthenticated");
    modalLogin.show();
});

document.getElementById("student-cep").addEventListener("blur", async (e) => {
    const cep = e.target.value.replace(/\D/g, "");
    if (cep.length === 8) {
        try {
            const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const data = await res.json();
            if (!data.erro) {
                document.getElementById("student-street").value = data.logradouro;
                document.getElementById("student-neighborhood").value = data.bairro;
                document.getElementById("student-city").value = data.localidade;
                document.getElementById("student-uf").value = data.uf;
            }
        } catch (err) {
            console.error(err);
        }
    }
});

async function renderApp() {
    const user = JSON.parse(sessionStorage.getItem("giar_active_user"));
    if (!user) return;
    document.getElementById("user-name").textContent = user.name;

    const [students, finance] = await Promise.all([apiGet("Membros"), apiGet("Financas")]);

    globalStudentsCache = students;

    renderDashboard(students, finance);
    renderStudents(students);
    renderFinance(finance);
    renderReports(finance);
}

function calcularIdade(dataNasc) {
    if (!dataNasc) return null;
    const hoje = new Date();
    const nasc = new Date(dataNasc);
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) {
        idade--;
    }
    return idade;
}

async function viewStudent(id) {
    showLoading(true);
    try {
        const students = await apiGet("Membros");
        const student = students.find((s) => String(s.id) === String(id));

        if (!student) {
            alert("Membro não encontrado na base de dados.");
            return;
        }

        fillModalStudent(student);
        setModalFieldsDisabled(true);

        document.querySelector("#modalStudent .modal-title").textContent = `Visualizar Cadastro: ${student.name}`;
        document.querySelector('#form-student button[type="submit"]').style.display = "none";

        modalStudent.show();
    } catch (e) {
        console.error("Erro ao visualizar membro:", e);
        alert("Erro ao carregar dados do membro.");
    } finally {
        showLoading(false);
    }
}

async function editStudent(id) {
    showLoading(true);
    try {
        const students = await apiGet("Membros");
        const student = students.find((s) => String(s.id) === String(id));

        if (!student) {
            alert("Membro não encontrado para edição.");
            return;
        }

        fillModalStudent(student);
        setModalFieldsDisabled(false);

        document.querySelector("#modalStudent .modal-title").textContent = `Editar Cadastro: ${student.name}`;
        document.querySelector('#form-student button[type="submit"]').style.display = "block";

        modalStudent.show();
    } catch (e) {
        console.error("Erro ao editar membro:", e);
        alert("Erro ao carregar dados para edição.");
    } finally {
        showLoading(false);
    }
}

function fillModalStudent(s) {
    const idField = document.getElementById("student-id");
    if (idField) idField.value = s.id || "";

    document.getElementById("student-status").value = s.status || "Ativo";
    document.getElementById("student-name").value = s.name || "";
    document.getElementById("student-dob").value = s.dob || "";
    document.getElementById("student-rg").value = s.rg || "";
    document.getElementById("student-financial").value = s.financial || "Dízimo";

    document.getElementById("student-mother").value = s.mother || "";
    document.getElementById("student-father").value = s.father || "";
    document.getElementById("student-class").value = s.class || "";

    document.getElementById("student-cep").value = s.cep || "";
    document.getElementById("student-street").value = s.street || "";
    document.getElementById("student-number").value = s.number || "";
    document.getElementById("student-neighborhood").value = s.neighborhood || "";
    document.getElementById("student-city").value = s.city || "";
    document.getElementById("student-uf").value = s.uf || "";

    document.getElementById("student-notes").value = s.notes || "";
}

function setModalFieldsDisabled(disabled) {
    const form = document.getElementById("form-student");
    const elements = form.querySelectorAll("input, select, textarea");

    elements.forEach((el) => {
        if (el.id !== "student-id") {
            el.disabled = disabled;
        }
    });
}

function renderDashboard(students, finance) {
    const activeStudents = students.filter((s) => s.status === "Ativo");
    document.getElementById("dash-active-students").textContent = activeStudents.length;

    let children = 0;
    let teens = 0;
    let adults = 0;

    activeStudents.forEach((s) => {
        const idade = calcularIdade(s.dob);
        if (idade !== null) {
            if (idade <= 12) children++;
            else if (idade <= 17) teens++;
            else adults++;
        }
    });

    document.getElementById("age-children").textContent = children;
    document.getElementById("age-teens").textContent = teens;
    document.getElementById("age-adults").textContent = adults;

    const currMonth = new Date().getMonth();
    const bdaysList = document.getElementById("dash-birthdays-list");
    bdaysList.innerHTML = "";

    function parseLocalDate(dateStr) {
        if (!dateStr) return null;
        const [year, month, day] = dateStr.split("T")[0].split("-").map(Number);
        return new Date(year, month - 1, day);
    }

    const monthStudents = students.filter((s) => {
        const dob = parseLocalDate(s.dob);
        return dob && dob.getMonth() === currMonth;
    });

    if (monthStudents.length === 0) {
        bdaysList.innerHTML =
            '<li class="list-group-item text-muted list-group-item-action text-center small">Nenhum aniversariante no mês.</li>';
    } else {
        monthStudents.sort((a, b) => parseLocalDate(a.dob).getDate() - parseLocalDate(b.dob).getDate());

        monthStudents.forEach((s) => {
            const dob = parseLocalDate(s.dob);
            const day = dob.getDate();

            bdaysList.innerHTML += `<li class="list-group-item d-flex justify-content-between align-items-center list-group-item-action">
        <span>${s.name}</span>
        <span class="badge bg-pink rounded-pill">${day}</span>
      </li>`;
        });
    }

    const yearFilter = document.getElementById("dash-year-filter");
    const anosDisponiveis = [...new Set(finance.map((f) => new Date(f.date).getFullYear()))].sort((a, b) => b - a);

    const anoSelecionadoAnteriormente = yearFilter.value;
    yearFilter.innerHTML = "";

    if (anosDisponiveis.length === 0) {
        anosDisponiveis.push(new Date().getFullYear());
    }

    anosDisponiveis.forEach((ano) => {
        const option = document.createElement("option");
        option.value = ano;
        option.textContent = ano;
        yearFilter.appendChild(option);
    });

    if (anoSelecionadoAnteriormente && anosDisponiveis.includes(Number(anoSelecionadoAnteriormente))) {
        yearFilter.value = anoSelecionadoAnteriormente;
    } else {
        yearFilter.value = anosDisponiveis[0];
    }

    function processarDadosFinanceiros(ano) {
        const financeAno = finance.filter((f) => new Date(f.date).getFullYear() === Number(ano));

        const totalIn = financeAno.filter((f) => f.type === "Entrada").reduce((a, b) => a + Number(b.amount || 0), 0);
        const totalOut = financeAno.filter((f) => f.type === "Saída").reduce((a, b) => a + Number(b.amount || 0), 0);

        document.getElementById("dash-total-income").textContent = fmtCurr(totalIn);
        document.getElementById("dash-total-expense").textContent = fmtCurr(totalOut);
        document.getElementById("dash-balance").textContent = fmtCurr(totalIn - totalOut);

        const saldosMensais = Array(12).fill(0);

        financeAno.forEach((f) => {
            const mes = new Date(f.date).getMonth();
            const valor = Number(f.amount || 0);
            if (f.type === "Entrada") saldosMensais[mes] += valor;
            else saldosMensais[mes] -= valor;
        });

        const ctx = document.getElementById("chart-finance-monthly").getContext("2d");
        const labels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

        const data = {
            labels: labels,
            datasets: [
                {
                    label: "Saldo Mensal (R$)",
                    data: saldosMensais,
                    backgroundColor: saldosMensais.map((v) =>
                        v >= 0 ? "rgba(35, 130, 83, 0.7)" : "rgba(168, 59, 50, 0.7)"
                    ),
                    borderColor: saldosMensais.map((v) => (v >= 0 ? "rgb(35, 130, 83)" : "rgb(168, 59, 50)")),
                    borderWidth: 1,
                },
            ],
        };

        if (financeChart) {
            financeChart.data = data;
            financeChart.options.plugins.title.text = `Saldo Mensal - Ano ${ano}`;
            financeChart.update();
        } else {
            financeChart = new Chart(ctx, {
                type: "bar",
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        title: { display: true, text: `Saldo Mensal - Ano ${ano}`, color: "#666", font: { size: 14 } },
                        tooltip: {
                            callbacks: {
                                label: (context) => `Saldo: ${fmtCurr(context.parsed.y)}`,
                            },
                        },
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: (value) =>
                                    value.toLocaleString("pt-BR", {
                                        style: "currency",
                                        currency: "BRL",
                                        minimumFractionDigits: 0,
                                        maximumFractionDigits: 0,
                                    }),
                            },
                        },
                    },
                },
            });
        }
    }

    processarDadosFinanceiros(yearFilter.value);

    yearFilter.removeEventListener("change", handleYearChange);
    yearFilter.addEventListener("change", handleYearChange);

    function handleYearChange(e) {
        processarDadosFinanceiros(e.target.value);
    }

    const turmasContagem = {};

    activeStudents.forEach((s) => {
        const turma = s.class || "Sem Ministério";
        turmasContagem[turma] = (turmasContagem[turma] || 0) + 1;
    });

    const labelsTurmas = Object.keys(turmasContagem);
    const dataTurmas = Object.values(turmasContagem);

    const coresTurmas = ["#3E2723", "#5D4037", "#795548", "#B78103", "#D4AF37", "#6d6158", "#a83b32", "#238253"];

    const ctxClassElement = document.getElementById("chart-students-class");

    if (ctxClassElement) {
        const ctxClass = ctxClassElement.getContext("2d");

        if (classChart) {
            classChart.data.labels = labelsTurmas;
            classChart.data.datasets[0].data = dataTurmas;
            classChart.update();
        } else {
            classChart = new Chart(ctxClass, {
                type: "doughnut",
                data: {
                    labels: labelsTurmas,
                    datasets: [
                        {
                            data: dataTurmas,
                            backgroundColor: coresTurmas.slice(0, labelsTurmas.length),
                            borderWidth: 2,
                            borderColor: "#ffffff",
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: "bottom",
                            labels: {
                                boxWidth: 12,
                                font: { size: 11 },
                            },
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => ` ${context.label}: ${context.parsed} membro(s)`,
                            },
                        },
                    },
                },
            });
        }
    }
}

function filterAndRenderStudents() {
    const searchTerm = (document.getElementById("student-search-input").value || "").toLowerCase().trim();

    const filtered = globalStudentsCache.filter((s) => {
        const name = (s.name || "").toLowerCase();
        return name.includes(searchTerm);
    });

    renderStudents(filtered);
}

document.getElementById("student-search-input").addEventListener("input", filterAndRenderStudents);

function renderStudents(students) {
    const tbody = document.querySelector("#table-students tbody");
    tbody.innerHTML = "";

    if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Nenhum membro encontrado.</td></tr>';
        return;
    }

    students.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    students.forEach((s) => {
        tbody.innerHTML += `<tr>
      <td><strong>${s.name || "-"}</strong></td>
      <td><span class="badge ${s.status === "Ativo" ? "bg-success" : "bg-secondary"}">${s.status || "-"}</span></td>
      <td><span class="badge ${s.financial === "Dízimo" ? "bg-info" : "bg-warning"}">${s.financial || "-"}</span></td>
      <td class="small text-muted">${s.city || "-"}/${s.uf || "-"}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm" role="group">
          <button class="btn btn-outline-primary" onclick="viewStudent('${s.id}')" title="Visualizar Cadastro">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-outline-secondary" onclick="editStudent('${s.id}')" title="Editar Cadastro">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-outline-danger" onclick="deleteStudent('${s.id}')" title="Excluir Cadastro">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
    });
}

async function populateTxStudentSelect(selectedValue = "") {
    const students = await apiGet("Membros");
    const select = document.getElementById("tx-student-link");
    select.innerHTML = '<option value="">Sem Vínculo</option>';

    students
        .filter((s) => s.status === "Ativo")
        .forEach((s) => {
            select.innerHTML += `<option value="${s.name}">${s.name}</option>`;
        });

    select.value = selectedValue;
}

function fillModalTx(t) {
    document.getElementById("tx-id").value = t.id || "";
    document.getElementById("tx-date").value = t.date ? t.date.split("T")[0] : "";
    document.getElementById("tx-type").value = t.type || "Entrada";
    document.getElementById("tx-category").value = t.category || "";
    document.getElementById("tx-method").value = t.method || "Dinheiro";
    document.getElementById("tx-amount").value = t.amount || "";
}

function setTxModalFieldsDisabled(disabled) {
    const form = document.getElementById("form-transaction");
    const elements = form.querySelectorAll("input, select, textarea");
    elements.forEach((el) => {
        if (el.id !== "tx-id") {
            el.disabled = disabled;
        }
    });
}

async function viewTx(id) {
    showLoading(true);
    try {
        const finance = await apiGet("Financas");
        const tx = finance.find((f) => String(f.id) === String(id));

        if (!tx) {
            alert("Lançamento não encontrado.");
            return;
        }

        await populateTxStudentSelect(tx.student || "");
        fillModalTx(tx);
        setTxModalFieldsDisabled(true);

        document.querySelector("#modalTransaction .modal-title").textContent =
            `Visualizar Lançamento (CÓD: ${tx.code || "-"})`;
        document.querySelector('#form-transaction button[type="submit"]').style.display = "none";

        modalTx.show();
    } catch (e) {
        console.error("Erro ao visualizar lançamento:", e);
        alert("Erro ao carregar dados do lançamento.");
    } finally {
        showLoading(false);
    }
}

async function editTx(id) {
    showLoading(true);
    try {
        const finance = await apiGet("Financas");
        const tx = finance.find((f) => String(f.id) === String(id));

        if (!tx) {
            alert("Lançamento não encontrado para edição.");
            return;
        }

        await populateTxStudentSelect(tx.student || "");
        fillModalTx(tx);
        setTxModalFieldsDisabled(false);

        document.querySelector("#modalTransaction .modal-title").textContent =
            `Editar Lançamento (CÓD: ${tx.code || "-"})`;
        document.querySelector('#form-transaction button[type="submit"]').style.display = "block";

        modalTx.show();
    } catch (e) {
        console.error("Erro ao editar lançamento:", e);
        alert("Erro ao carregar lançamento para edição.");
    } finally {
        showLoading(false);
    }
}

let globalFinanceCache = [];

function filterAndRenderFinance() {
    const monthVal = document.getElementById("fin-filter-month").value;
    const yearVal = document.getElementById("fin-filter-year").value;
    const exactDateVal = document.getElementById("fin-filter-date").value;

    const filtered = globalFinanceCache.filter((t) => {
        if (!t.date) return false;

        const [year, month, day] = t.date.split("T")[0].split("-").map(Number);

        if (monthVal !== "" && month - 1 !== Number(monthVal)) {
            return false;
        }

        if (yearVal !== "" && year !== Number(yearVal)) {
            return false;
        }

        if (exactDateVal) {
            const formattedTxDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            if (formattedTxDate !== exactDateVal) {
                return false;
            }
        }

        return true;
    });

    renderFinance(filtered);
    updateFinanceCards(filtered);
}

document.getElementById("fin-filter-month").addEventListener("change", filterAndRenderFinance);
document.getElementById("fin-filter-year").addEventListener("change", filterAndRenderFinance);
document.getElementById("fin-filter-date").addEventListener("change", filterAndRenderFinance);

document.getElementById("btn-clear-fin-filters").addEventListener("click", () => {
    document.getElementById("fin-filter-month").value = "";
    document.getElementById("fin-filter-year").value = "";
    document.getElementById("fin-filter-date").value = "";
    filterAndRenderFinance();
});

function updateFinanceCards(transactions) {
    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach((t) => {
        const val = Number(t.amount) || 0;
        if (t.type === "Entrada") {
            totalIncome += val;
        } else if (t.type === "Saída") {
            totalExpense += val;
        }
    });

    const balance = totalIncome - totalExpense;

    document.getElementById("fin-sum-income").textContent = fmtCurr(totalIncome);
    document.getElementById("fin-sum-expense").textContent = fmtCurr(totalExpense);

    const balanceEl = document.getElementById("fin-sum-balance");
    const cardBalanceBg = document.getElementById("card-fin-balance-bg");

    balanceEl.textContent = fmtCurr(balance);

    if (balance >= 0) {
        cardBalanceBg.className = "card border-0 shadow-sm bg-primary-subtle text-primary p-3 rounded-3";
    } else {
        cardBalanceBg.className = "card border-0 shadow-sm bg-danger-subtle text-danger p-3 rounded-3";
    }
}

function renderFinance(finance) {
    const tbody = document.querySelector("#table-finance tbody");
    tbody.innerHTML = "";

    if (finance.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="9" class="text-center text-muted py-4">Nenhum lançamento encontrado para os filtros selecionados.</td></tr>';
        return;
    }

    finance.sort((a, b) => new Date(b.date) - new Date(a.date));

    finance.forEach((t) => {
        const dateParts = t.date ? t.date.split("T")[0].split("-") : null;
        const formattedDate = dateParts ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : "-";

        const isIncome = t.type === "Entrada";
        const typeIcon = isIncome ? "bi-arrow-up-circle-fill" : "bi-arrow-down-circle-fill";
        const badgeClass = isIncome ? "bg-success" : "bg-danger";

        tbody.innerHTML += `<tr>
      <td>${t.code || "-"}</td>
      <td>${formattedDate}</td>
      <td>
        <span class="badge ${badgeClass} d-inline-flex align-items-center gap-1">
          <i class="bi ${typeIcon}"></i>
          ${t.type || "-"}
        </span>
      </td>
      <td>${t.category || "-"}</td>
      <td>${t.student || "Geral"}</td>
      <td>${t.method || "-"}</td>
      <td class="text-success">${isIncome ? fmtCurr(t.amount) : "R$ 0,00"}</td>
      <td class="text-danger">${!isIncome ? fmtCurr(t.amount) : "R$ 0,00"}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm" role="group">
          <button class="btn btn-outline-primary" onclick="viewTx('${t.id}')" title="Visualizar Lançamento">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-outline-secondary" onclick="editTx('${t.id}')" title="Editar Lançamento">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-outline-danger" onclick="deleteTx('${t.id}')" title="Excluir Lançamento">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    </tr>`;
    });
}

function renderReports(finance) {
    const tbodyIn = document.querySelector("#table-report-incomes tbody");
    const tbodyOut = document.querySelector("#table-report-expenses tbody");

    tbodyIn.innerHTML = "";
    tbodyOut.innerHTML = "";

    const incomeCategories = {};
    const expenseCategories = {};

    let totalInCount = 0;
    let totalInAmount = 0;
    let totalOutCount = 0;
    let totalOutAmount = 0;

    finance.forEach((t) => {
        const val = Number(t.amount) || 0;
        const catName = t.category || "Geral / Outros";

        if (t.type === "Entrada") {
            if (!incomeCategories[catName]) {
                incomeCategories[catName] = { count: 0, amount: 0 };
            }
            incomeCategories[catName].count += 1;
            incomeCategories[catName].amount += val;

            totalInCount += 1;
            totalInAmount += val;
        } else if (t.type === "Saída") {
            if (!expenseCategories[catName]) {
                expenseCategories[catName] = { count: 0, amount: 0 };
            }
            expenseCategories[catName].count += 1;
            expenseCategories[catName].amount += val;

            totalOutCount += 1;
            totalOutAmount += val;
        }
    });

    const inKeys = Object.keys(incomeCategories);
    if (inKeys.length === 0) {
        tbodyIn.innerHTML =
            '<tr><td colspan="3" class="text-center text-muted py-3">Nenhuma entrada registrada.</td></tr>';
    } else {
        inKeys.forEach((cat) => {
            const item = incomeCategories[cat];
            tbodyIn.innerHTML += `<tr>
        <td><i class="bi bi-tag-fill me-2 text-success opacity-75"></i>${cat}</td>
        <td class="text-end">${item.count}</td>
        <td class="text-end fw-semibold text-success">${fmtCurr(item.amount)}</td>
      </tr>`;
        });
    }

    const outKeys = Object.keys(expenseCategories);
    if (outKeys.length === 0) {
        tbodyOut.innerHTML =
            '<tr><td colspan="3" class="text-center text-muted py-3">Nenhuma saída registrada.</td></tr>';
    } else {
        outKeys.forEach((cat) => {
            const item = expenseCategories[cat];
            tbodyOut.innerHTML += `<tr>
        <td><i class="bi bi-tag-fill me-2 text-danger opacity-75"></i>${cat}</td>
        <td class="text-end">${item.count}</td>
        <td class="text-end fw-semibold text-danger">${fmtCurr(item.amount)}</td>
      </tr>`;
        });
    }

    document.getElementById("rep-total-in-count").textContent = totalInCount;
    document.getElementById("rep-total-in-amount").textContent = fmtCurr(totalInAmount);

    document.getElementById("rep-total-out-count").textContent = totalOutCount;
    document.getElementById("rep-total-out-amount").textContent = fmtCurr(totalOutAmount);
}

function printReportLandscape() {
    window.print();
}

document.getElementById("btn-new-student").addEventListener("click", () => {
    const form = document.getElementById("form-student");
    if (!form) return;

    form.reset();
    document.getElementById("student-id").value = "";

    document.querySelector("#modalStudent .modal-title").textContent = "Cadastrar Membro";
    document.querySelector('#form-student button[type="submit"]').style.display = "block";
    setModalFieldsDisabled(false);

    modalStudent.show();
});

document.getElementById("form-student").addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentId = document.getElementById("student-id").value;
    const studentId = currentId ? currentId : uid();
    const actionType = currentId ? "update" : "create";

    const newS = {
        id: studentId,
        status: document.getElementById("student-status").value,
        name: document.getElementById("student-name").value,
        dob: document.getElementById("student-dob").value,
        rg: document.getElementById("student-rg").value,
        financial: document.getElementById("student-financial").value,
        father: document.getElementById("student-father").value,
        mother: document.getElementById("student-mother").value,
        cep: document.getElementById("student-cep").value,
        street: document.getElementById("student-street").value,
        number: document.getElementById("student-number").value,
        neighborhood: document.getElementById("student-neighborhood").value,
        city: document.getElementById("student-city").value,
        uf: document.getElementById("student-uf").value,
        class: document.getElementById("student-class").value,
        notes: document.getElementById("student-notes").value,
    };

    await apiPost("Membros", actionType, newS);
    modalStudent.hide();
    renderApp();
});

document.getElementById("btn-new-transaction").addEventListener("click", async () => {
    await populateTxStudentSelect();
    document.getElementById("form-transaction").reset();
    document.getElementById("tx-id").value = "";
    document.getElementById("tx-date").valueAsDate = new Date();

    setTxModalFieldsDisabled(false);
    document.querySelector("#modalTransaction .modal-title").textContent = "Novo Lançamento Financeiro";
    document.querySelector('#form-transaction button[type="submit"]').style.display = "block";

    modalTx.show();
});

document.getElementById("form-transaction").addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentId = document.getElementById("tx-id").value;
    const isUpdate = Boolean(currentId);
    const txId = isUpdate ? currentId : uid();
    const actionType = isUpdate ? "update" : "create";

    const newT = {
        id: txId,
        code: isUpdate ? undefined : Math.floor(100 + Math.random() * 900),
        date: document.getElementById("tx-date").value,
        type: document.getElementById("tx-type").value,
        category: document.getElementById("tx-category").value,
        student: document.getElementById("tx-student-link").value,
        method: document.getElementById("tx-method").value,
        amount: parseFloat(document.getElementById("tx-amount").value),
    };

    await apiPost("Financas", actionType, newT);
    modalTx.hide();
    renderApp();
});

async function deleteStudent(id) {
    if (confirm("Deseja realmente remover este membro do Google Sheets?")) {
        await apiPost("Membros", "delete", id);
        renderApp();
    }
}

async function deleteTx(id) {
    if (confirm("Deseja realmente excluir esta transação?")) {
        await apiPost("Financas", "delete", id);
        renderApp();
    }
}

if (sessionStorage.getItem("giar_active_user")) {
    document.body.classList.remove("unauthenticated");
    renderApp();
}
