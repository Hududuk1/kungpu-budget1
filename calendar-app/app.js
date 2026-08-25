const CONFIG = window.KUNGPU_CALENDAR_CONFIG || {};
const COLORS = {
  "데이트": "#86b995",
  "집안일": "#b8d9be",
  "병원": "#9eb9db",
  "가족": "#c6d99c",
  "기념일": "#e5bd82",
  "여행": "#c6a9db",
  "개인": "#f1a8b8",
  "기타": "#91a39a"
};
const PERSON_COLORS = {
  "꿍": "#e59ab0",
  "푸": "#86b995",
  "둘": "#9eb9db"
};
const state = {
  current: startOfMonth(new Date()),
  selected: dateKey(new Date()),
  writer: localStorage.getItem("kungpu-calendar-user") || "",
  filter: localStorage.getItem("kungpu-calendar-filter") || "all",
  events: [],
  memo: localStorage.getItem("kungpu-calendar-memo") || "",
  client: null,
  channel: null
};

function $(selector) { return document.querySelector(selector); }
function $all(selector) { return [...document.querySelectorAll(selector)]; }
function dateKey(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function todayKey() { return dateKey(new Date()); }
function formatMonth(date) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(date);
}
function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T00:00:00`));
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}
function visibleEvents() {
  return state.events
    .filter(event => state.filter === "all" || event.person === state.filter)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || (a.start_time || "").localeCompare(b.start_time || ""));
}
function eventsFor(date) { return visibleEvents().filter(event => event.starts_on === date); }
function timeText(event) {
  if (event.all_day) return "하루 종일";
  return [event.start_time, event.end_time].filter(Boolean).map(time => time.slice(0, 5)).join(" - ") || "시간 미정";
}
function personColor(event) {
  return PERSON_COLORS[event.person] || event.color || COLORS[event.category] || COLORS["기타"];
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function initStore() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabasePublishableKey || !window.supabase) {
    showToast("Supabase 연결 정보가 필요해요.");
    return;
  }
  state.client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey);
  const { data: { session } } = await state.client.auth.getSession();
  if (!session) {
    const { error } = await state.client.auth.signInAnonymously();
    if (error) throw error;
  }
  await loadAll();
  subscribe();
}

async function loadAll() {
  if (!state.client) return;
  const [{ data: events, error: eventError }, { data: memo, error: memoError }] = await Promise.all([
    state.client.from("calendar_events").select("*").eq("calendar_key", CONFIG.calendarKey).order("starts_on"),
    state.client.from("calendar_memos").select("*").eq("calendar_key", CONFIG.calendarKey).maybeSingle()
  ]);
  if (eventError) throw eventError;
  if (memoError) throw memoError;
  state.events = events || [];
  state.memo = memo?.content || state.memo || "";
  localStorage.setItem("kungpu-calendar-memo", state.memo);
  render();
}

function subscribe() {
  if (!state.client) return;
  if (state.channel) state.client.removeChannel(state.channel);
  state.channel = state.client.channel(`calendar-${CONFIG.calendarKey}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "calendar_events", filter: `calendar_key=eq.${CONFIG.calendarKey}` }, () => loadAll().catch(console.error))
    .on("postgres_changes", { event: "*", schema: "public", table: "calendar_memos", filter: `calendar_key=eq.${CONFIG.calendarKey}` }, () => loadAll().catch(console.error))
    .subscribe();
}

async function saveEvent(event) {
  const payload = {
    calendar_key: CONFIG.calendarKey,
    title: event.title,
    starts_on: event.starts_on,
    start_time: event.start_time || null,
    end_time: event.end_time || null,
    all_day: event.all_day,
    person: event.person,
    category: event.category,
    location: event.location || "",
    memo: event.memo || "",
    color: COLORS[event.category] || COLORS["기타"],
    updated_at: new Date().toISOString()
  };
  const query = event.id
    ? state.client.from("calendar_events").update(payload).eq("id", event.id).eq("calendar_key", CONFIG.calendarKey)
    : state.client.from("calendar_events").insert(payload);
  const { error } = await query;
  if (error) throw error;
}

async function deleteEvent(id) {
  const { error } = await state.client.from("calendar_events").delete().eq("id", id).eq("calendar_key", CONFIG.calendarKey);
  if (error) throw error;
}

