const CATEGORIES = {
  expense: [
    ["식비", "🍚"], ["카페", "☕"], ["장보기", "🛒"], ["교통", "🚌"],
    ["주거", "🏠"], ["생활", "🧴"], ["건강", "💊"], ["여가", "🎬"], ["쇼핑", "🎁"], ["기타", "✨"]
  ],
  income: [["급여", "💰"], ["용돈", "💌"], ["이자", "🌱"], ["환급", "↩"], ["기타", "✨"]]
};
const COLORS = ["#6fa980", "#9bc9a8", "#c6d99c", "#9eb9db", "#c6a9db", "#e5bd82"];
const DEMO = {
  budget: { KRW: 2500000, USD: 500 },
  transactions: [
    { id: "t1", type: "expense", amount: 36800, currency: "KRW", date: today(-1), category: "장보기", payment: "신용카드", memo: "주말 장보기" },
    { id: "t2", type: "expense", amount: 12500, currency: "KRW", date: today(-2), category: "카페", payment: "체크카드", memo: "커피" },
    { id: "t3", type: "income", amount: 3200000, currency: "KRW", date: today(-5), category: "급여", payment: "계좌이체", memo: "6월 급여" },
    { id: "t4", type: "expense", amount: 67000, currency: "KRW", date: today(-6), category: "여가", payment: "신용카드", memo: "데이트" }
  ],
  accounts: [
    { id: "a1", name: "우리 생활비 통장", type: "입출금", balance: 4280000, currency: "KRW" },
    { id: "a2", name: "여행 저축", type: "저축", balance: 1850000, currency: "KRW" }
  ],
  recurring: [{ id: "r1", name: "관리비", amount: 185000, day: 25, currency: "KRW" }]
};

const state = {
  profile: migrateProfile(localStorage.getItem("uri-profile")),
  pendingProfile: null,
  remoteStatus: null,
  currency: localStorage.getItem("uri-currency") || "KRW",
  filter: "all",
  entryType: "expense",
  data: loadData()
};

