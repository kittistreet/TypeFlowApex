"use strict";

const MAX_CONSECUTIVE_INCORRECT = 2;
const state = {
  data: null,
  prompts: [],
  baseText: "",
  text: "",
  index: 0,
  uncorrectedErrors: 0,
  consecutiveIncorrect: 0,
  inputBlocked: false,
  inputChars: 0,
  correctChars: 0,
  incorrectChars: 0,
  startedAt: 0,
  elapsed: 0,
  timerId: null,
  running: false,
  mode: "time",
  amount: 30,
  caseMode: "default",
};
const el = Object.fromEntries(
  [
    "level-select",
    "set-select",
    "code-display",
    "status-message",
    "timer",
    "wpm",
    "accuracy",
    "results",
    "result-wpm",
    "result-accuracy",
    "result-time",
    "result-raw-wpm",
    "result-cpm",
    "restart-button",
    "try-again",
    "next-text",
  ].map((id) => [id.replaceAll("-", ""), document.getElementById(id)]),
);
const choices = document.querySelectorAll(".choice");
const savedSelection = {
  get(key) {
    try {
      return localStorage.getItem(`typeflow.${key}`);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`typeflow.${key}`, value);
    } catch {
      /* Private browsing can disable storage. */
    }
  },
};
state.caseMode =
  savedSelection.get("case") === "lowercase" ? "lowercase" : "default";

async function loadData() {
  try {
    // The primary endpoint is intentionally fixed so a deployed data_word/words.json is used.
    let response = await fetch("/data_word/words.json");
    if (!response.ok) {
      // Keeps this package usable with its supplied source file before it is renamed.
      response = await fetch("/data_word/typing_practice_data.json");
    }
    if (!response.ok)
      throw new Error(`Could not load practice data (${response.status}).`);
    const json = await response.json();
    if (!Array.isArray(json.categories))
      throw new Error("The practice data has no categories array.");
    state.data = json.categories.filter((category) =>
      Array.isArray(category.sets),
    );
    if (!state.data.length)
      throw new Error("No valid levels were found in the practice data.");
    populateLevels();
    restoreSelection();
    el.levelselect.disabled = false;
    el.setselect.disabled = false;
    restart();
  } catch (error) {
    el.statusmessage.textContent = `Unable to load code prompts. ${error.message}`;
    el.statusmessage.classList.add("error");
    el.timer.classList.add("hidden");
  }
}

