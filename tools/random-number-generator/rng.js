/**
 * Inclusive random draws with rejection sampling.
 * Every integer in the scaled range is equally likely; values that would
 * bias a modulo reduction are discarded and drawn again.
 */

export const LIMITS = {
  minCount: 1,
  maxCount: 12,
  minDecimals: 0,
  maxDecimals: 4,
};

const BOUND_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

export function cryptoFill(bytes) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error("This browser has no cryptographic random source.");
  }
  cryptoObj.getRandomValues(bytes);
}

export function randomBelow(limit, fillRandom) {
  const span = typeof limit === "bigint" ? limit : BigInt(limit);
  if (span <= 0n) {
    throw new Error("Range must be positive.");
  }
  if (span === 1n) {
    return 0n;
  }

  const bits = span.toString(2).length;
  const byteLen = Math.ceil(bits / 8);
  const buf = new Uint8Array(byteLen);
  const space = 1n << BigInt(byteLen * 8);
  const maxAccept = space - (space % span);

  for (let attempt = 0; attempt < 10000; attempt += 1) {
    fillRandom(buf);
    let n = 0n;
    for (let i = 0; i < buf.length; i += 1) {
      n = (n << 8n) + BigInt(buf[i]);
    }
    if (n < maxAccept) {
      return n % span;
    }
  }
  throw new Error("Could not draw a random value.");
}

export function randomIntInclusive(min, max, fillRandom) {
  const offset = randomBelow(BigInt(max) - BigInt(min) + 1n, fillRandom);
  return Number(BigInt(min) + offset);
}

/**
 * Round a decimal string to an integer count of `decimals` places.
 * Half rounds away from zero. Returns a safe integer, or a reason code.
 */
export function toScaledInt(text, decimals) {
  const raw = String(text ?? "").trim();
  if (raw === "") {
    return { ok: false, reason: "empty" };
  }
  if (!BOUND_PATTERN.test(raw)) {
    return { ok: false, reason: "invalid" };
  }

  const neg = raw.startsWith("-");
  const body = raw.replace(/^[+-]/, "");
  let [whole, frac = ""] = body.split(".");
  if (whole === "") whole = "0";

  let wholeBig = BigInt(whole);
  if (frac.length > decimals) {
    const keep = frac.slice(0, decimals);
    const next = frac[decimals];
    let rounded = BigInt(keep === "" ? "0" : keep);
    if (next >= "5") rounded += 1n;
    const limit = 10n ** BigInt(decimals);
    if (rounded >= limit) {
      rounded -= limit;
      wholeBig += 1n;
    }
    frac = decimals === 0 ? "" : rounded.toString().padStart(decimals, "0");
  } else {
    frac = frac.padEnd(decimals, "0");
  }

  const digits = decimals === 0 ? wholeBig.toString() : `${wholeBig}${frac}`;
  const magnitude = BigInt(digits);
  const signed = neg ? -magnitude : magnitude;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (signed > max || signed < min) {
    return { ok: false, reason: "range" };
  }
  return { ok: true, value: Number(signed) };
}

function parseBound(text, decimals, name) {
  const parsed = toScaledInt(text, decimals);
  if (parsed.ok) return parsed;
  if (parsed.reason === "range") {
    return { ok: false, error: `That ${name} is too large to draw fairly.` };
  }
  return { ok: false, error: `Enter a ${name} as a plain number.` };
}

export function prepareDraw(input) {
  const decimals = Number(input.decimals);
  const count = Number(input.count);
  const unique = Boolean(input.unique);

  if (!Number.isInteger(decimals) || decimals < LIMITS.minDecimals || decimals > LIMITS.maxDecimals) {
    return { ok: false, error: "Decimal places must be from 0 to 4.", field: "decimals" };
  }
  if (!Number.isInteger(count) || count < LIMITS.minCount || count > LIMITS.maxCount) {
    return { ok: false, error: "Draw between 1 and 12 numbers.", field: "count" };
  }

  const minParsed = parseBound(input.min, decimals, "minimum");
  if (!minParsed.ok) return { ...minParsed, field: "min" };
  const maxParsed = parseBound(input.max, decimals, "maximum");
  if (!maxParsed.ok) return { ...maxParsed, field: "max" };

  if (minParsed.value > maxParsed.value) {
    return {
      ok: false,
      error: "Minimum must be less than or equal to maximum.",
      field: "min",
    };
  }

  const span = BigInt(maxParsed.value) - BigInt(minParsed.value) + 1n;
  if (unique && BigInt(count) > span) {
    return {
      ok: false,
      error: "That range does not contain enough unique values.",
      field: "count",
    };
  }

  return {
    ok: true,
    minScaled: minParsed.value,
    maxScaled: maxParsed.value,
    decimals,
    count,
    unique,
    span,
  };
}

export function drawValues(prepared, fillRandom = cryptoFill) {
  if (!prepared?.ok) {
    throw new Error("Draw is not prepared.");
  }
  const used = new Set();
  const values = [];
  for (let i = 0; i < prepared.count; i += 1) {
    let guard = 0;
    let value;
    do {
      value = randomIntInclusive(prepared.minScaled, prepared.maxScaled, fillRandom);
      guard += 1;
      if (guard > 100000) {
        throw new Error("Could not draw a unique value.");
      }
    } while (prepared.unique && used.has(value));
    used.add(value);
    values.push(value);
  }
  return {
    values,
    labels: values.map((value) => formatScaledBig(BigInt(value), prepared.decimals)),
  };
}

export function formatScaledBig(scaled, decimals) {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  if (decimals === 0) {
    return `${neg ? "-" : ""}${abs.toString()}`;
  }
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

export function summarize(values, decimals) {
  let total = 0n;
  for (const value of values) total += BigInt(value);
  const count = BigInt(values.length);
  const extra = 2n;
  const sign = total < 0n ? -1n : 1n;
  const abs = total < 0n ? -total : total;
  const scaled = abs * (10n ** extra);
  let quotient = scaled / count;
  const remainder = scaled % count;
  if (remainder * 2n >= count) quotient += 1n;
  return {
    sum: formatScaledBig(total, decimals),
    average: formatScaledBig(sign * quotient, decimals + Number(extra)),
  };
}

export function rangeCaption(prepared) {
  const low = formatScaledBig(BigInt(prepared.minScaled), prepared.decimals);
  const high = formatScaledBig(BigInt(prepared.maxScaled), prepared.decimals);
  const kind = prepared.decimals === 0
    ? "Whole numbers"
    : `Values to ${prepared.decimals} decimal place${prepared.decimals === 1 ? "" : "s"}`;
  const repeats = prepared.unique ? " No repeats." : "";
  return `${kind} from ${low} to ${high}, inclusive.${repeats}`;
}