async function saveSharedMemo() {
  const content = $("#sharedMemo").value.trim();
  state.memo = content;
  localStorage.setItem("kungpu-calendar-memo", content);
  if (!state.client) return;
  const { error } = await state.client.from("calendar_memos").upsert({
    calendar_key: CONFIG.calendarKey,
    content,
    updated_at: new Date().toISOString()
  }, { onConflict: "calendar_key" });
  if (error) throw error;
}

function render() {
  $("#monthTitle").textContent = `${state.writer} 일정으로 기록 중`;
  $("#calendarMonth").textContent = formatMonth(state.current);
  $("#selectedTitle").textContent = formatDate(state.selected);
  $("#sharedMemo").value = state.memo;
  $all("[data-writer]").forEach(button => button.classList.toggle("active", button.dataset.writer === state.writer));
  $all("[data-filter]").forEach(button => button.classList.toggle("active", button.dataset.filter === state.filter));
  renderToday();
  renderCalendar();
  renderDayList();
  renderUpcoming();
}

function renderToday() {
  const today = todayKey();
  const list = eventsFor(today);
  $("#todayLabel").textContent = formatDate(today);
  $("#todaySummary").textContent = list.length ? `오늘 ${list.length}개의 일정이 있어요` : "오늘은 여유로운 날이에요";
}

function renderCalendar() {
  const grid = $("#calendarGrid");
  const year = state.current.getFullYear();
  const month = state.current.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const days = [];
  for (let index = 0; index < 42; index++) {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const key = dateKey(day);
    const list = eventsFor(key).slice(0, 4);
    days.push(`
      <button class="day ${day.getMonth() !== month ? "outside" : ""} ${key === todayKey() ? "today" : ""} ${key === state.selected ? "selected" : ""}" type="button" data-date="${key}">
        <span class="day-number">${day.getDate()}</span>
        <span class="dots">${list.map(event => `<i class="dot" style="background:${personColor(event)}"></i>`).join("")}</span>
      </button>
    `);
  }
  grid.innerHTML = days.join("");
  $all(".day").forEach(button => button.addEventListener("click", () => {
    state.selected = button.dataset.date;
    render();
  }));
}

function renderDayList() {
  const list = eventsFor(state.selected);
  $("#dayList").innerHTML = list.length ? list.map(eventCard).join("") : `<div class="empty">이 날은 아직 일정이 없어요.<br>가볍게 하나 추가해볼까요?</div>`;
  bindEventCards("#dayList");
}

function renderUpcoming() {
  const today = todayKey();
  const list = visibleEvents().filter(event => event.starts_on >= today).slice(0, 30);
  $("#upcomingList").innerHTML = list.length ? list.map(eventCard).join("") : `<div class="empty">다가오는 일정이 없어요.</div>`;
  bindEventCards("#upcomingList");
}

function eventCard(event) {
  const detail = [
    formatDate(event.starts_on),
    timeText(event),
    event.location ? `장소 ${event.location}` : "",
    event.memo ? event.memo : ""
  ].filter(Boolean).join(" · ");
  return `
    <article class="event-card" data-id="${event.id}">
      <i class="event-bar" style="background:${personColor(event)}"></i>
      <div>
        <b>${escapeHtml(event.title)}</b>
        <small>${escapeHtml(event.category)} · ${escapeHtml(detail)}</small>
      </div>
      <span class="event-person" style="background:${personColor(event)}">${escapeHtml(event.person)}</span>
    </article>
  `;
}

function bindEventCards(selector) {
  $all(`${selector} .event-card`).forEach(card => card.addEventListener("click", () => {
    const event = state.events.find(item => item.id === card.dataset.id);
    if (event) openEvent(event);
  }));
}

function openEvent(event = null) {
  $("#formTitle").textContent = event ? "일정 수정" : "일정 추가";
  $("#eventId").value = event?.id || "";
  $("#eventTitle").value = event?.title || "";
  $("#eventDate").value = event?.starts_on || state.selected || todayKey();
  $("#eventPerson").value = event?.person || state.writer || "꿍";
  $("#eventCategory").value = event?.category || "데이트";
  $("#eventLocation").value = event?.location || "";
  $("#eventMemo").value = event?.memo || "";
  $("#eventAllDay").checked = event ? event.all_day : true;
  $("#eventStart").value = event?.start_time?.slice(0, 5) || "";
  $("#eventEnd").value = event?.end_time?.slice(0, 5) || "";
  $("#deleteEvent").classList.toggle("hidden", !event);
  toggleTimeFields();
  $("#eventDialog").showModal();
}

