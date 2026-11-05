import {
  LIMITS,
  drawValues,
  formatScaledBig,
  prepareDraw,
  rangeCaption,
  summarize,
} from "./rng.js";

const STORAGE_KEY = "draw.history.v1";

const PRESETS = {
  coin: { min: "0", max: "1", decimals: 0 },
  d6: { min: "1", max: "6", decimals: 0 },
  d20: { min: "1", max: "20", decimals: 0 },
  percent: { min: "1", max: "100", decimals: 0 },
};

const els = {
  ticket: document.querySelector("#ticket"),
  readout: document.querySelector("#readout"),
  live: document.querySelector("#readout-live"),
  index: document.querySelector("#draw-index"),
  note: document.querySelector("#range-note"),
  stats: document.querySelector("#stats"),
  copy: document.querySelector("#copy-button"),
  form: document.querySelector("#draw-form"),
  min: document.querySelector("#min"),
  max: document.querySelector("#max"),
  count: document.querySelector("#count-value"),
  decimals: document.querySelector("#decimals-value"),
  unique: document.querySelector("#unique"),
  error: document.querySelector("#form-error"),
  draw: document.querySelector("#draw-button"),
  history: document.querySelector("#history-list"),
  historyEmpty: document.querySelector("#history-empty"),
  clear: document.querySelector("#clear-history"),
  presets: [...document.querySelectorAll("[data-preset]")],
};

const state = {
  min: els.min.value,
  max: els.max.value,
  count: 1,
  decimals: 0,
  unique: false,
  preset: "percent",
  history: [],
  serial: 0,
  shown: null,
  drawing: false,
};

const stored = loadStore();
state.history = stored.entries;
state.serial = stored.serial;

els.min.addEventListener("input", () => {
  state.min = els.min.value;
  state.preset = matchingPreset();
  refresh();
});

els.max.addEventListener("input", () => {
  state.max = els.max.value;
  state.preset = matchingPreset();
  refresh();
});

els.unique.addEventListener("change", () => {
  state.unique = els.unique.checked;
  refresh();
});

document.querySelectorAll("[data-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.step;
    const dir = Number(button.dataset.dir);
    const limits = key === "count"
      ? [LIMITS.minCount, LIMITS.maxCount]
      : [LIMITS.minDecimals, LIMITS.maxDecimals];
    state[key] = clamp(state[key] + dir, limits[0], limits[1]);
    if (key === "decimals") state.preset = matchingPreset();
    refresh();
  });
});

els.presets.forEach((button) => {
  button.addEventListener("click", () => {
    const preset = PRESETS[button.dataset.preset];
    state.preset = button.dataset.preset;
    state.min = preset.min;
    state.max = preset.max;
    state.decimals = preset.decimals;
    els.min.value = preset.min;
    els.max.value = preset.max;
    refresh();
  });
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  draw();
});

els.copy.addEventListener("click", copyShown);
els.clear.addEventListener("click", () => {
  state.history = [];
  saveStore();
  renderHistory();
});

if (state.history.length > 0) {
  const latest = state.history[0];
  state.shown = {
    labels: latest.labels,
    values: latest.values,
    decimals: latest.decimals,
    coin: latest.coin,
    serial: latest.serial,
    caption: latest.caption,
  };
}

refresh();
renderShown(state.shown?.labels ?? ["—"], false);
renderHistory();

function refresh() {
  const prepared = currentDraw();
  els.count.textContent = String(state.count);
  els.decimals.textContent = String(state.decimals);
  for (const button of els.presets) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.preset));
  }
  document.querySelectorAll("[data-step]").forEach((button) => {
    const key = button.dataset.step;
    const limits = key === "count"
      ? [LIMITS.minCount, LIMITS.maxCount]
      : [LIMITS.minDecimals, LIMITS.maxDecimals];
    const dir = Number(button.dataset.dir);
    const atBound = dir < 0 ? state[key] <= limits[0] : state[key] >= limits[1];
    button.disabled = atBound;
  });

  if (prepared.ok) {
    setError("");
    els.draw.disabled = state.drawing;
  } else {
    setError(prepared.error);
    els.draw.disabled = true;
  }
  if (state.shown?.caption) els.note.textContent = state.shown.caption;
  else if (prepared.ok) els.note.textContent = caption(prepared);
  else els.note.textContent = "Set a minimum and a maximum.";
  renderStats(state.shown);
}

function currentDraw() {
  return prepareDraw({
    min: state.min,
    max: state.max,
    count: state.count,
    decimals: state.decimals,
    unique: state.unique,
  });
}

function caption(prepared) {
  if (isCoin(prepared)) return "Heads or tails, equally likely.";
  return rangeCaption(prepared);
}

function isCoin(prepared) {
  return state.preset === "coin"
    && prepared.ok
    && prepared.decimals === 0
    && prepared.minScaled === 0
    && prepared.maxScaled === 1;
}

