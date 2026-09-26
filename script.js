/* CONFIGURAÇÃO DA API DO GOOGLE APPS SCRIPT API GIAR V1 */
const API_URL =
    "https://script.google.com/macros/s/AKfycbw4FdA3xTxXIZ1mo6dgBuKhWGHT-mYxLHfJo9K688r3nCHjqIR1Tsdn98qmErp1ko5K/exec";

const uid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);
const fmtCurr = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function showLoading(show = true) {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.style.display = show ? "flex" : "none";
}

/* Modais Bootstrap */
const modalLogin = new bootstrap.Modal(document.getElementById("modalLogin"));
const modalStudent = new bootstrap.Modal(document.getElementById("modalStudent"));
const modalTx = new bootstrap.Modal(document.getElementById("modalTransaction"));

/* Variáveis globais para os gráficos */
let financeChart = null;
let classChart = null;

/* Variável global para cache da lista de alunos */
let globalStudentsCache = [];
let globalFinanceCache = [];

/* Plano de contas dinâmico do balancete contábil */
const BALANCETE_ACCOUNT_VERSION = 1;
const BALANCETE_ACCOUNTS = {
    cash: { codigo: "111110100", titulo: "CAIXA", natureza: "D" },
    bank: { codigo: "111110301", titulo: "BANCOS / CONTA CORRENTE", natureza: "D" },
    income: { natureza: "C", prefixo: "4" },
    expense: { natureza: "D", prefixo: "5" },
};

function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function accountHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
}

function dynamicAccountCode(prefix, label) {
    const n = (accountHash(normalizeText(label)) % 899999) + 100000;
    return `${prefix}11${String(n).padStart(6, "0")}`;
}

function getFinancialAssetAccount(method) {
    const m = normalizeText(method);
    if (!m || m.includes("dinheiro") || m.includes("especie") || m.includes("caixa")) return BALANCETE_ACCOUNTS.cash;
    return BALANCETE_ACCOUNTS.bank;
}

function getDynamicIncomeAccount(category) {
    const title = `RECEITAS - ${String(category || "OUTRAS RECEITAS")
        .trim()
        .toUpperCase()}`;
    return { codigo: dynamicAccountCode("4", title), titulo: title, natureza: "C" };
}

function getDynamicExpenseAccount(category) {
    const title = `DESPESAS - ${String(category || "OUTRAS DESPESAS")
        .trim()
        .toUpperCase()}`;
    return { codigo: dynamicAccountCode("5", title), titulo: title, natureza: "D" };
}

/**
 * Converte cada lançamento financeiro em uma partida simples de débito/crédito:
 * Entrada  = débito no caixa/banco + crédito na receita.
 * Saída    = débito na despesa + crédito no caixa/banco.
 * Não existem saldos iniciais fixos: o saldo anterior é calculado pelos lançamentos
 * anteriores ao período selecionado.
 */
function buildBalancetePostings(finance, year, month) {
    const periodStart = month === "all" ? new Date(year, 0, 1) : new Date(year, Number(month), 1);
    const periodEnd = month === "all" ? new Date(year + 1, 0, 1) : new Date(year, Number(month) + 1, 1);
    const accounts = new Map();

    function ensureAccount(account) {
        if (!accounts.has(account.codigo))
            accounts.set(account.codigo, {
                ...account,
                saldoAnterior: 0,
                devedor: 0,
                credor: 0,
            });
        return accounts.get(account.codigo);
    }

    function addPosting(account, date, debit, credit) {
        const row = ensureAccount(account);
        const dt = parseLocalDate(date);
        const amountDebit = Number(debit) || 0;
        const amountCredit = Number(credit) || 0;
        if (dt < periodStart) {
            row.saldoAnterior += row.natureza === "D" ? amountDebit - amountCredit : amountCredit - amountDebit;
        } else if (dt >= periodStart && dt < periodEnd) {
            row.devedor += amountDebit;
            row.credor += amountCredit;
        }
    }

    (finance || []).forEach((t) => {
        const value = Number(t.amount) || 0;
        if (!t.date || value <= 0) return;
        const type = normalizeText(t.type);
        const asset = getFinancialAssetAccount(t.method);
        if (type === "entrada") {
            addPosting(asset, t.date, value, 0);
            addPosting(getDynamicIncomeAccount(t.category), t.date, 0, value);
        } else if (type === "saida") {
            addPosting(getDynamicExpenseAccount(t.category), t.date, value, 0);
            addPosting(asset, t.date, 0, value);
        }
    });

    return { accounts, periodStart, periodEnd };
}