function toggleTimeFields() {
  $("#timeFields").classList.toggle("hidden", $("#eventAllDay").checked);
}

function downloadMemo() {
  const lines = visibleEvents().map(event => `${event.starts_on} | ${timeText(event)} | ${event.person} | ${event.category} | ${event.title}${event.location ? ` | ${event.location}` : ""}${event.memo ? ` | ${event.memo}` : ""}`);
  const blob = new Blob(["\ufeff", `꿍푸씨의 캘린더 (${todayKey()})\n\n${lines.join("\n")}`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: `꿍푸씨_캘린더_${todayKey()}.txt` });
  link.click();
  URL.revokeObjectURL(url);
}

function setupEvents() {
  $("#prevMonth").addEventListener("click", () => {
    state.current = new Date(state.current.getFullYear(), state.current.getMonth() - 1, 1);
    render();
  });
  $("#nextMonth").addEventListener("click", () => {
    state.current = new Date(state.current.getFullYear(), state.current.getMonth() + 1, 1);
    render();
  });
  $("#todayButton").addEventListener("click", () => {
    state.current = startOfMonth(new Date());
    state.selected = todayKey();
    render();
  });
  $all("#quickAdd, #floatingAdd, #addSelected").forEach(button => button.addEventListener("click", () => openEvent()));
  $all("[data-close]").forEach(button => button.addEventListener("click", () => $("#eventDialog").close()));
  $all("[data-writer]").forEach(button => button.addEventListener("click", () => {
    state.writer = button.dataset.writer;
    localStorage.setItem("kungpu-calendar-writer", state.writer);
    render();
  }));
  $all("[data-filter]").forEach(button => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    localStorage.setItem("kungpu-calendar-filter", state.filter);
    render();
  }));
  $all("[data-view]").forEach(button => button.addEventListener("click", () => {
    $all(".view").forEach(view => view.classList.toggle("active", view.id === button.dataset.view));
    $all(".bottom-nav button").forEach(nav => nav.classList.toggle("active", nav === button));
  }));
  $("#eventAllDay").addEventListener("change", toggleTimeFields);
  $("#eventForm").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      if (!state.client) throw new Error("Supabase 연결이 필요해요.");
      await saveEvent({
        id: $("#eventId").value || null,
        title: $("#eventTitle").value.trim(),
        starts_on: $("#eventDate").value,
        start_time: $("#eventAllDay").checked ? null : $("#eventStart").value,
        end_time: $("#eventAllDay").checked ? null : $("#eventEnd").value,
        all_day: $("#eventAllDay").checked,
        person: $("#eventPerson").value,
        category: $("#eventCategory").value,
        location: $("#eventLocation").value.trim(),
        memo: $("#eventMemo").value.trim()
      });
      $("#eventDialog").close();
      await loadAll();
      showToast("일정을 저장했어요.");
    } catch (error) {
      showToast(error.message || "저장하지 못했어요.");
    }
  });
  $("#deleteEvent").addEventListener("click", async () => {
    const id = $("#eventId").value;
    if (!id || !confirm("이 일정을 삭제할까요?")) return;
    try {
      await deleteEvent(id);
      $("#eventDialog").close();
      await loadAll();
      showToast("일정을 삭제했어요.");
    } catch (error) {
      showToast(error.message || "삭제하지 못했어요.");
    }
  });
  $("#saveMemo").addEventListener("click", async () => {
    try {
      await saveSharedMemo();
      showToast("메모를 저장했어요.");
    } catch (error) {
      showToast(error.message || "메모를 저장하지 못했어요.");
    }
  });
  $("#downloadMemo").addEventListener("click", downloadMemo);
  $all("[data-user-choice]").forEach(button => button.addEventListener("click", () => {
    state.writer = button.dataset.userChoice;
    localStorage.setItem("kungpu-calendar-user", state.writer);
    localStorage.setItem("kungpu-calendar-writer", state.writer);
    $("#welcomeDialog").close();
    render();
  }));
}

setupEvents();
render();
if (!state.writer) $("#welcomeDialog").showModal();
initStore().catch(error => showToast(error.message || "일정을 불러오지 못했어요."));
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js");