function today(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}
function loadData() {
  return { budget: { KRW: 0, USD: 0 }, transactions: [], accounts: [], recurring: [] };
}
function migrateProfile(profile) {
  return profile === "나" ? "푸" : profile === "아내" ? "꿍" : profile;
}
async function persist() {
  if (!window.remoteStore?.configured) throw new Error("CLOUDFLARE_NOT_CONFIGURED");
  await window.remoteStore.saveSettings(state.data);
  render();
}
async function reloadRemoteData() {
  if (!window.remoteStore?.configured) return;
  state.data = await window.remoteStore.loadAll();
  state.data.transactions = state.data.transactions.filter(item => !item.owner || item.owner === state.profile);
  render();
}
function money(amount, currency = state.currency) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency", currency, maximumFractionDigits: currency === "KRW" ? 0 : 2
  }).format(amount || 0);
}
function currentMonth(item) { return item.date?.slice(0, 7) === today().slice(0, 7); }
function converted(item) {
  const value = Number(item.amount ?? item.balance ?? 0);
  if (item.currency === state.currency) return value;
  const rate = 1380;
  return state.currency === "KRW" ? value * rate : value / rate;
}
function categoryIcon(name, type = "expense") {
  return (CATEGORIES[type].find(([category]) => category === name) || ["", "✨"])[1];
}
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function render() {
  const month = state.data.transactions.filter(currentMonth);
  const expenses = month.filter(t => t.type === "expense").reduce((sum, t) => sum + converted(t), 0);
  const income = month.filter(t => t.type === "income").reduce((sum, t) => sum + converted(t), 0);
  const budget = state.data.budget[state.currency] || 0;
  const netWorth = state.data.accounts.reduce((sum, a) => sum + converted(a), 0);
  document.querySelector("#greeting").textContent = `${state.profile}님, 좋은 하루예요`;
  document.querySelector("#profileButton").textContent = state.profile;
  document.querySelector("#remainingBudget").textContent = money(budget - expenses);
  document.querySelector("#monthExpense").textContent = money(expenses);
  document.querySelector("#monthBudget").textContent = money(budget);
  document.querySelector("#monthIncome").textContent = money(income);
  document.querySelector("#netWorth").textContent = money(netWorth);
  document.querySelector("#budgetProgress").style.width = `${Math.min(100, budget ? expenses / budget * 100 : 0)}%`;
  document.querySelector("#currencyButton").textContent = `${state.currency} ▾`;
  document.querySelector("#budgetInput").value = budget || "";

  renderTransactions("#recentList", [...state.data.transactions].sort(byDate).slice(0, 4));
  let ledger = [...state.data.transactions].sort(byDate);
  if (state.filter !== "all") ledger = ledger.filter(t => t.type === state.filter);
  renderTransactions("#ledgerList", ledger);
  renderChart(month.filter(t => t.type === "expense"));
  renderMonthlyReview(month, expenses, budget);
  renderAccounts();
}
function byDate(a, b) { return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); }
function renderTransactions(selector, list) {
  const target = document.querySelector(selector);
  if (!list.length) {
    target.innerHTML = `<div class="empty">아직 기록이 없어요.<br>첫 내역을 남겨보세요.</div>`;
    return;
  }
  target.innerHTML = list.map(t => `
    <article class="transaction owned" data-id="${t.id}">
      <div class="category-icon">${categoryIcon(t.category, t.type)}</div>
      <div class="transaction-main"><b>${escapeHtml(t.memo || t.category)}</b><small>${t.date} · ${t.payment || "결제수단 없음"}</small></div>
      <div class="transaction-amount"><b class="${t.type}">${t.type === "income" ? "+" : "-"}${money(t.amount, t.currency)}</b><small>${t.category}</small></div>
    </article>`).join("");
  target.querySelectorAll(".transaction").forEach(node => node.addEventListener("click", () => openTransaction(node.dataset.id)));
}
function renderChart(expenses) {
  const totals = {};
  expenses.forEach(t => totals[t.category] = (totals[t.category] || 0) + converted(t));
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, amount]) => sum + amount, 0);
  let cursor = 0;
  const stops = sorted.slice(0, 6).map(([, amount], index) => {
    const start = cursor;
    cursor += total ? amount / total * 100 : 0;
    return `${COLORS[index]} ${start}% ${cursor}%`;
  });
  document.querySelector("#donutChart").style.background = stops.length ? `conic-gradient(${stops.join(",")})` : "#eee8e7";
  document.querySelector("#donutValue").textContent = sorted.length && total ? `${Math.round(sorted[0][1] / total * 100)}%` : "0%";
  document.querySelector("#chartTotal").textContent = money(total);
  document.querySelector("#chartLegend").innerHTML = sorted.slice(0, 6).map(([name, amount], index) =>
    `<div class="legend-item"><i style="background:${COLORS[index]}"></i><span>${name}</span><b>${money(amount)}</b></div>`
  ).join("") || `<div class="empty">이번 달 지출이 없어요.</div>`;
}
function renderMonthlyReview(month, expenses, budget) {
  const expenseItems = month.filter(t => t.type === "expense");
  const totals = {};
  expenseItems.forEach(item => totals[item.category] = (totals[item.category] || 0) + converted(item));
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const [topCategory = "아직 없음", topAmount = 0] = sorted[0] || [];
  const topShare = expenses ? Math.round(topAmount / expenses * 100) : 0;
  const budgetRate = budget ? Math.round(expenses / budget * 100) : 0;
  const previousKey = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7);
  const previousExpense = state.data.transactions
    .filter(item => item.type === "expense" && item.date?.startsWith(previousKey))
    .reduce((sum, item) => sum + converted(item), 0);
  const changeRate = previousExpense ? Math.round((expenses - previousExpense) / previousExpense * 100) : null;

  let grade = "좋음";
  if (budgetRate > 100) grade = "점검 필요";
  else if (budgetRate > 85 || topShare >= 45) grade = "주의";
  document.querySelector("#reviewGrade").textContent = grade;
  document.querySelector("#reviewSummary").textContent = expenseItems.length
    ? `이번 달에는 ${topCategory}에 가장 많이 썼어요. 전체 지출의 ${topShare}%인 ${money(topAmount)}입니다.`
    : "이번 달 지출 기록이 쌓이면 소비 습관을 자동으로 평가해드려요.";

  const checks = [];
  checks.push(budget
    ? budgetRate <= 80
      ? `예산의 ${budgetRate}%를 사용했어요. 현재 속도는 안정적이에요.`
      : budgetRate <= 100
        ? `예산의 ${budgetRate}%를 사용했어요. 남은 기간에는 꼭 필요한 소비인지 한 번 더 확인해보세요.`
        : `예산을 ${budgetRate - 100}% 초과했어요. 다음 달 ${topCategory} 예산을 따로 정해보세요.`
    : "월 예산을 설정하면 지출 속도까지 점검할 수 있어요.");
  checks.push(topShare >= 40
    ? `${topCategory} 비중이 ${topShare}%로 높아요. 반복 소비나 줄일 수 있는 항목이 있는지 확인해보세요.`
    : expenseItems.length ? `가장 큰 ${topCategory} 지출도 ${topShare}% 수준이라 소비가 비교적 고르게 분산됐어요.` : "카테고리별 평가를 기다리고 있어요.");
  checks.push(changeRate === null
    ? "전월 기록이 없어 비교는 다음 달부터 제공돼요."
    : changeRate <= 0 ? `전월보다 지출이 ${Math.abs(changeRate)}% 줄었어요.` : `전월보다 지출이 ${changeRate}% 늘었어요. 증가한 카테고리를 살펴보세요.`);
  document.querySelector("#reviewChecks").innerHTML = checks.map(text =>
    `<div class="review-check"><i>✓</i><span>${escapeHtml(text)}</span></div>`
  ).join("");
}
function renderAccounts() {
  document.querySelector("#accountList").innerHTML = state.data.accounts.map(a =>
    `<article class="account-card"><span>${escapeHtml(a.type)} · ${a.currency}</span><b>${escapeHtml(a.name)}</b><strong>${money(a.balance, a.currency)}</strong></article>`
  ).join("") || `<div class="empty">등록된 계좌가 없어요.</div>`;
  document.querySelector("#recurringList").innerHTML = state.data.recurring.map(r =>
    `<div class="simple-item"><span>매월 ${r.day}일 · ${escapeHtml(r.name)}</span><b>${money(r.amount, r.currency)}</b></div>`
  ).join("") || `<div class="empty">등록된 고정지출이 없어요.</div>`;
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function openTransaction(id) {
  const item = state.data.transactions.find(t => t.id === id);
  const dialog = document.querySelector("#transactionDialog");
  const editing = Boolean(item);
  const editable = true;
  state.entryType = item?.type || "expense";
  document.querySelector("#formTitle").textContent = editing ? "기록 자세히" : "새 기록";
  document.querySelector("#transactionId").value = item?.id || "";
  document.querySelector("#entryAmount").value = item?.amount || "";
  document.querySelector("#entryCurrency").value = item?.currency || state.currency;
  document.querySelector("#entryDate").value = item?.date || today();
  document.querySelector("#entryPayment").value = item?.payment || "신용카드";
  document.querySelector("#entryMemo").value = item?.memo || "";
  setEntryType(state.entryType, item?.category);
  document.querySelectorAll("#transactionForm input, #transactionForm select").forEach(el => el.disabled = false);
  document.querySelector("#saveTransaction").classList.remove("hidden");
  document.querySelector("#deleteTransaction").classList.toggle("hidden", !editing);
  const notice = document.querySelector("#ownerNotice");
  notice.classList.add("hidden");
  notice.textContent = "";
  document.querySelector("#receiptStatus").textContent = "사진은 이 기기에서 분석하며 저장 여부를 선택할 수 있어요.";
  document.querySelector("#keepReceiptRow").classList.add("hidden");
  document.querySelector("#viewReceipt").classList.toggle("hidden", !item?.receiptPath);
  dialog.showModal();
}
function setEntryType(type, selected) {
  state.entryType = type;
  document.querySelectorAll("#entryType button").forEach(b => b.classList.toggle("active", b.dataset.type === type));
  const select = document.querySelector("#entryCategory");
  select.innerHTML = CATEGORIES[type].map(([name]) => `<option>${name}</option>`).join("");
  if (selected && CATEGORIES[type].some(([name]) => name === selected)) select.value = selected;
}
function closeDialogs() { document.querySelectorAll("dialog[open]").forEach(d => d.close()); }

function setupEvents() {
  configureProfileGate().catch(showSetupError);
  document.querySelectorAll(".profile-choice").forEach(button => button.addEventListener("click", () => {
    openPersonalLogin(button.dataset.profile);
  }));
  document.querySelector("#personalForm").addEventListener("submit", submitPersonalLogin);
  document.querySelector("#backToProfiles").addEventListener("click", showProfiles);
  document.querySelector("#profileButton").addEventListener("click", () => {
    document.querySelector("#app").classList.add("hidden");
    showProfiles();
  });
  document.querySelectorAll(".bottom-nav button[data-view], [data-view-target]").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view || button.dataset.viewTarget)));
  document.querySelectorAll("[data-action=add], #addButton").forEach(button => button.addEventListener("click", () => openTransaction()));
  document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", closeDialogs));
  document.querySelectorAll("#entryType button").forEach(button => button.addEventListener("click", () => setEntryType(button.dataset.type)));
  document.querySelectorAll("#typeFilter button").forEach(button => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll("#typeFilter button").forEach(b => b.classList.toggle("active", b === button));
    render();
  }));
  document.querySelector("#currencyButton").addEventListener("click", () => {
    state.currency = state.currency === "KRW" ? "USD" : "KRW";
    localStorage.setItem("uri-currency", state.currency);
    render();
  });
  document.querySelector("#transactionForm").addEventListener("submit", saveTransaction);
  document.querySelector("#deleteTransaction").addEventListener("click", deleteTransaction);
  document.querySelector("#viewReceipt").addEventListener("click", viewReceipt);
  document.querySelector("#budgetForm").addEventListener("submit", async event => {
    event.preventDefault();
    state.data.budget[state.currency] = Number(document.querySelector("#budgetInput").value);
    try {
      await persist(); showToast("이번 달 예산을 저장했어요.");
    } catch (error) { showToast(friendlyError(error)); }
  });
  document.querySelector("#receiptInput").addEventListener("change", analyzeReceipt);
  document.querySelector("#addAccountButton").addEventListener("click", () => openSmallForm("account"));
  document.querySelector("#addRecurringButton").addEventListener("click", () => openSmallForm("recurring"));
  document.querySelector("#downloadCsv").addEventListener("click", downloadCsv);
  document.querySelector("#downloadMemo").addEventListener("click", downloadMemo);
}
async function configureProfileGate() {
  if (!window.remoteStore?.configured) {
    showSetupError(new Error("CLOUDFLARE_NOT_CONFIGURED"));
    return;
  }
  state.remoteStatus = await window.remoteStore.status();
  document.querySelector("#profileScreen").classList.remove("hidden");
}
function showSetupError(error) {
  document.querySelector("#profileScreen").classList.remove("hidden");
  document.querySelector("#profileHint").textContent = friendlyError(error);
}
function friendlyError(error) {
  if (error?.message === "CLOUDFLARE_NOT_CONFIGURED") return "Cloudflare D1 연결이 필요합니다.";
  return error?.message || "요청을 처리하지 못했습니다.";
}
function showProfiles() {
  document.querySelector("#personalScreen").classList.add("hidden");
  document.querySelector("#profileScreen").classList.remove("hidden");
  document.querySelector("#personalHint").textContent = "";
}
function openPersonalLogin(profile) {
  state.pendingProfile = profile;
  const hasPassword = Boolean(state.remoteStatus?.profiles?.[profile]);
  document.querySelector("#profileScreen").classList.add("hidden");
  document.querySelector("#personalScreen").classList.remove("hidden");
  document.querySelector("#personalTitle").textContent = hasPassword ? `${profile}님의 가계부` : `${profile}님의 개인 비밀번호 설정`;
  document.querySelector("#personalDescription").textContent = hasPassword
    ? "개인 비밀번호를 입력하면 내 가계부로 들어갈 수 있어요."
    : "처음 한 번만 사용할 개인 비밀번호를 설정해주세요.";
  document.querySelector("#personalConfirmRow").classList.toggle("hidden", hasPassword);
  document.querySelector("#personalPasswordConfirm").required = !hasPassword;
  document.querySelector("#personalSubmit").textContent = hasPassword ? "내 가계부 열기" : "비밀번호 설정하고 시작";
  document.querySelector("#personalForm").reset();
  document.querySelector("#personalHint").textContent = "";
}
async function submitPersonalLogin(event) {
  event.preventDefault();
  const profile = state.pendingProfile;
  const password = document.querySelector("#personalPassword").value;
  const hasPassword = Boolean(state.remoteStatus?.profiles?.[profile]);
  if (!hasPassword) {
    const confirmation = document.querySelector("#personalPasswordConfirm").value;
    if (password !== confirmation) {
      document.querySelector("#personalHint").textContent = "두 비밀번호가 서로 달라요.";
      return;
    }
  }
  try {
    await window.remoteStore.authenticateProfile(profile, password, !hasPassword);
    state.remoteStatus.profiles[profile] = true;
    state.profile = profile;
    localStorage.setItem("uri-profile", profile);
    document.querySelector("#personalScreen").classList.add("hidden");
    await startApp();
  } catch (error) {
    document.querySelector("#personalHint").textContent = friendlyError(error);
  }
}
async function startApp() {
  document.querySelector("#profileScreen").classList.add("hidden");
  document.querySelector("#app").classList.remove("hidden");
  try {
    await reloadRemoteData();
    window.remoteStore.subscribe(() => reloadRemoteData().catch(console.error));
  } catch (error) {
    showToast(friendlyError(error));
  }
}
function switchView(id) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".bottom-nav button[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === id));
  scrollTo({ top: 0, behavior: "smooth" });
}
async function saveTransaction(event) {
  event.preventDefault();
  const id = document.querySelector("#transactionId").value;
  const previous = state.data.transactions.find(t => t.id === id);
  const item = {
    id: id || null, type: state.entryType,
    amount: Number(document.querySelector("#entryAmount").value),
    currency: document.querySelector("#entryCurrency").value,
    date: document.querySelector("#entryDate").value,
    category: document.querySelector("#entryCategory").value,
    payment: document.querySelector("#entryPayment").value,
    memo: document.querySelector("#entryMemo").value.trim(),
    owner: state.profile
  };
  try {
    if (!window.remoteStore?.configured) throw new Error("CLOUDFLARE_NOT_CONFIGURED");
    item.receiptPath = previous?.receiptPath;
    const receiptFile = document.querySelector("#keepReceipt").checked
      ? document.querySelector("#receiptInput").files[0]
      : null;
    await window.remoteStore.saveEntry(item, receiptFile);
    await reloadRemoteData();
    closeDialogs(); showToast(previous ? "기록을 수정했어요." : "새 기록을 저장했어요.");
  } catch (error) { showToast(friendlyError(error)); }
}
async function deleteTransaction() {
  const id = document.querySelector("#transactionId").value;
  const item = state.data.transactions.find(t => t.id === id);
  if (!item || item.owner !== state.profile) return;
  try {
    if (!window.remoteStore?.configured) throw new Error("CLOUDFLARE_NOT_CONFIGURED");
    await window.remoteStore.deleteEntry(item);
    await reloadRemoteData();
    closeDialogs(); showToast("기록을 삭제했어요.");
  } catch (error) { showToast(friendlyError(error)); }
}
async function viewReceipt() {
  const id = document.querySelector("#transactionId").value;
  const item = state.data.transactions.find(transaction => transaction.id === id);
  if (!item?.receiptPath) return;
  try {
    const url = await window.remoteStore.getReceiptUrl(item.receiptPath);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) { showToast(friendlyError(error)); }
}
async function analyzeReceipt(event) {
  const file = event.target.files[0];
  if (!file) return;
  document.querySelector("#keepReceiptRow").classList.remove("hidden");
  const status = document.querySelector("#receiptStatus");
  if (!window.Tesseract) {
    status.textContent = "문자 인식 모듈을 불러오지 못했어요. 인터넷 연결을 확인해주세요.";
    return;
  }
  status.textContent = "영수증을 읽는 중이에요. 사진에 따라 10~30초 정도 걸릴 수 있어요.";
  try {
    const image = await prepareReceiptImage(file);
    const result = await window.Tesseract.recognize(image, "kor+eng", {
      logger(message) {
        if (message.status === "recognizing text") {
          status.textContent = `영수증 읽는 중 ${Math.round((message.progress || 0) * 100)}%`;
        }
      }
    });
    const text = result.data.text || "";
    const amount = extractReceiptAmount(text);
    const date = extractReceiptDate(text);
    const category = suggestReceiptCategory(`${file.name}\n${text}`);
    const applied = [];
    if (amount) {
      document.querySelector("#entryAmount").value = amount;
      applied.push(`금액 ${money(amount, document.querySelector("#entryCurrency").value)}`);
    }
    if (date) {
      document.querySelector("#entryDate").value = date;
      applied.push(`날짜 ${date}`);
    }
    if (category) {
      document.querySelector("#entryCategory").value = category;
      applied.push(`카테고리 ${category}`);
    }
    status.textContent = applied.length
      ? `${applied.join(" · ")}을(를) 입력했어요. 영수증 인식은 틀릴 수 있으니 저장 전에 확인해주세요.`
      : "글자를 충분히 읽지 못했어요. 영수증을 화면 가득, 밝고 반듯하게 다시 촬영해주세요.";
  } catch (error) {
    console.error(error);
    status.textContent = "영수증을 읽지 못했어요. 더 밝고 선명한 사진으로 다시 시도해주세요.";
  }
}
async function prepareReceiptImage(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 2000;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.filter = "grayscale(1) contrast(1.25)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch {
    return file;
  }
}
function extractReceiptAmount(text) {
  const normalized = text.replace(/[Oo]/g, "0");
  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const labels = /(총\s*액|합\s*계|결제\s*금액|받을\s*금액|승인\s*금액|청구\s*금액|카드\s*결제|total|amount)/i;
  const parseNumbers = line => [...line.matchAll(/(?:₩|\$)?\s*(\d{1,3}(?:[,\s]\d{3})+|\d{3,9})(?:\.\d{2})?/g)]
    .map(match => Number(match[1].replace(/[,\s]/g, "")))
    .filter(value => value >= 100 && value <= 100000000);
  for (const line of lines.filter(line => labels.test(line))) {
    const values = parseNumbers(line);
    if (values.length) return Math.max(...values);
  }
  for (let index = 0; index < lines.length; index++) {
    if (!labels.test(lines[index])) continue;
    const values = parseNumbers(lines[index + 1] || "");
    if (values.length) return Math.max(...values);
  }
  const all = lines.flatMap(parseNumbers).filter(value => {
    const yearLike = value >= 1900 && value <= 2100;
    return !yearLike;
  });
  return all.length ? Math.max(...all) : null;
}
function extractReceiptDate(text) {
  const match = text.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number(month) <= 12 && Number(day) <= 31 ? date : null;
}
function suggestReceiptCategory(text) {
  const rules = [
    ["스타벅스|커피|카페|cafe|coffee|투썸|메가커피", "카페"],
    ["마트|market|이마트|코스트코|홈플러스|롯데마트|식자재", "장보기"],
    ["약국|병원|의원|pharmacy|medical", "건강"],
    ["택시|주유|버스|지하철|철도|train|parking|주차", "교통"],
    ["식당|치킨|피자|restaurant|국밥|분식|김밥|배달|포차", "식비"],
    ["쇼핑|mall|store|백화점|의류|잡화", "쇼핑"],
    ["영화|극장|공연|노래방|여행|호텔", "여가"],
    ["관리비|전기|가스|수도|월세|통신", "주거"]
  ];
  const result = rules.find(([pattern]) => new RegExp(pattern, "i").test(text));
  return result?.[1] || null;
}
function openSmallForm(kind) {
  const account = kind === "account";
  document.querySelector("#smallTitle").textContent = account ? "계좌 추가" : "고정지출 추가";
  document.querySelector("#smallFields").innerHTML = account ? `
    <label>계좌 이름<input name="name" required placeholder="예: 여행 저축"></label>
    <label>종류<select name="type"><option>입출금</option><option>저축</option><option>현금</option><option>투자</option></select></label>
    <label>잔액<input name="amount" type="number" required min="0"></label>
    <label>통화<select name="currency"><option>KRW</option><option>USD</option></select></label>` : `
    <label>지출 이름<input name="name" required placeholder="예: 관리비"></label>
    <label>금액<input name="amount" type="number" required min="0"></label>
    <label>결제일<input name="day" type="number" required min="1" max="31"></label>
    <label>통화<select name="currency"><option>KRW</option><option>USD</option></select></label>`;
  const form = document.querySelector("#smallForm");
  form.dataset.kind = kind;
  document.querySelector("#smallDialog").showModal();
}
document.querySelector("#smallForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  if (event.currentTarget.dataset.kind === "account") {
    state.data.accounts.push({ id: crypto.randomUUID(), name: form.get("name"), type: form.get("type"), balance: Number(form.get("amount")), currency: form.get("currency") });
  } else {
    state.data.recurring.push({ id: crypto.randomUUID(), name: form.get("name"), amount: Number(form.get("amount")), day: Number(form.get("day")), currency: form.get("currency") });
  }
  try {
    await persist(); closeDialogs(); showToast("저장했어요.");
  } catch (error) { showToast(friendlyError(error)); }
});
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob(["\ufeff", content], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click(); URL.revokeObjectURL(url);
}
function downloadCsv() {
  const header = ["날짜", "구분", "금액", "통화", "카테고리", "결제수단", "메모"];
  const rows = state.data.transactions.sort(byDate).map(t => [t.date, t.type === "expense" ? "지출" : "수입", t.amount, t.currency, t.category, t.payment, t.memo]);
  download(`꿍푸씨_가계부_${today()}.csv`, [header, ...rows].map(row => row.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv;charset=utf-8");
}
function downloadMemo() {
  const lines = state.data.transactions.sort(byDate).map(t => `${t.date} | ${t.type === "expense" ? "지출" : "수입"} | ${money(t.amount, t.currency)} | ${t.category} | ${t.memo || "-"}`);
  download(`꿍푸씨_가계부_${today()}.txt`, `꿍푸씨의 가계부 요약 (${today()})\n\n${lines.join("\n")}`, "text/plain;charset=utf-8");
}

setupEvents();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js");
