"use strict";

const state = { data: null, prompts: [], text: "", index: 0, mistakes: 0, typed: 0, startedAt: 0, elapsed: 0, timerId: null, running: false, mode: "time", amount: 30 };
const el = Object.fromEntries(["level-select", "set-select", "code-display", "status-message", "timer", "wpm", "accuracy", "results", "result-wpm", "result-accuracy", "result-time", "result-cpm", "restart-button", "try-again"].map(id => [id.replaceAll("-", ""), document.getElementById(id)]));
const choices = document.querySelectorAll(".choice");

async function loadData() {
  try {
    // The primary endpoint is intentionally fixed so a deployed data_word/words.json is used.
    let response = await fetch("/data_word/words.json");
    if (!response.ok) {
      // Keeps this package usable with its supplied source file before it is renamed.
      response = await fetch("/data_word/typing_practice_data.json");
    }
    if (!response.ok) throw new Error(`Could not load practice data (${response.status}).`);
    const json = await response.json();
    if (!Array.isArray(json.categories)) throw new Error("The practice data has no categories array.");
    state.data = json.categories.filter(category => Array.isArray(category.sets));
    if (!state.data.length) throw new Error("No valid levels were found in the practice data.");
    populateLevels();
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
  el.levelselect.innerHTML = '<option value="all">All levels</option>' + state.data.map(c => `<option value="${escapeHtml(c.level)}">${escapeHtml(c.title || c.level)}</option>`).join("");
  populateSets();
}
function populateSets() {
  const level = el.levelselect.value;
  const categories = level === "all" ? state.data : state.data.filter(c => c.level === level);
  const sets = categories.flatMap(c => c.sets.map(s => ({ ...s, level: c.level })));
  el.setselect.innerHTML = '<option value="all">All sets</option>' + sets.map(s => `<option value="${escapeHtml(`${s.level}:${s.set_id}`)}">${escapeHtml(`${s.level} · ${s.title || `Set ${s.set_id}`}`)}</option>`).join("");
}
function getPrompts() {
  const level = el.levelselect.value, set = el.setselect.value;
  return state.data
    .filter(c => level === "all" || c.level === level)
    .flatMap(c => c.sets.filter(s => set === "all" || `${c.level}:${s.set_id}` === set).flatMap(s => Array.isArray(s.sentences) ? s.sentences : []))
    .filter(sentence => typeof sentence === "string" && sentence.trim());
}
function buildText() {
  state.prompts = shuffle(getPrompts());
  if (!state.prompts.length) throw new Error("No code sentences match this selection.");
  const count = state.mode === "sentences" ? state.amount : Math.max(8, state.prompts.length);
  return Array.from({ length: count }, (_, i) => state.prompts[i % state.prompts.length]).join("\n");
}
function restart() {
  clearInterval(state.timerId);
  Object.assign(state, { index: 0, mistakes: 0, typed: 0, startedAt: 0, elapsed: 0, running: false });
  try { state.text = buildText(); } catch (error) { el.statusmessage.textContent = error.message; el.statusmessage.classList.add("error"); return; }
  el.statusmessage.textContent = "Start typing to begin";
  el.statusmessage.classList.remove("error"); el.results.classList.add("hidden"); document.querySelector(".test-panel").classList.remove("test-over");
  el.timer.classList.toggle("hidden", state.mode === "sentences"); el.timer.textContent = state.mode === "time" ? state.amount : "";
  render(); updateStats();
}
function render() {
  el.codedisplay.replaceChildren(...Array.from(state.text, (char, i) => {
    const span = document.createElement("span"); span.className = `char${char === " " ? " space" : ""}${i === state.index ? " current" : ""}`;
    if (i < state.index) span.classList.add(state.history?.[i] ? "correct" : "incorrect");
    span.textContent = char; return span;
  }));
}
function start() { state.running = true; state.startedAt = performance.now(); state.history = []; if (state.mode === "time") state.timerId = setInterval(tick, 100); }
function tick() { state.elapsed = (performance.now() - state.startedAt) / 1000; const left = Math.max(0, state.amount - state.elapsed); el.timer.textContent = Math.ceil(left); updateStats(); if (left <= 0) finish(); }
function handleKey(event) {
  if (event.key === "Tab" || event.key === "Escape") { event.preventDefault(); restart(); return; }
  if (!state.text || state.index >= state.text.length || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  event.preventDefault(); if (!state.running) start();
  const correct = event.key === state.text[state.index]; state.history[state.index] = correct; state.typed++; if (!correct) state.mistakes++;
  state.index++; render(); updateStats();
  if (state.mode === "sentences" && state.index === state.text.length) finish();
}
function updateStats() { const minutes = Math.max(state.elapsed || (state.running ? .01 : 0), .01) / 60; const wpm = Math.max(0, Math.round((state.typed - state.mistakes) / 5 / minutes)); const acc = state.typed ? Math.round(((state.typed - state.mistakes) / state.typed) * 100) : 100; el.wpm.textContent = wpm; el.accuracy.textContent = acc; }
function finish() { if (!state.running) return; clearInterval(state.timerId); state.elapsed = state.mode === "time" ? state.amount : (performance.now() - state.startedAt) / 1000; state.running = false; const minutes = Math.max(state.elapsed / 60, .01), correct = state.typed - state.mistakes, wpm = Math.max(0, Math.round(correct / 5 / minutes)), acc = state.typed ? Math.round(correct / state.typed * 100) : 0, cpm = Math.round(state.typed / minutes); el.resultwpm.textContent = wpm; el.resultaccuracy.textContent = `${acc}%`; el.resulttime.textContent = `${state.elapsed.toFixed(1)}s`; el.resultcpm.textContent = cpm; document.querySelector(".test-panel").classList.add("test-over"); el.results.classList.remove("hidden"); }
function shuffle(items) { return [...items].sort(() => Math.random() - .5); }
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

function renderAmountButtons() {
  const values = state.mode === "time" ? [[30, "30s"], [15, "15s"], [60, "60s"]] : [[1, "1"], [3, "3"], [5, "5"]];
  state.amount = values[0][0];
  document.getElementById("amount-control").innerHTML = '<span>amount</span>' + values.map(([value, label], i) => `<button class="choice${i === 0 ? " active" : ""}" data-value="${value}" type="button">${label}</button>`).join("");
  document.querySelectorAll("#amount-control .choice").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("#amount-control .choice").forEach(item => item.classList.remove("active"));
    button.classList.add("active"); state.amount = Number(button.dataset.value); restart();
  }));
}
el.levelselect.addEventListener("change", () => { populateSets(); restart(); }); el.setselect.addEventListener("change", restart); el.restartbutton.addEventListener("click", restart); el.tryagain.addEventListener("click", restart); document.addEventListener("keydown", handleKey);
choices.forEach(button => { if (button.dataset.mode) button.addEventListener("click", () => { document.querySelectorAll('[data-mode]').forEach(item => item.classList.remove("active")); button.classList.add("active"); state.mode = button.dataset.mode; renderAmountButtons(); restart(); }); });
renderAmountButtons();
loadData();