function populateLevels() {
  el.levelselect.innerHTML =
    '<option value="all">All levels</option>' +
    state.data
      .map(
        (c) =>
          `<option value="${escapeHtml(c.level)}">${escapeHtml(c.title || c.level)}</option>`,
      )
      .join("");
  populateSets();
}
function populateSets() {
  const level = el.levelselect.value;
  const categories =
    level === "all" ? state.data : state.data.filter((c) => c.level === level);
  const sets = categories.flatMap((c) =>
    c.sets.map((s) => ({ ...s, level: c.level })),
  );
  el.setselect.innerHTML =
    '<option value="all">All sets</option>' +
    sets
      .map(
        (s) =>
          `<option value="${escapeHtml(`${s.level}:${s.set_id}`)}">${escapeHtml(`${s.level} · ${s.title || `Set ${s.set_id}`}`)}</option>`,
      )
      .join("");
}
function selectIfAvailable(select, value) {
  if (value && [...select.options].some((option) => option.value === value))
    select.value = value;
}
function restoreSelection() {
  selectIfAvailable(el.levelselect, savedSelection.get("level"));
  populateSets();
  selectIfAvailable(el.setselect, savedSelection.get("set"));
}
function getPrompts() {
  const level = el.levelselect.value,
    set = el.setselect.value;
  return state.data
    .filter((c) => level === "all" || c.level === level)
    .flatMap((c) =>
      c.sets
        .filter((s) => set === "all" || `${c.level}:${s.set_id}` === set)
        .flatMap((s) => (Array.isArray(s.sentences) ? s.sentences : [])),
    )
    .filter((sentence) => typeof sentence === "string" && sentence.trim());
}
function buildText() {
  state.prompts = shuffle(getPrompts());
  if (!state.prompts.length)
    throw new Error("No code sentences match this selection.");
  const count =
    state.mode === "sentences"
      ? state.amount
      : Math.max(8, state.prompts.length);
  return Array.from(
    { length: count },
    (_, i) => state.prompts[i % state.prompts.length],
  ).join("\n");
}
function formatText(text) {
  return state.caseMode === "lowercase" ? text.toLowerCase() : text;
}
function restart(useNewPrompt = true) {
  clearInterval(state.timerId);
  Object.assign(state, {
    index: 0,
    uncorrectedErrors: 0,
    consecutiveIncorrect: 0,
    inputBlocked: false,
    inputChars: 0,
    correctChars: 0,
    incorrectChars: 0,
    startedAt: 0,
    elapsed: 0,
    running: false,
    history: [],
  });
  try {
    if (useNewPrompt || !state.baseText) state.baseText = buildText();
    state.text = formatText(state.baseText);
  } catch (error) {
    el.statusmessage.textContent = error.message;
    el.statusmessage.classList.add("error");
    return;
  }
  el.statusmessage.textContent = "Start typing to begin";
  el.statusmessage.classList.remove("error");
  el.results.classList.add("hidden");
  document.querySelector(".test-panel").classList.remove("test-over");
  el.timer.classList.toggle("hidden", state.mode === "sentences");
  el.timer.textContent = state.mode === "time" ? state.amount : "";
  render();
  updateStats();
}
function render() {
  el.codedisplay.replaceChildren(
    ...Array.from(state.text, (char, i) => {
      const span = document.createElement("span");
      span.className = `char${char === " " ? " space" : ""}${i === state.index ? " current" : ""}`;
      if (i < state.index)
        span.classList.add(state.history?.[i] ? "correct" : "incorrect");
      span.textContent = char;
      return span;
    }),
  );
}
function start() {
  state.running = true;
  state.startedAt = performance.now();
  if (state.mode === "time") state.timerId = setInterval(tick, 100);
}
function tick() {
  state.elapsed = (performance.now() - state.startedAt) / 1000;
  const left = Math.max(0, state.amount - state.elapsed);
  el.timer.textContent = Math.ceil(left);
  updateStats();
  if (left <= 0) finish();
}
function handleKey(event) {
  if (event.key === "Tab" || event.key === "Escape") {
    event.preventDefault();
    restart();
    return;
  }
  if (event.key === "Backspace") {
    event.preventDefault();
    if (!state.text || state.index === 0) return;
    state.index--;
    if (state.history[state.index] === false) state.uncorrectedErrors--;
    delete state.history[state.index];
    state.consecutiveIncorrect = 0;
    for (let i = state.index - 1; state.history[i] === false; i--)
      state.consecutiveIncorrect++;
    if (state.inputBlocked) {
      state.inputBlocked = false;
      el.statusmessage.textContent = "Continue typing";
      el.statusmessage.classList.remove("error");
    }
    render();
    updateStats();
    return;
  }
  if (state.inputBlocked) return;
  if (
    !state.text ||
    state.index >= state.text.length ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.key.length !== 1
  )
    return;
  event.preventDefault();
  if (!state.running) start();
  const correct = event.key === state.text[state.index];
  state.history[state.index] = correct;
  state.inputChars++;
  if (correct) {
    state.correctChars++;
    state.consecutiveIncorrect = 0;
  } else {
    state.incorrectChars++;
    state.uncorrectedErrors++;
    state.consecutiveIncorrect++;
  }
  state.index++;
  render();
  updateStats();
  if (state.consecutiveIncorrect > MAX_CONSECUTIVE_INCORRECT) {
    state.inputBlocked = true;
    el.statusmessage.textContent =
      "Typing locked after 3 consecutive incorrect inputs. Use Backspace to correct or restart.";
    el.statusmessage.classList.add("error");
    return;
  }
  if (state.mode === "sentences" && state.index === state.text.length) finish();
}
function getMetrics(elapsed = state.elapsed) {
  const minutes = Math.max(elapsed / 60, 0.01);
  const rawWpm = state.inputChars / 5 / minutes;
  return {
    rawWpm: Math.round(rawWpm),
    netWpm: Math.max(0, Math.round(rawWpm - state.uncorrectedErrors / minutes)),
    accuracy: state.inputChars
      ? Math.round((state.correctChars / state.inputChars) * 100)
      : 100,
    rawCpm: Math.round(state.inputChars / minutes),
  };
}
function updateStats() {
  const elapsed = state.running
    ? (performance.now() - state.startedAt) / 1000
    : state.elapsed;
  const metrics = getMetrics(elapsed);
  el.wpm.textContent = metrics.netWpm;
  el.accuracy.textContent = metrics.accuracy;
}
function finish() {
  if (!state.running) return;
  clearInterval(state.timerId);
  state.elapsed =
    state.mode === "time"
      ? state.amount
      : (performance.now() - state.startedAt) / 1000;
  state.running = false;
  const metrics = getMetrics();
  el.resultwpm.textContent = metrics.netWpm;
  el.resultaccuracy.textContent = `${metrics.accuracy}%`;
  el.resulttime.textContent = `${state.elapsed.toFixed(1)}s`;
  el.resultrawwpm.textContent = metrics.rawWpm;
  el.resultcpm.textContent = metrics.rawCpm;
  document.querySelector(".test-panel").classList.add("test-over");
  el.results.classList.remove("hidden");
}
function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function renderAmountButtons() {
  const values =
    state.mode === "time"
      ? [
          [30, "30s"],
          [15, "15s"],
          [60, "60s"],
        ]
      : [
          [1, "1"],
          [3, "3"],
          [5, "5"],
        ];
  state.amount = values[0][0];
  document.getElementById("amount-control").innerHTML =
    "<span>amount</span>" +
    values
      .map(
        ([value, label], i) =>
          `<button class="choice${i === 0 ? " active" : ""}" data-value="${value}" type="button">${label}</button>`,
      )
      .join("");
}
function resetTestSession() {
  restart();
}
function handleAmountSelection(event) {
  const button = event.target.closest("[data-value]");
  if (!button || !event.currentTarget.contains(button)) return;
  event.preventDefault();
  document
    .querySelectorAll("#amount-control .choice")
    .forEach((item) => item.classList.toggle("active", item === button));
  state.amount = Number(button.dataset.value);
  resetTestSession();
}
function handleModeSelection(event) {
  event.preventDefault();
  const button = event.currentTarget;
  document
    .querySelectorAll("[data-mode]")
    .forEach((item) => item.classList.toggle("active", item === button));
  state.mode = button.dataset.mode;
  renderAmountButtons();
  resetTestSession();
}
el.levelselect.addEventListener("change", () => {
  savedSelection.set("level", el.levelselect.value);
  populateSets();
  savedSelection.set("set", el.setselect.value);
  restart();
});
el.setselect.addEventListener("change", () => {
  savedSelection.set("set", el.setselect.value);
  restart();
});
el.restartbutton.addEventListener("click", restart);
el.tryagain.addEventListener("click", () => restart(false));
el.nexttext.addEventListener("click", () => restart(true));
document.addEventListener("keydown", handleKey);
choices.forEach((button) => {
  if (button.dataset.mode)
    button.addEventListener("click", handleModeSelection);
});
document
  .getElementById("amount-control")
  .addEventListener("click", handleAmountSelection);
document.querySelectorAll("[data-case]").forEach((button) => {
  button.classList.toggle("active", button.dataset.case === state.caseMode);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    document
      .querySelectorAll("[data-case]")
      .forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.caseMode = button.dataset.case;
    savedSelection.set("case", state.caseMode);
    restart(false);
  });
});
renderAmountButtons();
loadData();