async function draw() {
  if (state.drawing) return;
  const prepared = currentDraw();
  if (!prepared.ok) {
    setError(prepared.error);
    focusField(prepared.field);
    return;
  }

  state.drawing = true;
  els.draw.disabled = true;
  els.draw.textContent = "Drawing…";
  els.ticket.setAttribute("aria-busy", "true");

  try {
    const drawn = drawValues(prepared);
    const coin = isCoin(prepared);
    const labels = coin
      ? drawn.values.map((value) => (value === 0 ? "Heads" : "Tails"))
      : drawn.labels;
    state.serial += 1;
    const serial = state.serial;
    await animateLabels(labels);
    const drawnCaption = caption(prepared);
    state.shown = {
      labels,
      values: drawn.values,
      decimals: prepared.decimals,
      coin,
      serial,
      caption: drawnCaption,
    };
    state.history.unshift({
      labels,
      values: drawn.values,
      decimals: prepared.decimals,
      coin,
      note: historyNote(prepared, coin),
      caption: drawnCaption,
      serial,
    });
    state.history = state.history.slice(0, 20);
    saveStore();
    renderShown(labels, false);
    renderStats(state.shown);
    renderHistory();
    els.index.textContent = formatSerial(serial);
    els.live.textContent = announce(labels);
    els.copy.disabled = false;
    els.copy.textContent = "Copy";
  } catch (error) {
    setError(error instanceof Error ? error.message : "Could not draw.");
  } finally {
    state.drawing = false;
    els.ticket.removeAttribute("aria-busy");
    els.draw.textContent = "Draw";
    refresh();
  }
}

function animateLabels(labels) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    renderShown(labels, false);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const duration = labels.length > 6 ? 280 : 460;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const frame = labels.map((label) => scramble(label, t));
      renderShown(frame, t < 1);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function scramble(label, progress) {
  if (label === "Heads" || label === "Tails") {
    if (progress > 0.82) return label;
    return Math.random() < 0.5 ? "Heads" : "Tails";
  }
  return label.split("").map((char) => {
    if (char === "-" || char === "." || Math.random() < progress) return char;
    return String(Math.floor(Math.random() * 10));
  }).join("");
}

function renderShown(labels, rolling) {
  els.readout.replaceChildren();
  const words = labels.some((label) => /[A-Za-z]/.test(label));
  const longest = labels.reduce((max, label) => Math.max(max, label.length), 0);
  els.readout.classList.toggle("is-many", labels.length > 1);
  els.readout.classList.toggle("is-words", words);
  els.readout.classList.toggle("is-long", !words && labels.length === 1 && longest > 8);
  els.readout.classList.toggle("is-rolling", rolling);
  for (const label of labels) {
    const span = document.createElement("span");
    span.className = "value";
    span.textContent = label;
    els.readout.appendChild(span);
  }
}

function renderStats(shown) {
  if (!shown || shown.coin || shown.labels.length < 2) {
    els.stats.hidden = true;
    els.stats.textContent = "";
    return;
  }
  const { sum, average } = summarize(shown.values, shown.decimals);
  els.stats.hidden = false;
  els.stats.textContent = `Sum ${sum} · average ${average}`;
}

function renderHistory() {
  els.history.replaceChildren();
  for (const entry of state.history) {
    const item = document.createElement("li");
    const values = document.createElement("span");
    values.className = "history-values";
    values.textContent = entry.labels.join(" · ");
    const note = document.createElement("span");
    note.className = "history-note";
    note.textContent = `No. ${formatSerial(entry.serial).replace("No. ", "")} · ${entry.note}`;
    item.append(values, note);
    els.history.appendChild(item);
  }
  const empty = state.history.length === 0;
  els.historyEmpty.hidden = !empty;
  els.clear.hidden = empty;
  if (state.shown?.serial) els.index.textContent = formatSerial(state.shown.serial);
  els.copy.disabled = !state.shown;
}

function historyNote(prepared, coin) {
  if (coin) return "coin";
  const low = formatScaledBig(BigInt(prepared.minScaled), prepared.decimals);
  const high = formatScaledBig(BigInt(prepared.maxScaled), prepared.decimals);
  return `${low}–${high}`;
}

function announce(labels) {
  if (labels.length === 1) return `Drew ${labels[0]}.`;
  return `Drew ${labels.join(", ")}.`;
}

async function copyShown() {
  if (!state.shown) return;
  const text = state.shown.labels.join("\n");
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = legacyCopy(text);
  }
  els.copy.textContent = copied ? "Copied" : "Copy failed";
}

function legacyCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function setError(message) {
  els.error.hidden = message === "";
  els.error.textContent = message;
}

function focusField(field) {
  if (field === "min") els.min.focus();
  if (field === "max") els.max.focus();
}

function matchingPreset() {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (name === "coin") continue;
    if (state.min === preset.min && state.max === preset.max && state.decimals === preset.decimals) {
      return name;
    }
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatSerial(serial) {
  const text = String(serial);
  return `No. ${text.length < 3 ? text.padStart(3, "0") : text}`;
}

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw || !Array.isArray(raw.entries)) return { serial: 0, entries: [] };
    const entries = raw.entries.filter(isEntry).slice(0, 20);
    const serial = Number.isInteger(raw.serial) && raw.serial >= 0 ? raw.serial : entries.length;
    return { serial, entries };
  } catch {
    return { serial: 0, entries: [] };
  }
}

function isEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (!Array.isArray(entry.labels) || entry.labels.length < 1 || entry.labels.length > LIMITS.maxCount) return false;
  if (!entry.labels.every((label) => typeof label === "string" && label.length > 0 && label.length < 40)) return false;
  if (!Array.isArray(entry.values) || entry.values.length !== entry.labels.length) return false;
  if (!entry.values.every((value) => Number.isSafeInteger(value))) return false;
  if (!Number.isInteger(entry.decimals) || entry.decimals < 0 || entry.decimals > LIMITS.maxDecimals) return false;
  if (typeof entry.note !== "string" || entry.note.length > 80) return false;
  if (typeof entry.caption !== "string" || entry.caption.length > 160) return false;
  if (!Number.isInteger(entry.serial) || entry.serial < 1) return false;
  return typeof entry.coin === "boolean";
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      serial: state.serial,
      entries: state.history,
    }));
  } catch {
    // The list still works for this page view when storage is blocked.
  }
}