/* Funçõies auxiliares de data */
function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();

    if (dateStr instanceof Date) {
        return dateStr;
    }

    const str = String(dateStr).trim();

    if (str.includes("T")) {
        return new Date(str);
    }

    if (str.includes("-")) {
        const parts = str.split("-");
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }

    return new Date(str);
}

function calcularIdade(dataNasc) {
    if (!dataNasc) return null;
    const hoje = new Date();
    const nasc = parseLocalDate(dataNasc);
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) {
        idade--;
    }
    return idade;
}

/* Funções de comunicação com o APPS SCRIPT (JSONP & POST) */
function apiGet(sheetName) {
    showLoading(true);
    return new Promise((resolve, reject) => {
        const callbackName = "jsonp_callback_" + Math.round(100000 * Math.random());

        window[callbackName] = function (data) {
            delete window[callbackName];
            document.body.removeChild(script);
            showLoading(false);
            if (data && data.error) {
                reject(data.error);
            } else {
                resolve(Array.isArray(data) ? data : []);
            }
        };

        const script = document.createElement("script");
        script.src = `${API_URL}?action=read&sheet=${encodeURIComponent(sheetName)}&callback=${callbackName}`;
        script.onerror = function () {
            delete window[callbackName];
            document.body.removeChild(script);
            showLoading(false);
            reject(new Error("Falha na requisição JSONP. Verifique as permissões do script."));
        };

        document.body.appendChild(script);
    });
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
            mode: "no-cors" /* Evita bloqueio de CORS com o Apps Script */,
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(bodyObj),
        });

        /* Aguarda 1.5 segundos para garantir o processamento na planilha */
        await new Promise((r) => setTimeout(r, 1500));
        return { success: true };
    } catch (err) {
        console.error("Erro no apiPost:", err);
        throw err;
    } finally {
        showLoading(false);
    }
}

/* Eventos de autenticação e navegação */
document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();

    const alertEl = document.getElementById("login-alert");
    alertEl.classList.add("d-none");

    const email = document.getElementById("login-email").value;
    const pass = document.getElementById("login-password").value;

    try {
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
    } catch (err) {
        alert("Erro ao realizar login. Tente novamente.");
    }
});

document.getElementById("btn-logout").addEventListener("click", () => {
    sessionStorage.removeItem("giar_active_user");
    document.body.classList.add("unauthenticated");
    modalLogin.show();
});

/* Controle de permissão (RBAC) */
function applyUserPermissions(user) {
    const role = (user.role || "").toLowerCase().trim();
    const isSecretary = role === "secretária" || role === "secretaria" || role === "secretario";

    /* Oculta/Exibe os itens da navegação conforme o perfil */
    const finNavItems = document.querySelectorAll(".nav-role-financeiro");
    finNavItems.forEach((el) => {
        el.style.display = isSecretary ? "none" : "";
    });

    /* Garante redirecionamento para o Dashboard caso o usuário seja secretária e tente acessar abas restritas */
    if (isSecretary) {
        const activeTab = document.querySelector("#main-nav .nav-link.active");
        if (activeTab) {
            const target = activeTab.getAttribute("data-bs-target");
            if (target === "#dizimistas" || target === "#finance" || target === "#reports") {
                const dashTab = document.querySelector('#main-nav a[data-bs-target="#dashboard"]');
                if (dashTab) {
                    const tabTrigger = new bootstrap.Tab(dashTab);
                    tabTrigger.show();
                }
            }
        }
    }
}

/* Busca de CEP */
document.getElementById("student-cep").addEventListener("blur", async (e) => {
    const cep = e.target.value.replace(/\D/g, "");
    if (cep.length === 8) {
        try {
            const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
            const data = await res.json();
            if (!data.erro) {
                document.getElementById("student-street").value = data.logradouro || "";
                document.getElementById("student-neighborhood").value = data.bairro || "";
                document.getElementById("student-city").value = data.localidade || "";
                document.getElementById("student-uf").value = data.uf || "";
            }
        } catch (err) {
            console.error(err);
        }
    }
});

/* Renderização principal */
async function renderApp() {
    const user = JSON.parse(sessionStorage.getItem("giar_active_user"));
    if (!user) return;
    document.getElementById("user-name").textContent = user.name;

    /* Aplica o filtro de permissões baseado na role do usuário */
    applyUserPermissions(user);

    try {
        const [students, finance] = await Promise.all([apiGet("Membros"), apiGet("Financas")]);

        globalStudentsCache = students;
        globalFinanceCache = finance;

        renderDashboard(students, finance);
        renderStudents(students);
        renderDizimistasGabarito();
        renderFinance(finance);
        updateFinanceCards(finance);
        renderReports(finance);
    } catch (err) {
        console.error("Erro ao carregar os dados:", err);
    }
}

/* Renderizar gabarito de dizmistas */
function renderDizimistasGabarito() {
    const selectedYear = Number(document.getElementById("diz-filter-year").value);
    const selectedMonth = document.getElementById("diz-filter-month").value;
    const selectedStatus = document.getElementById("diz-filter-status").value;
    const searchVal = (document.getElementById("diz-filter-search").value || "").toLowerCase().trim();

    /* Filtra membros dizimistas cadastrados */
    let dizimistas = globalStudentsCache.filter((s) => {
        const isDiz = s.financial === "Dízimo" || !s.financial; /* Considera dízimo por padrão */
        const matchName = (s.name || "").toLowerCase().includes(searchVal);
        return isDiz && matchName;
    });

    /* Mapeamento de lançamentos de dízimos do ano selecionado */
    const dizimoTxs = globalFinanceCache.filter((t) => {
        if (!t.date || t.type !== "Entrada") return false;
        const cat = (t.category || "").toLowerCase();
        if (!cat.includes("dízimo") && !cat.includes("dizimo")) return false;
        const dt = parseLocalDate(t.date);
        return dt.getFullYear() === selectedYear;
    });

    const monthNames = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
    const tableHeaderTr = document.getElementById("diz-table-header");

    /* Ajusta o cabeçalho se um mês específico for selecionado */
    if (selectedMonth !== "all") {
        const mIdx = Number(selectedMonth);
        tableHeaderTr.innerHTML = `
        <th class="text-start">NOME DO DIZIMISTA</th>
        <th>MINISTÉRIO / DEP.</th>
        <th>CONTRIBUIU EM ${monthNames[mIdx]}?</th>
        <th>VALOR ($)</th>
        <th>FORMA</th>
        <th>DATA LANÇAMENTO</th>
      `;
    } else {
        tableHeaderTr.innerHTML = `
        <th class="text-start">NOME DO DIZIMISTA</th>
        <th>JAN</th><th>FEV</th><th>MAR</th><th>ABR</th><th>MAI</th><th>JUN</th>
        <th>JUL</th><th>AGO</th><th>SET</th><th>OUT</th><th>NOV</th><th>DEZ</th>
        <th>TOTAL (R$)</th>
      `;
    }

    const tbody = document.querySelector("#table-dizimistas tbody");
    tbody.innerHTML = "";

    let totalPaidInPeriodCount = 0;
    let totalUnpaidInPeriodCount = 0;
    let totalDizimoAmountInPeriod = 0;

    const rowsToRender = [];

    dizimistas.forEach((diz) => {
        /* Mapeia dízimos deste membro pelos 12 meses */
        const monthsData = Array(12)
            .fill(null)
            .map(() => ({ paid: false, amount: 0, methods: [], dates: [] }));

        dizimoTxs.forEach((tx) => {
            if ((tx.student || "").trim().toLowerCase() === (diz.name || "").trim().toLowerCase()) {
                const m = parseLocalDate(tx.date).getMonth();
                monthsData[m].paid = true;
                monthsData[m].amount += Number(tx.amount || 0);
                if (tx.method) monthsData[m].methods.push(tx.method);
                if (tx.date) monthsData[m].dates.push(tx.date);
            }
        });

        let dizTotalYear = monthsData.reduce((acc, curr) => acc + curr.amount, 0);

        /* Lógica de filtro por status */
        let hasContribution = false;
        if (selectedMonth === "all") {
            hasContribution = monthsData.some((m) => m.paid);
        } else {
            hasContribution = monthsData[Number(selectedMonth)].paid;
        }

        if (selectedStatus === "paid" && !hasContribution) return;
        if (selectedStatus === "unpaid" && hasContribution) return;

        if (hasContribution) totalPaidInPeriodCount++;
        else totalUnpaidInPeriodCount++;

        if (selectedMonth === "all") {
            totalDizimoAmountInPeriod += dizTotalYear;
        } else {
            totalDizimoAmountInPeriod += monthsData[Number(selectedMonth)].amount;
        }

        rowsToRender.push({ diz, monthsData, dizTotalYear, hasContribution });
    });

    if (rowsToRender.length === 0) {
        const colCount = selectedMonth === "all" ? 14 : 6;
        tbody.innerHTML = `<tr><td colspan="${colCount}" class="text-center text-muted py-4">Nenhum registro de dizimista encontrado com os filtros selecionados.</td></tr>`;
    } else {
        rowsToRender.sort((a, b) => (a.diz.name || "").localeCompare(b.diz.name || ""));

        rowsToRender.forEach(({ diz, monthsData, dizTotalYear }) => {
            let rowHtml = "";

            if (selectedMonth === "all") {
                let colsHtml = "";
                monthsData.forEach((m) => {
                    if (m.paid) {
                        colsHtml += `<td class="table-success text-success fw-bold" title="${fmtCurr(m.amount)} (${m.methods.join(", ")})">
                <i class="bi bi-check-circle-fill"></i>
              </td>`;
                    } else {
                        colsHtml += `<td class="table-light text-muted opacity-50"><i class="bi bi-x-lg"></i></td>`;
                    }
                });

                rowHtml = `<tr>
            <td class="text-start fw-semibold">${diz.name}</td>
            ${colsHtml}
            <td class="fw-bold ${dizTotalYear > 0 ? "text-success" : "text-muted"}">${fmtCurr(dizTotalYear)}</td>
          </tr>`;
            } else {
                const mIdx = Number(selectedMonth);
                const mData = monthsData[mIdx];
                const dt = mData.dates[0] ? parseLocalDate(mData.dates[0]) : null;
                const formattedDt = dt
                    ? `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
                    : "-";

                rowHtml = `<tr>
            <td class="text-start fw-semibold">${diz.name}</td>
            <td>${diz.class || "Geral"}</td>
            <td>
              <span class="badge ${mData.paid ? "bg-success" : "bg-danger"}">
                ${mData.paid ? "SIM" : "NÃO"}
              </span>
            </td>
            <td class="fw-bold ${mData.paid ? "text-success" : ""}">${fmtCurr(mData.amount)}</td>
            <td>${mData.methods.join(", ") || "-"}</td>
            <td>${formattedDt}</td>
          </tr>`;
            }

            tbody.innerHTML += rowHtml;
        });
    }

    /* Atualiza cards estatísticos do gabarito */
    document.getElementById("diz-stat-total").textContent = dizimistas.length;
    document.getElementById("diz-stat-paid").textContent = totalPaidInPeriodCount;
    document.getElementById("diz-stat-unpaid").textContent = totalUnpaidInPeriodCount;
    document.getElementById("diz-stat-amount").textContent = fmtCurr(totalDizimoAmountInPeriod);
}

/* Eventos dos filtros do gabarito de dizimistas */
document.getElementById("diz-filter-year").addEventListener("change", renderDizimistasGabarito);
document.getElementById("diz-filter-month").addEventListener("change", renderDizimistasGabarito);
document.getElementById("diz-filter-status").addEventListener("change", renderDizimistasGabarito);
document.getElementById("diz-filter-search").addEventListener("input", renderDizimistasGabarito);

/* Renderizar dashboard */
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
    const anosDisponiveis = [...new Set(finance.map((f) => parseLocalDate(f.date).getFullYear()))].sort(
        (a, b) => b - a
    );

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
        const financeAno = finance.filter((f) => parseLocalDate(f.date).getFullYear() === Number(ano));

        const totalIn = financeAno.filter((f) => f.type === "Entrada").reduce((a, b) => a + Number(b.amount || 0), 0);
        const totalOut = financeAno.filter((f) => f.type === "Saída").reduce((a, b) => a + Number(b.amount || 0), 0);

        document.getElementById("dash-total-income").textContent = fmtCurr(totalIn);
        document.getElementById("dash-total-expense").textContent = fmtCurr(totalOut);
        document.getElementById("dash-balance").textContent = fmtCurr(totalIn - totalOut);

        const saldosMensais = Array(12).fill(0);

        financeAno.forEach((f) => {
            const mes = parseLocalDate(f.date).getMonth();
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
                        v >= 0 ? "rgba(16, 185, 129, 0.75)" : "rgba(239, 68, 68, 0.75)"
                    ),
                    borderColor: saldosMensais.map((v) => (v >= 0 ? "rgb(16, 185, 129)" : "rgb(239, 68, 68)")),
                    borderWidth: 1,
                    borderRadius: 6,
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
                        title: {
                            display: true,
                            text: `Saldo Mensal - Ano ${ano}`,
                            color: "#64748b",
                            font: { size: 14, weight: "600" },
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `Saldo: ${fmtCurr(context.parsed.y)}`,
                            },
                        },
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: "#f1f5f9" },
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
                        x: {
                            grid: { display: false },
                        },
                    },
                },
            });
        }
    }

    processarDadosFinanceiros(yearFilter.value);

    function handleYearChange(e) {
        processarDadosFinanceiros(e.target.value);
    }

    yearFilter.removeEventListener("change", handleYearChange);
    yearFilter.addEventListener("change", handleYearChange);

    const turmasContagem = {};

    activeStudents.forEach((s) => {
        const turma = s.class || "Sem Ministério";
        turmasContagem[turma] = (turmasContagem[turma] || 0) + 1;
    });

    const labelsTurmas = Object.keys(turmasContagem);
    const dataTurmas = Object.values(turmasContagem);

    const coresTurmas = ["#3b82f6", "#10b981", "#f59e0b", "#6366f1", "#8b5cf6", "#ec4899", "#64748b", "#06b6d4"];

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

/* Renderizar e filtrar membros */
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

    const user = JSON.parse(sessionStorage.getItem("giar_active_user") || "{}");
    const role = (user.role || "").toLowerCase().trim();
    const isSecretary = role === "secretária" || role === "secretaria" || role === "secretario";

    if (students.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Nenhum membro encontrado.</td></tr>';
        return;
    }

    students.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    students.forEach((s) => {
        const deleteButtonHtml = isSecretary
            ? ""
            : `
          <button class="btn btn-outline-danger" onclick="deleteStudent('${s.id}')" title="Excluir Cadastro">
            <i class="bi bi-trash"></i>
          </button>`;

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
          ${deleteButtonHtml}
        </div>
      </td>
    </tr>`;
    });
}

function fillModalStudent(s) {
    const idField = document.getElementById("student-id");
    if (idField) idField.value = s.id || "";

    document.getElementById("student-status").value = s.status || "Ativo";
    document.getElementById("student-name").value = s.name || "";
    document.getElementById("student-dob").value = s.dob ? parseLocalDate(s.dob).toISOString().split("T")[0] : "";
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

async function viewStudent(id) {
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
    }
}

async function editStudent(id) {
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
    }
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

async function deleteStudent(id) {
    if (!confirm("Deseja realmente excluir este cadastro?")) return;
    try {
        await apiPost("Membros", "delete", id);
        renderApp();
    } catch (err) {
        alert("Erro ao excluir membro.");
    }
}

/* Gestão financeira */
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
    document.getElementById("tx-date").value = t.date ? parseLocalDate(t.date).toISOString().split("T")[0] : "";
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
    }
}

async function editTx(id) {
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
    }
}

function filterAndRenderFinance() {
    const monthVal = document.getElementById("fin-filter-month").value;
    const yearVal = document.getElementById("fin-filter-year").value;
    const exactDateVal = document.getElementById("fin-filter-date").value;

    const filtered = globalFinanceCache.filter((t) => {
        if (!t.date) return false;

        const txDate = parseLocalDate(t.date);
        const month = txDate.getMonth();
        const year = txDate.getFullYear();

        if (monthVal !== "" && month !== Number(monthVal)) {
            return false;
        }

        if (yearVal !== "" && year !== Number(yearVal)) {
            return false;
        }

        if (exactDateVal) {
            const formattedTxDate = txDate.toISOString().split("T")[0];
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

    finance.sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

    finance.forEach((t) => {
        const dt = t.date ? parseLocalDate(t.date) : null;
        const formattedDate = dt
            ? `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
            : "-";

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

async function deleteTx(id) {
    if (confirm("Deseja realmente excluir esta transação?")) {
        await apiPost("Financas", "delete", id);
        renderApp();
    }
}

/* Popular opções de ano dinamicamente */
function populateYearFilter(finance) {
    const yearSelect = document.getElementById("rep-filter-year");
    if (!yearSelect) return;

    const yearsSet = new Set();
    (finance || []).forEach((t) => {
        if (t.date) {
            const dt = parseLocalDate(t.date);
            if (!isNaN(dt.getFullYear())) {
                yearsSet.add(dt.getFullYear());
            }
        }
    });

    const currentYear = new Date().getFullYear();
    yearsSet.add(currentYear);

    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

    yearSelect.innerHTML = "";
    sortedYears.forEach((year) => {
        const option = document.createElement("option");
        option.value = year;
        option.textContent = year;
        if (year === currentYear) {
            option.selected = true;
        }
        yearSelect.appendChild(option);
    });
}

/* Relatório: Balancete resumo contábil */
function renderReports(finance) {
    /* Garante que o select tenha opções antes de ler seu valor */
    const yearSelect = document.getElementById("rep-filter-year");
    if (yearSelect && yearSelect.options.length === 0) {
        populateYearFilter(finance);
    }
    const yearSel = Number(document.getElementById("rep-filter-year").value) || new Date().getFullYear();
    const monthSel = document.getElementById("rep-filter-month").value;

    /* 1. PRIMEIRO: Filtra as transações pelo Ano e Mês selecionados */
    const txsFiltradas = finance.filter((t) => {
        if (!t.date) return false;
        const dt = parseLocalDate(t.date);
        if (dt.getFullYear() !== yearSel) return false;
        if (monthSel !== "all" && dt.getMonth() !== Number(monthSel)) return false;
        return true;
    });

    /* 2. SEGUNDO: Gera o balancete passando apenas 'txsFiltradas' (e não o 'finance' bruto) */
    const { accounts } = buildBalancetePostings(txsFiltradas, yearSel, monthSel);

    /* Renderizar tabela do balancete */
    const tbody = document.getElementById("tbody-balancete-contabil");
    const tfoot = document.getElementById("tfoot-balancete-contabil");
    if (tbody) tbody.innerHTML = "";

    let totSaldoAnt = 0;
    let totDev = 0;
    let totCred = 0;
    let totLiq = 0;
    let totSaldoAtual = 0;
    let qtdContas = 0;

    const sortedAccounts = Array.from(accounts.values()).sort((a, b) => a.codigo.localeCompare(b.codigo));

    sortedAccounts.forEach((item) => {
        const movLiq = item.devedor - item.credor;
        const saldoAtual = item.saldoAnterior + movLiq;

        totSaldoAnt += item.saldoAnterior;
        totDev += item.devedor;
        totCred += item.credor;
        totLiq += movLiq;
        totSaldoAtual += saldoAtual;
        qtdContas++;

        if (tbody) {
            tbody.innerHTML += `
          <tr>
            <td class="text-center fw-bold text-secondary">${item.codigo}</td>
            <td class="fw-semibold">${item.titulo}</td>
            <td class="text-end">${fmtCurr(item.saldoAnterior)} ${item.natureza}</td>
            <td class="text-end text-success">${fmtCurr(item.devedor)}</td>
            <td class="text-end text-danger">${fmtCurr(item.credor)}</td>
            <td class="text-end fw-bold ${movLiq >= 0 ? "text-success" : "text-danger"}">${fmtCurr(movLiq)}</td>
            <td class="text-end fw-bold">${fmtCurr(saldoAtual)} ${item.natureza}</td>
          </tr>
        `;
        }
    });

    if (tfoot) {
        tfoot.innerHTML = `
        <tr>
          <td colspan="2" class="text-start">TOTAL GERAL DO BALANCETE CONTÁBIL</td>
          <td>${fmtCurr(totSaldoAnt)}</td>
          <td class="text-success">${fmtCurr(totDev)}</td>
          <td class="text-danger">${fmtCurr(totCred)}</td>
          <td class="${totLiq >= 0 ? "text-success" : "text-danger"}">${fmtCurr(totLiq)}</td>
          <td>${fmtCurr(totSaldoAtual)}</td>
        </tr>
      `;
    }

    /* Atualiza cabeçalho com o exercício filtrado */
    const elExercicio = document.getElementById("rep-exercicio");
    const elMesRef = document.getElementById("rep-mes-referencia");
    const elQtdContas = document.getElementById("rep-qtd-contas");

    if (elExercicio) elExercicio.textContent = yearSel;
    if (elMesRef)
        elMesRef.textContent =
            monthSel === "all" ? "Todos os Meses" : (Number(monthSel) + 1).toString().padStart(2, "0");
    if (elQtdContas) elQtdContas.textContent = qtdContas;

    renderCategorySummaries(txsFiltradas);
}

function renderCategorySummaries(finance) {
    const tbodyIn = document.querySelector("#table-report-incomes tbody");
    const tbodyOut = document.querySelector("#table-report-expenses tbody");
    tbodyIn.innerHTML = "";
    tbodyOut.innerHTML = "";

    const incomeCategories = {};
    const expenseCategories = {};
    let totalInCount = 0,
        totalInAmount = 0;
    let totalOutCount = 0,
        totalOutAmount = 0;

    finance.forEach((t) => {
        const val = Number(t.amount) || 0;
        const catName = t.category || "Geral / Outros";

        if (t.type === "Entrada") {
            if (!incomeCategories[catName]) incomeCategories[catName] = { count: 0, amount: 0 };
            incomeCategories[catName].count++;
            incomeCategories[catName].amount += val;
            totalInCount++;
            totalInAmount += val;
        } else if (t.type === "Saída") {
            if (!expenseCategories[catName]) expenseCategories[catName] = { count: 0, amount: 0 };
            expenseCategories[catName].count++;
            expenseCategories[catName].amount += val;
            totalOutCount++;
            totalOutAmount += val;
        }
    });

    Object.keys(incomeCategories).forEach((cat) => {
        const item = incomeCategories[cat];
        tbodyIn.innerHTML += `<tr>
            <td><i class="bi bi-tag-fill me-2 text-success opacity-75"></i>${cat}</td>
            <td class="text-end">${item.count}</td>
            <td class="text-end fw-semibold text-success">${fmtCurr(item.amount)}</td>
        </tr>`;
    });

    Object.keys(expenseCategories).forEach((cat) => {
        const item = expenseCategories[cat];
        tbodyOut.innerHTML += `<tr>
            <td><i class="bi bi-tag-fill me-2 text-danger opacity-75"></i>${cat}</td>
            <td class="text-end">${item.count}</td>
            <td class="text-end fw-semibold text-danger">${fmtCurr(item.amount)}</td>
        </tr>`;
    });

    document.getElementById("rep-total-in-count").textContent = totalInCount;
    document.getElementById("rep-total-in-amount").textContent = fmtCurr(totalInAmount);
    document.getElementById("rep-total-out-count").textContent = totalOutCount;
    document.getElementById("rep-total-out-amount").textContent = fmtCurr(totalOutAmount);
}

/* Eventos dos filtros de relatório */
document.getElementById("rep-filter-year").addEventListener("change", () => renderReports(globalFinanceCache));
document.getElementById("rep-filter-month").addEventListener("change", () => renderReports(globalFinanceCache));
function printReportLandscape() {
    window.print();
}

/* Inicialização */
if (sessionStorage.getItem("giar_active_user")) {
    document.body.classList.remove("unauthenticated");
    renderApp();
}
