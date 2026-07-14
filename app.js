const STORAGE_KEY = "setListCreator.v1";
const BACKUP_NAME = "set-list-creator-backup.json";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const presets = {
  wedding: { label: "Classic Wedding Build", curve: [4,5,5,6,6,7,7,8,6,7,8,8,9,9,8,10,9,10] },
  pub: { label: "Pub Rock Night", curve: [6,7,7,8,7,8,8,9,7,8,9,9,10,8,9,10] },
  corporate: { label: "Corporate Safe But Fun", curve: [4,5,5,6,6,7,7,7,6,7,8,8,8,9] },
  indie: { label: "Indie / Alternative Party", curve: [5,5,6,6,7,7,8,8,6,7,8,9,9,10] },
  piano: { label: "Piano Bar Singalong", curve: [3,4,5,5,6,6,7,7,7,8,8,9,9,10] },
  hot: { label: "High Energy From The Start", curve: [7,8,8,8,9,8,9,9,8,9,10,9,10] },
  slow: { label: "Slow Burn To Climax", curve: [3,4,4,5,5,6,6,7,7,8,8,9,9,10] },
  requests: { label: "Request-Friendly Flexible Set", curve: [5,6,6,5,7,6,8,7,6,8,8,9,8,10] }
};

const defaultState = () => ({
  songs: [],
  sets: [],
  selectedSongId: null,
  selectedSetIndex: 0,
  savedSets: [],
  history: {},
  undo: [],
  settings: {
    gigType: "Wedding",
    brief: "mixed ages, pop-rock, 90s/00s, build to a huge ending",
    setLength: "2x60",
    preset: "wedding",
    aiEndpoint: "",
    useAI: false,
    brandName: "Set List Creator",
    accentMode: "teal",
    lastImport: null
  },
  reasoning: "Generate a set list to see why the app chose the flow."
});

let state = loadState();
let dragged = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return mergeDeep(defaultState(), parsed);
  } catch (error) {
    console.warn("Could not load saved state", error);
    return defaultState();
  }
}

function mergeDeep(base, extra) {
  const out = structuredClone(base);
  Object.keys(extra || {}).forEach(key => {
    if (extra[key] && typeof extra[key] === "object" && !Array.isArray(extra[key]) && out[key]) {
      out[key] = { ...out[key], ...extra[key] };
    } else {
      out[key] = extra[key];
    }
  });
  return out;
}

function saveState(message = "Auto-saved locally") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  $("#statusText").textContent = message;
}

function pushUndo() {
  state.undo.push(JSON.stringify({ songs: state.songs, sets: state.sets, reasoning: state.reasoning }));
  if (state.undo.length > 20) state.undo.shift();
}

function toast(message) {
  const existing = $(".toast");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2200);
}

function slugify(value) {
  return String(value || "song")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `song-${crypto.randomUUID().slice(0, 8)}`;
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(x => String(x).trim()).filter(Boolean);
  return String(value || "")
    .split(/[;,]/)
    .map(x => x.trim())
    .filter(Boolean);
}

function secondsFromDuration(value) {
  if (!value && value !== 0) return 210;
  if (typeof value === "number") return value > 30 ? Math.round(value) : Math.round(value * 60);
  const str = String(value).trim();
  if (/^\d+:\d{1,2}$/.test(str)) {
    const [m, s] = str.split(":").map(Number);
    return (m * 60) + s;
  }
  const num = Number(str);
  return Number.isFinite(num) ? secondsFromDuration(num) : 210;
}

function formatDuration(seconds = 0) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatMinutes(seconds = 0) {
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function normalizeSong(input, index = 0) {
  const title = input.title || input.song || input.name || `Untitled ${index + 1}`;
  const artist = input.artist || input.by || input.performer || "";
  const year = Number(input.year || input.releaseYear || "") || "";
  const decade = input.decade || (year ? `${Math.floor(year / 10) * 10}s` : "");
  const id = input.id || input.songId || slugify(`${title}-${artist}`);
  const tags = parseList(input.tags || input.tag || input.mood);
  const genres = parseList(input.genres || input.genre);
  const energy = Number(input.energy || input.energyLevel || input.danceEnergy || 0) || inferEnergy({ title, artist, tags, genres });

  return {
    id,
    title: String(title).trim(),
    artist: String(artist).trim(),
    year,
    decade,

    genre: input.genre || "",
    genres,

    bpm: Number(input.bpm || input.BPM || input.tempo || input.Tempo || 0) || "",
    durationSec: secondsFromDuration(input.durationSec || input.duration || input.time || input.length),
    energy: clamp(Math.round(energy), 1, 10),

    tags,

    countryOfOrigin: input.countryOfOrigin || input.country || "",
    link: input.link || "",
    wiki: input.wiki || input.wikipedia || "",

    upbeat: toBool(input.upbeat),
    favourites: toBool(firstDefined(input.favourites, input.favorites)),
    dancefloor: toBool(input.dancefloor),
    singALong: toBool(firstDefined(input.singALong, input.singalong, input["sing-a-long"])),
    happy: toBool(input.happy),
    easyToSing: toBool(input.easyToSing),
    romantic: toBool(input.romantic),
    showcase: toBool(input.showcase),

    key: input.key || "",
    vocalRange: input.vocalRange || "",
    lineups: parseList(input.lineups || input.lineup || "solo, duo, band"),
    notes: input.notes || input.note || "",

    recognisability: rating(input.recognisability),
    pianoBarRating: rating(input.pianoBarRating),
    ukAudienceRating: rating(input.ukAudienceRating),
    singalongRating: rating(input.singalongRating),
    dancefloorRating: rating(input.dancefloorRating),
    obscurity: rating(input.obscurity),
    isInstrumental: toBool(input.isInstrumental),
    isSlowBackground: toBool(input.isSlowBackground),
    setRoles: parseList(input.setRoles || input.setRole),
    audienceTags: parseList(input.audienceTags || input.audienceTag),
    risk: String(input.risk || "").toLowerCase().trim(),
    aiTagConfidence: rating(input.aiTagConfidence),
    aiTagReason: input.aiTagReason || "",
    autoPick: input.autoPick === false || String(input.autoPick).toLowerCase() === "false" ? false : true
  };
}

function inferEnergy(song) {
  const text = `${song.title} ${song.artist} ${song.tags.join(" ")} ${song.genres.join(" ")}`.toLowerCase();
  let score = 5;
  if (/floor|peak|closer|anthem|dance|party|banger|rock/.test(text)) score += 3;
  if (/singalong|classic|wedding|pub/.test(text)) score += 1;
  if (/slow|ballad|acoustic|dinner|background|ceremony/.test(text)) score -= 2;
  return clamp(score, 1, 10);
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function rating(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? clamp(Math.round(n), 1, 10) : "";
}

function toBool(value) {
  if (value === true) return true;
  if (value === false) return false;

  const text = String(value || "").trim().toLowerCase();

  return [
    "true",
    "yes",
    "y",
    "1",
    "tick",
    "ticked"
  ].includes(text);
}

function firstDefined(...values) {
  return values.find(value =>
    value !== undefined &&
    value !== null &&
    value !== ""
  );
}
function getSong(id) { return state.songs.find(song => song.id === id); }
function getAllSetItems() { return state.sets.flatMap(set => set.items || []); }
function isUsed(id) { return getAllSetItems().some(item => item.id === id); }

function parseSetLength(value) {
  if (value === "custom") return { count: 2, minutes: 60 };
  const match = value.match(/(\d+)x(\d+)/);
  if (!match) return { count: 2, minutes: 60 };
  return { count: Number(match[1]), minutes: Number(match[2]) };
}

function getBriefTerms() {
  const brief = state.settings.brief.toLowerCase();
  const wants = [];
  const avoids = [];
  const terms = ["rock", "pop", "indie", "classic", "singalong", "90s", "00s", "80s", "70s", "60s", "dance", "acoustic", "wedding", "pub"];
  terms.forEach(term => { if (brief.includes(term)) wants.push(term); });
  const noMatches = brief.match(/(?:no|avoid|without)\s+([a-z0-9\s/-]{2,30})/g) || [];
  noMatches.forEach(match => avoids.push(match.replace(/^(no|avoid|without)\s+/, "").trim()));
  return { wants, avoids, brief };
}

function songText(song) {
  return `
    ${song.title}
    ${song.artist}
    ${song.decade}
    ${song.genre || ""}
    ${(song.genres || []).join(" ")}
    ${(song.tags || []).join(" ")}
    ${(song.setRoles || []).join(" ")}
    ${(song.audienceTags || []).join(" ")}
    ${song.countryOfOrigin || ""}
    ${song.notes || ""}
    ${song.aiTagReason || ""}
  `.toLowerCase();
}
function getBriefProfile() {
  const presetLabel = presets[state.settings.preset]?.label || "";
  const text = `${state.settings.gigType} ${state.settings.brief} ${presetLabel}`.toLowerCase();

  return {
    raw: text,
    pianoBar: /piano|piano bar|singing pianist|keys|keyboard|pub/.test(text),
    ukAudience: /\buk\b|british|britain|england|english|scotland|wales|welsh|ireland|irish|london|somerset|bristol|manchester|liverpool|audience/.test(text),
    wedding: /wedding|bride|groom|first dance|evening reception/.test(text),
    party: /party|dance|dancefloor|floor|banger|high energy|climax|huge ending/.test(text),
    singalong: /singalong|sing-a-long|sing along|audience|chorus|pub|piano bar/.test(text),
    background: /background|cocktail|dinner|reception drinks|chilled|ambient/.test(text),
    instrumental: /instrumental|piano instrumental|background piano/.test(text),
    obscure: /obscure|deep cut|niche|less obvious|unusual/.test(text),
    avoidCheese: /no cheese|avoid cheese|not cheesy|less cheesy/.test(text)
  };
}

function hasAutoTags(song) {
  return Boolean(
    song.recognisability ||
    song.pianoBarRating ||
    song.ukAudienceRating ||
    song.singalongRating ||
    song.dancefloorRating ||
    song.obscurity ||
    song.aiTagConfidence
  );
}

function candidateSuitabilityScore(song, targetEnergy = 6, previous = null, usedIds = new Set()) {
  const profile = getBriefProfile();
  const text = songText(song);

  let score = 0;

  if (song.autoPick === false && !profile.obscure) score -= 220;

  if (song.isInstrumental && !profile.instrumental) score -= 160;
  if (song.isSlowBackground && !profile.background) score -= 130;

  if (song.obscurity) score -= song.obscurity * 14;
  if (song.recognisability) score += song.recognisability * 9;

  if (profile.pianoBar) score += (song.pianoBarRating || 0) * 12;
  if (profile.ukAudience) score += (song.ukAudienceRating || 0) * 12;
  if (profile.singalong || profile.pianoBar) score += (song.singalongRating || 0) * 10;
  if (profile.party || profile.wedding) score += (song.dancefloorRating || 0) * 10;

  if (song.favourites) score += 16;
  if (song.singALong) score += profile.singalong || profile.pianoBar ? 26 : 10;
  if (song.dancefloor) score += profile.party || profile.wedding ? 26 : 8;
  if (song.easyToSing) score += profile.pianoBar ? 18 : 6;
  if (song.upbeat) score += profile.party ? 10 : 4;
  if (song.happy) score += profile.wedding || profile.party ? 8 : 3;
  if (song.showcase) score += profile.pianoBar ? 8 : 0;
  if (song.romantic && profile.party && !profile.wedding) score -= 8;

  if (profile.ukAudience && /uk|british|england|scotland|wales|ireland/i.test(song.countryOfOrigin || "")) {
    score += 8;
  }

  if (profile.pianoBar && /piano-bar|piano bar|pub|singalong|sing-along|anthem/.test(text)) score += 18;
  if (profile.ukAudience && /uk-audience|british|britpop|pub/.test(text)) score += 16;
  if (profile.party && /floor|dance|party|banger|peak|closer|anthem/.test(text)) score += 16;

  if (profile.avoidCheese && /cheese|novelty|line dance|line-dance/.test(text)) score -= 90;

  if (/instrumental/.test(text) && !profile.instrumental) score -= 80;
  if (/background|cocktail|dinner/.test(text) && !profile.background) score -= 50;

  if (song.risk === "high") score -= 45;
  if (song.risk === "medium") score -= 18;

  score -= Math.abs((song.energy || 5) - targetEnergy) * 6;

  if (previous) {
    if (previous.artist && song.artist && previous.artist.toLowerCase() === song.artist.toLowerCase()) score -= 35;
  }

  if (usedIds.has(song.id)) score -= 999;

  return score;
}

function buildCandidatePool({ count, minutes } = {}) {
  const taggedSongs = state.songs.filter(hasAutoTags).length;

  // If the library is barely tagged yet, do not over-filter.
  if (taggedSongs < 25) {
    return state.songs.slice(0, 500);
  }

  const targetSongCount =
    count && minutes
      ? Math.ceil((count * minutes * 60) / 210)
      : 40;

  const candidateLimit =
    Math.min(500, Math.max(180, targetSongCount * 5));

  const lockedIds = new Set(
    state.sets.flatMap(set =>
      (set.items || [])
        .filter(item => item.locked)
        .map(item => item.id)
    )
  );

  const scored = state.songs
    .map(song => ({
      song,
      score: candidateSuitabilityScore(song, 7, null, new Set())
    }))
    .sort((a, b) => b.score - a.score);

  const selected = scored
    .filter(item => item.score > -120 || lockedIds.has(item.song.id))
    .slice(0, candidateLimit)
    .map(item => item.song);

  // Always include locked songs.
  state.songs.forEach(song => {
    if (lockedIds.has(song.id) && !selected.some(existing => existing.id === song.id)) {
      selected.push(song);
    }
  });

  return selected.slice(0, 500);
}

function compactSongForAI(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    year: song.year,
    decade: song.decade,
    genre: song.genre,
    genres: song.genres,
    bpm: song.bpm,
    durationSec: song.durationSec,
    energy: song.energy,
    tags: song.tags,
    countryOfOrigin: song.countryOfOrigin,

    upbeat: song.upbeat,
    favourites: song.favourites,
    dancefloor: song.dancefloor,
    singALong: song.singALong,
    happy: song.happy,
    easyToSing: song.easyToSing,
    romantic: song.romantic,
    showcase: song.showcase,

    recognisability: song.recognisability,
    pianoBarRating: song.pianoBarRating,
    ukAudienceRating: song.ukAudienceRating,
    singalongRating: song.singalongRating,
    dancefloorRating: song.dancefloorRating,
    obscurity: song.obscurity,
    isInstrumental: song.isInstrumental,
    isSlowBackground: song.isSlowBackground,
    setRoles: song.setRoles,
    audienceTags: song.audienceTags,
    risk: song.risk,
    aiTagConfidence: song.aiTagConfidence,
    aiTagReason: song.aiTagReason,
    autoPick: song.autoPick,

    suitabilityScore: Math.round(candidateSuitabilityScore(song, 7, null, new Set()))
  };
}
function fitScore(song, targetEnergy, previous, usedIds) {
  const { wants, avoids, brief } = getBriefTerms();
  const text = songText(song);
    let score = 100;

  score += candidateSuitabilityScore(song, targetEnergy, previous, usedIds);

  score -= Math.abs((song.energy || 5) - targetEnergy) * 15;
  wants.forEach(term => { if (text.includes(term)) score += 12; });
  avoids.forEach(term => { if (term && text.includes(term)) score -= 80; });
  if (brief.includes("mixed ages") && /classic|singalong|anthem|wedding|floor/.test(text)) score += 10;
  if (brief.includes("no cheese") && /cheese|novelty|line dance/.test(text)) score -= 80;
  if (song.tags?.some(tag => /floor|banger|peak|closer|anthem/.test(tag.toLowerCase()))) score += targetEnergy >= 8 ? 16 : -10;
  if (song.tags?.some(tag => /opener|warm/.test(tag.toLowerCase()))) score += targetEnergy <= 6 ? 12 : -6;
  if (previous) {
    if (previous.artist && song.artist && previous.artist.toLowerCase() === song.artist.toLowerCase()) score -= 28;
    if (previous.bpm && song.bpm) score -= Math.min(20, Math.abs(previous.bpm - song.bpm) / 3);
    const sharedGenres = (song.genres || []).filter(g => (previous.genres || []).map(x => x.toLowerCase()).includes(g.toLowerCase())).length;
    score += sharedGenres * 5;
  }
  const hist = state.history[song.id];
  if (hist) score += (hist.killed || 0) * 8 + (hist.worked || 0) * 4 - (hist.died || 0) * 8;
  if (usedIds.has(song.id)) score -= 999;
  score += Math.random() * 10;
  return score;
}

function buildCurveForSet(setIndex, setCount, songsNeeded) {
  const preset = presets[state.settings.preset] || presets.wedding;
  const source = preset.curve;
  const start = Math.floor((source.length / setCount) * setIndex);
  const end = Math.floor((source.length / setCount) * (setIndex + 1));
  const slice = source.slice(start, end).length ? source.slice(start, end) : source;
  return Array.from({ length: songsNeeded }, (_, i) => {
    const pos = songsNeeded === 1 ? 0 : i / (songsNeeded - 1);
    const rawIndex = pos * (slice.length - 1);
    const low = Math.floor(rawIndex);
    const high = Math.ceil(rawIndex);
    const mix = rawIndex - low;
    return Math.round(slice[low] * (1 - mix) + slice[high] * mix);
  });
}

function pickSong(pool, targetEnergy, previous, usedIds) {
  return pool
    .map(song => ({ song, score: fitScore(song, targetEnergy, previous, usedIds) }))
    .sort((a, b) => b.score - a.score)[0]?.song || null;
}

function generateRuleBased({ setIndex = null, preserveLocks = true } = {}) {
  if (!state.songs.length) {
    toast("Import songs first, or load the sample library.");
    return false;
  }
  pushUndo();
  const { count, minutes } = parseSetLength(state.settings.setLength);
  const targetSec = minutes * 60;
  const setIndices = setIndex === null ? Array.from({ length: count }, (_, i) => i) : [setIndex];
  const existing = state.sets.length ? state.sets : Array.from({ length: count }, (_, i) => ({ name: `Set ${i + 1}`, targetSec, items: [] }));
  state.sets = Array.from({ length: count }, (_, i) => existing[i] || ({ name: `Set ${i + 1}`, targetSec, items: [] }));

  const usedIds = new Set();
  state.sets.forEach((set, idx) => {
    if (preserveLocks || !setIndices.includes(idx)) {
      set.items?.forEach(item => { if (item.locked) usedIds.add(item.id); });
    }
  });

  setIndices.forEach(idx => {
    const set = state.sets[idx];
    const lockedItems = preserveLocks ? (set.items || []).filter(item => item.locked && getSong(item.id)) : [];
    const lockedDuration = lockedItems.reduce((sum, item) => sum + (getSong(item.id)?.durationSec || 210), 0);
    const avgDuration = Math.round(state.songs.reduce((sum, song) => sum + (song.durationSec || 210), 0) / Math.max(1, state.songs.length));
    const slots = clamp(Math.round((targetSec - lockedDuration) / Math.max(150, avgDuration)), 3, 28);
    const curve = buildCurveForSet(idx, count, slots + lockedItems.length);
    const generated = [];
    let previous = null;
    for (let slot = 0; slot < slots; slot++) {
      const targetEnergy = curve[slot + lockedItems.length] || 6;
      const chosen = pickSong(state.songs, targetEnergy, previous, usedIds);
      if (!chosen) break;
      generated.push({ id: chosen.id, locked: false });
      usedIds.add(chosen.id);
      previous = chosen;
    }
    const merged = mergeLockedIntoGenerated(lockedItems, generated, curve);
    set.name = `Set ${idx + 1}`;
    set.targetSec = targetSec;
    set.items = trimToDuration(merged, targetSec);
  });

  state.selectedSetIndex = setIndex ?? 0;
  state.reasoning = createRuleReasoning();
  saveState("Generated with rule engine");
  render();
  toast("Set list generated");
  return true;
}

function mergeLockedIntoGenerated(lockedItems, generated, curve) {
  if (!lockedItems.length) return generated;
  const output = [...generated];
  lockedItems.forEach(item => {
    const song = getSong(item.id);
    const targetIndex = curve.findIndex(e => e >= (song?.energy || 5));
    output.splice(targetIndex >= 0 ? targetIndex : output.length, 0, item);
  });
  return output;
}

function trimToDuration(items, targetSec) {
  const output = [];
  let duration = 0;
  for (const item of items) {
    const song = getSong(item.id);
    if (!song) continue;
    if (duration + song.durationSec > targetSec + 150 && output.length > 5 && !item.locked) continue;
    output.push(item);
    duration += song.durationSec;
    if (duration >= targetSec - 90) break;
  }
  return output;
}

function createRuleReasoning() {
  const preset = presets[state.settings.preset]?.label || "selected preset";
  const brief = state.settings.brief || "the brief";
  return `Built using the ${preset} curve. The app matched songs against: “${brief}”, then balanced energy, genre continuity, BPM jumps, artist repetition and saved the strongest floor-fillers for the later peak.`;
}

async function generateWithAI({ setIndex = null } = {}) {
  if (!state.settings.useAI || !state.settings.aiEndpoint) return generateRuleBased({ setIndex });
  if (!state.songs.length) {
    toast("Import songs first, or load the sample library.");
    return false;
  }
  pushUndo();
  toast("Asking AI musical director…");

  const { count, minutes } = parseSetLength(state.settings.setLength);
  const candidatePool = buildCandidatePool({ count, minutes });

  $("#statusText").textContent = `AI choosing from ${candidatePool.length} best-matching songs…`;

  const compactSongs = candidatePool.map(compactSongForAI);

  const locked = state.sets.map((set, idx) => ({
    setIndex: idx,
    songs: (set.items || []).map((item, position) => ({ ...item, position })).filter(item => item.locked)
  }));

  try {
    const response = await fetch(state.settings.aiEndpoint.replace(/\/$/, "") + "/generate-set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gigType: state.settings.gigType,
        brief: state.settings.brief,
        preset: presets[state.settings.preset]?.label || state.settings.preset,
        setCount: count,
        setMinutes: minutes,
        regenerateSetIndex: setIndex,
        locked,
        songs: compactSongs
      })
    });
    if (!response.ok) throw new Error(`AI proxy returned ${response.status}`);
    const data = await response.json();
    applyAISetList(data, count, minutes);
    state.reasoning = data.reasoning || "AI generated this set list using the gig brief, energy curve, BPM flow and floor-filler placement.";
    saveState("Generated with AI proxy");
    render();
    toast("AI set list generated");
    return true;
  } catch (error) {
    console.error(error);
    toast("AI unavailable — used rule engine instead");
    return generateRuleBased({ setIndex });
  }
}

function applyAISetList(data, count, minutes) {
  const targetSec = minutes * 60;
  const minSec = targetSec - 60;     // e.g. 44:00 minimum for a 45 min set
  const maxSec = targetSec + 180;    // e.g. 48:00 maximum for a 45 min set
  const aiSets = Array.isArray(data.sets) ? data.sets : [];
  const usedIds = new Set();

  state.sets = Array.from({ length: count }, (_, idx) => {
    const aiSet = aiSets[idx] || { name: `Set ${idx + 1}`, songs: [] };
    const rawSongs = Array.isArray(aiSet.songs) ? aiSet.songs : [];
    const items = [];

    rawSongs.forEach(item => {
      const id = typeof item === "string" ? item : item.id;
      if (!id || !getSong(id) || usedIds.has(id)) return;

      items.push({ id, locked: false });
      usedIds.add(id);
    });

    return {
      name: aiSet.name || `Set ${idx + 1}`,
      targetSec,
      items: repairSetDuration(items, idx, count, targetSec, minSec, maxSec, usedIds)
    };
  });
}

function setItemsDuration(items) {
  return items.reduce((sum, item) => {
    const song = getSong(item.id);
    return sum + (song?.durationSec || 210);
  }, 0);
}

function repairSetDuration(items, setIndex, setCount, targetSec, minSec, maxSec, usedIds) {
  const repaired = [...items].filter(item => getSong(item.id));
  let guard = 0;

  // If the AI under-fills the set, top it up with musically sensible songs.
  while (setItemsDuration(repaired) < minSec && guard < 50) {
    const currentDuration = setItemsDuration(repaired);
    const remaining = targetSec - currentDuration;
    const curve = buildCurveForSet(setIndex, setCount, Math.max(8, repaired.length + 3));
    const targetEnergy = curve[Math.min(repaired.length, curve.length - 1)] || 7;
    const previous = getSong(repaired[repaired.length - 1]?.id);

    const candidates = state.songs
      .filter(song => !usedIds.has(song.id))
      .map(song => {
        const duration = song.durationSec || 210;
        const wouldTotal = currentDuration + duration;
        const durationScore = -Math.abs(remaining - duration) / 8;
        const overMaxPenalty = wouldTotal > maxSec ? -120 : 0;

        return {
          song,
          score: fitScore(song, targetEnergy, previous, usedIds) + durationScore + overMaxPenalty
        };
      })
      .sort((a, b) => b.score - a.score);

    const choice = candidates[0];
    if (!choice) break;

    repaired.push({ id: choice.song.id, locked: false });
    usedIds.add(choice.song.id);
    guard++;
  }

  // If it goes too long, trim weaker non-locked songs while keeping endings intact.
  while (setItemsDuration(repaired) > maxSec && repaired.some(item => !item.locked) && guard < 100) {
    const removable = repaired
      .map((item, index) => ({ item, index, song: getSong(item.id) }))
      .filter(x => !x.item.locked)
      .sort((a, b) => {
        const aPenalty =
          (a.index === repaired.length - 1 ? 40 : 0) +
          ((a.song?.energy || 5) >= 8 ? 25 : 0) +
          ((a.song?.tags || []).some(tag => /closer|peak|floor|anthem/i.test(tag)) ? 20 : 0);

        const bPenalty =
          (b.index === repaired.length - 1 ? 40 : 0) +
          ((b.song?.energy || 5) >= 8 ? 25 : 0) +
          ((b.song?.tags || []).some(tag => /closer|peak|floor|anthem/i.test(tag)) ? 20 : 0);

        return aPenalty - bPenalty;
      })[0];

    if (!removable) break;

    usedIds.delete(removable.item.id);
    repaired.splice(removable.index, 1);
    guard++;
  }

  return repaired;
}
function analyseFlow() {
  const songs = state.sets.flatMap(set => set.items.map(item => getSong(item.id)).filter(Boolean));
  if (!songs.length) {
    return { score: 0, lines: [], series: [], avgEnergy: 0 };
  }
  const energies = songs.map(song => song.energy || 5);
  const bpmJumps = songs.slice(1).map((song, i) => Math.abs((song.bpm || songs[i].bpm || 110) - (songs[i].bpm || song.bpm || 110)));
  const bigDrops = energies.slice(1).filter((energy, i) => energy < energies[i] - 3).length;
  const genreBreaks = songs.slice(1).filter((song, i) => {
    const prev = songs[i];
    const shared = (song.genres || []).some(g => (prev.genres || []).map(x => x.toLowerCase()).includes(g.toLowerCase()));
    return !shared;
  }).length;
  const lastThird = energies.slice(Math.floor(energies.length * 0.66));
  const maxEnergy = Math.max(...energies);
  const peakLate = lastThird.includes(maxEnergy);

  const energyScore = clamp(100 - bigDrops * 12 + (peakLate ? 6 : -12), 0, 100);
  const bpmScore = clamp(100 - average(bpmJumps) * 0.65, 0, 100);
  const genreScore = clamp(100 - genreBreaks * 4, 0, 100);
  const peakScore = peakLate ? 95 : 62;
  const score = Math.round(average([energyScore, bpmScore, genreScore, peakScore]));
  return {
    score,
    series: energies,
    avgEnergy: average(energies),
    lines: [
      ["Energy Curve", labelFor(energyScore, "Strong", "Okay", "Jumpy"), classFor(energyScore)],
      ["Genre Flow", labelFor(genreScore, "Good", "Mixed", "Patchy"), classFor(genreScore)],
      ["BPM Transitions", labelFor(bpmScore, "Smooth", "Slightly jumpy", "Too jumpy"), classFor(bpmScore)],
      ["Peak Placement", peakLate ? "Excellent" : "Too early", peakLate ? "good" : "warn"]
    ]
  };
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function labelFor(score, good, warn, hot) {
  if (score >= 80) return good;
  if (score >= 60) return warn;
  return hot;
}
function classFor(score) {
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "hot";
}

function render() {
  document.body.dataset.accent = state.settings.accentMode;
  $(".brand h1").textContent = state.settings.brandName || "Set List Creator";
  renderControls();
  renderMetrics();
  renderSets();
  renderChart();
  renderSwaps();
  renderLibrary();
  renderSavedSets();
  renderStats();
  $("#reasoningText").textContent = state.reasoning;
}

function renderControls() {
  $("#gigType").value = state.settings.gigType;
  $("#brief").value = state.settings.brief;
  $("#setLength").value = state.settings.setLength;
  $("#preset").value = state.settings.preset;
  $("#aiEndpoint").value = state.settings.aiEndpoint;
  $("#useAI").checked = Boolean(state.settings.useAI);
  $("#brandName").value = state.settings.brandName;
  $("#accentMode").value = state.settings.accentMode;
}

function renderMetrics() {
  $("#songCount").textContent = state.songs.length.toLocaleString();
  $("#bpmCount").textContent = state.songs.filter(song => song.bpm).length.toLocaleString();
  $("#energyCount").textContent = state.songs.filter(song => song.energy).length.toLocaleString();
  $("#floorCount").textContent = state.songs.filter(song => song.tags?.some(tag => /floor|peak|closer|banger|anthem/i.test(tag))).length.toLocaleString();
  $("#lastImportText").textContent = state.settings.lastImport ? `Last import: ${state.settings.lastImport}` : "No library imported yet.";
  const analysis = analyseFlow();
  $("#flowScore").textContent = `${analysis.score}%`;
  $("#scoreLines").innerHTML = analysis.lines.map(([name, value, cls]) => `<div class="score-line"><span>${name}</span><strong class="${cls}">${value}</strong></div>`).join("") || `<div class="muted">No set generated yet.</div>`;
}

function renderSets() {
  const container = $("#setsContainer");
  if (!state.sets.length) {
    container.innerHTML = `<section class="panel set-card"><div class="set-head"><h3>No Set Yet</h3><span>0:00</span></div><div class="set-foot"><p class="muted">Import your song JSON or load the sample library, then hit Generate Set List.</p></div></section>`;
    return;
  }
  container.style.gridTemplateColumns = state.sets.length === 1 ? "1fr" : "repeat(2, minmax(310px, 1fr))";
  container.innerHTML = state.sets.map((set, setIndex) => {
    const total = set.items.reduce((sum, item) => sum + (getSong(item.id)?.durationSec || 0), 0);
    const avgEnergy = Math.round(average(set.items.map(item => getSong(item.id)?.energy || 0).filter(Boolean)) || 0);
    return `<section class="panel set-card" data-set-index="${setIndex}">
      <div class="set-head"><h3>${escapeHtml(set.name)}</h3><span>${formatMinutes(total)}</span></div>
      <ol class="song-list">
        ${set.items.map((item, songIndex) => renderSetSong(item, setIndex, songIndex)).join("")}
      </ol>
      <div class="set-foot">
        <div class="set-summary"><span>Total Duration: ${formatMinutes(total)}</span><span>Avg Energy: <strong>${avgEnergy}</strong></span></div>
        <button class="add-song-row" data-action="add-to-set" data-set="${setIndex}">+ Add Song</button>
      </div>
    </section>`;
  }).join("");
}

function renderSetSong(item, setIndex, songIndex) {
  const song = getSong(item.id);
  if (!song) return "";
  const selected = state.selectedSongId === song.id ? "selected" : "";
  const energyColour = energyColor(song.energy);
  return `<li class="set-song ${selected}" draggable="true" data-song-id="${song.id}" data-set="${setIndex}" data-index="${songIndex}">
    <div class="drag">⋮⋮</div>
    <div class="song-main"><strong>${songIndex + 1}. ${escapeHtml(song.title)}</strong><span>${escapeHtml(song.artist || "Unknown artist")}</span></div>
    <div class="song-meta"><span>${formatDuration(song.durationSec)}</span><br><span class="energy-pill" style="color:${energyColour}">${song.energy}</span><span class="energy-bar"><i style="width:${song.energy * 10}%; background:${energyColour}"></i></span></div>
    <button class="lock-btn" title="Lock this song" data-action="toggle-lock" data-set="${setIndex}" data-index="${songIndex}">${item.locked ? "🔒" : "☐"}</button>
  </li>`;
}

function energyColor(energy) {
  if (energy <= 4) return "#36cf7c";
  if (energy <= 6) return "#c7db37";
  if (energy <= 8) return "#f2a905";
  return "#ff5656";
}

function renderChart() {
  const canvas = $("#energyCanvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = 18 + (h - 38) * (i / 4);
    ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(w - 10, y); ctx.stroke();
  }
  const songs = state.sets.flatMap(set => set.items.map(item => getSong(item.id)).filter(Boolean));
  if (!songs.length) {
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "15px sans-serif";
    ctx.fillText("Generate a set to see the energy curve", 45, 105);
    return;
  }
  const points = songs.map((song, i) => ({
    x: 34 + (w - 52) * (i / Math.max(1, songs.length - 1)),
    y: 18 + (h - 42) * (1 - (song.energy || 5) / 10),
    energy: song.energy || 5
  }));
  const gradient = ctx.createLinearGradient(34, 0, w - 10, 0);
  gradient.addColorStop(0, "#36cf7c");
  gradient.addColorStop(0.45, "#f2d43d");
  gradient.addColorStop(0.72, "#ff8c2a");
  gradient.addColorStop(1, "#ff5656");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 4;
  ctx.beginPath();
  points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke();
  ctx.lineTo(points.at(-1).x, h - 22);
  ctx.lineTo(points[0].x, h - 22);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 20, 0, h - 20);
  fill.addColorStop(0, "rgba(31, 182, 184, 0.24)");
  fill.addColorStop(1, "rgba(31, 182, 184, 0.02)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "12px sans-serif";
  ctx.fillText("Start", 34, h - 6);
  ctx.fillText("End", w - 34, h - 6);
}

function renderSwaps() {
  const selected = getSong(state.selectedSongId);
  const box = $("#swapList");
  if (!selected) {
    box.className = "swap-list muted";
    box.textContent = "Select a song to see safer, higher energy and singalong alternatives.";
    return;
  }
  box.className = "swap-list";
  const alternatives = getEmergencySwaps(selected).slice(0, 4);
  if (!alternatives.length) {
    box.innerHTML = `<div class="muted">No good swaps found yet. Add more tags and energy ratings.</div>`;
    return;
  }
  box.innerHTML = alternatives.map(({ song, reason }) => `<div class="swap-item">
    <strong>${escapeHtml(song.title)}</strong>
    <small>${escapeHtml(song.artist || "Unknown artist")} · Energy ${song.energy} · ${reason}</small>
    <button data-action="swap-selected" data-song-id="${song.id}">Use This Swap</button>
  </div>`).join("");
}

function getEmergencySwaps(selected) {
  const selectedText = songText(selected);
  return state.songs
    .filter(song => song.id !== selected.id && !isUsed(song.id))
    .map(song => {
      const sameGenre = (song.genres || []).some(g => (selected.genres || []).map(x => x.toLowerCase()).includes(g.toLowerCase()));
      const similarEnergy = Math.abs((song.energy || 5) - (selected.energy || 5)) <= 2;
      const singalong = songText(song).includes("singalong") || songText(song).includes("anthem");
      const safer = songText(song).includes("classic") || songText(song).includes("floor");
      let score = 0;
      if (sameGenre) score += 25;
      if (similarEnergy) score += 20;
      if (singalong) score += 18;
      if (safer) score += 15;
      if (selected.bpm && song.bpm) score -= Math.abs(selected.bpm - song.bpm) / 4;
      const reason = singalong ? "More singalong" : safer ? "Safer option" : song.energy > selected.energy ? "Higher energy" : sameGenre ? "Same lane" : "Different colour";
      return { song, score, reason };
    })
    .sort((a, b) => b.score - a.score);
}

function renderLibrary() {
  const tbody = $("#songTable tbody");
  const q = ($("#librarySearch")?.value || "").toLowerCase();
  const songs = state.songs.filter(song => songText(song).includes(q)).slice(0, 350);
  tbody.innerHTML = songs.map(song => `<tr>
    <td><strong>${escapeHtml(song.title)}</strong></td>
    <td>${escapeHtml(song.artist)}</td>
    <td>${song.year || ""}</td>
    <td>${song.bpm || ""}</td>
       <td><span class="energy-pill" style="color:${energyColor(song.energy)}">${song.energy}</span></td>
    <td class="small">
      ${song.recognisability ? `Rec ${song.recognisability}` : ""}
      ${song.pianoBarRating ? ` · Piano ${song.pianoBarRating}` : ""}
      ${song.ukAudienceRating ? ` · UK ${song.ukAudienceRating}` : ""}
      ${song.obscurity ? ` · Obs ${song.obscurity}` : ""}
    </td>
    <td>${(song.genres || []).map(tagHtml).join("")}</td>
    <td>${(song.tags || []).map(tagHtml).join("")}</td>
    <td><button data-action="edit-song" data-song-id="${song.id}">Edit</button></td>
  </tr>`).join("");
}

function tagHtml(tag) { return `<span class="tag">${escapeHtml(tag)}</span>`; }

function renderSavedSets() {
  const list = $("#savedSetsList");
  if (!state.savedSets.length) {
    list.innerHTML = `<p class="muted">No saved sets yet.</p>`;
    return;
  }
  list.innerHTML = state.savedSets.map((saved, index) => `<div class="saved-card">
    <div><h4>${escapeHtml(saved.name)}</h4><p>${saved.created} · ${saved.sets.length} set(s) · ${saved.songCount} songs</p></div>
    <div><button data-action="load-saved" data-index="${index}">Load</button> <button data-action="delete-saved" data-index="${index}">Delete</button></div>
  </div>`).join("");
}

function renderStats() {
  const allRatings = Object.values(state.history);
  const killed = allRatings.reduce((sum, h) => sum + (h.killed || 0), 0);
  const worked = allRatings.reduce((sum, h) => sum + (h.worked || 0), 0);
  const died = allRatings.reduce((sum, h) => sum + (h.died || 0), 0);
  const usedSongs = new Set(state.savedSets.flatMap(saved => saved.sets.flatMap(set => set.items.map(item => item.id))));
  $("#statsGrid").innerHTML = [
    [state.savedSets.length, "Saved Sets"],
    [usedSongs.size, "Songs Used"],
    [killed + worked, "Positive Ratings"],
    [died, "Wrong Crowd / Died"]
  ].map(([value, label]) => `<div class="big-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");

  const songs = state.sets.flatMap(set => set.items.map(item => getSong(item.id)).filter(Boolean));
  $("#feedbackPanel").innerHTML = songs.length ? songs.map(song => `<div class="feedback-song">
    <div><strong>${escapeHtml(song.title)}</strong><br><span class="muted">${escapeHtml(song.artist || "Unknown artist")}</span></div>
    <button data-action="rate" data-rating="killed" data-song-id="${song.id}">Killed it 🔥</button>
    <button data-action="rate" data-rating="worked" data-song-id="${song.id}">Worked</button>
    <button data-action="rate" data-rating="okay" data-song-id="${song.id}">Okay</button>
    <button data-action="rate" data-rating="died" data-song-id="${song.id}">Wrong crowd</button>
  </div>`).join("") : `<p class="muted">Generate or load a set to rate songs from the night.</p>`;
}

function exportText() {
  const lines = [];
  lines.push(`${state.settings.brandName || "Set List Creator"}`);
  lines.push(`${state.settings.gigType} · ${state.settings.setLength.replace("x", " x ")} · ${new Date().toLocaleDateString()}`);
  lines.push("");
  state.sets.forEach(set => {
    lines.push(`${set.name} — ${formatMinutes(set.items.reduce((sum, item) => sum + (getSong(item.id)?.durationSec || 0), 0))}`);
    set.items.forEach((item, index) => {
      const song = getSong(item.id);
      if (song) lines.push(`${index + 1}. ${song.title} — ${song.artist}`);
    });
    lines.push("");
  });
  downloadFile("set-list.txt", lines.join("\n"), "text/plain");
}

function exportSongFinder() {
  const payload = {
    type: "song-finder-set-list",
    version: 1,
    name: `${state.settings.gigType} Set - ${new Date().toISOString().slice(0, 10)}`,
    gigType: state.settings.gigType,
    brief: state.settings.brief,
    createdAt: new Date().toISOString(),
    sets: state.sets.map(set => ({
      name: set.name,
      songs: set.items.map(item => item.id)
    }))
  };
  downloadJson("song-finder-set-list.json", payload);
}

function exportLibrary() { downloadJson("song-library.json", state.songs); }
function exportBackup() { downloadJson(BACKUP_NAME, state); }
function downloadJson(filename, payload) { downloadFile(filename, JSON.stringify(payload, null, 2), "application/json"); }
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function saveCurrentSet() {
  if (!state.sets.length) return toast("Generate a set first.");
  const name = prompt("Name this set:", `${state.settings.gigType} - ${new Date().toLocaleDateString()}`);
  if (!name) return;
  state.savedSets.unshift({
    name,
    created: new Date().toLocaleString(),
    settings: structuredClone(state.settings),
    sets: structuredClone(state.sets),
    songCount: state.sets.reduce((sum, set) => sum + set.items.length, 0),
    reasoning: state.reasoning
  });
  saveState("Set saved");
  render();
  toast("Set saved");
}

function openSongDialog(song = null) {
  const isNew = !song;
  $("#songDialogTitle").textContent = isNew ? "Add Song" : "Edit Song";
  $("#editSongId").value = song?.id || "";
  $("#songTitle").value = song?.title || "";
  $("#songArtist").value = song?.artist || "";
  $("#songYear").value = song?.year || "";
  $("#songBpm").value = song?.bpm || "";
  $("#songDuration").value = song ? formatDuration(song.durationSec) : "3:30";
  $("#songEnergy").value = song?.energy || 5;
  $("#songGenres").value = song?.genres?.join(", ") || "";
  $("#songTags").value = song?.tags?.join(", ") || "";
  $("#songNotes").value = song?.notes || "";
  $("#deleteSongBtn").style.display = isNew ? "none" : "inline-block";
  $("#songDialog").showModal();
}

function commitSong() {
  const id = $("#editSongId").value || slugify(`${$("#songTitle").value}-${$("#songArtist").value}`);
  const song = normalizeSong({
    id,
    title: $("#songTitle").value,
    artist: $("#songArtist").value,
    year: $("#songYear").value,
    bpm: $("#songBpm").value,
    duration: $("#songDuration").value,
    energy: $("#songEnergy").value,
    genres: $("#songGenres").value,
    tags: $("#songTags").value,
    notes: $("#songNotes").value
  });
  const existingIndex = state.songs.findIndex(s => s.id === id);
  pushUndo();
  if (existingIndex >= 0) state.songs[existingIndex] = song;
  else state.songs.push(song);
  saveState("Song saved");
  render();
}

function deleteSong(id) {
  if (!id || !confirm("Delete this song from the library?")) return;
  pushUndo();
  state.songs = state.songs.filter(song => song.id !== id);
  state.sets.forEach(set => set.items = set.items.filter(item => item.id !== id));
  saveState("Song deleted");
  render();
}

async function importSongsFromFile(file) {
  const text = await file.text();
  const json = JSON.parse(text);
  const rawSongs = Array.isArray(json) ? json : (json.songs || json.library || []);
  if (!Array.isArray(rawSongs)) throw new Error("JSON must be an array of songs or an object with a songs array.");
  pushUndo();
  const seen = new Set();
  state.songs = rawSongs.map(normalizeSong).filter(song => {
    if (seen.has(song.id)) {
      song.id = `${song.id}-${seen.size}`;
    }
    seen.add(song.id);
    return song.title;
  });
  state.settings.lastImport = `${new Date().toLocaleString()} · ${file.name}`;
  saveState("Song library imported");
  render();
  toast("Song library imported");
}

async function loadSample() {
  const response = await fetch("example-songs.json");
  const songs = await response.json();
  pushUndo();
  state.songs = songs.map(normalizeSong);
  state.settings.lastImport = `${new Date().toLocaleString()} · example-songs.json`;
  saveState("Sample library loaded");
  render();
  toast("Sample library loaded");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

function attachEvents() {
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    $$(".view").forEach(v => v.classList.remove("active"));
    $(`#${view}View`).classList.add("active");
    $("#pageTitle").textContent = btn.textContent.trim();
  }));

  ["gigType", "brief", "setLength", "preset"].forEach(id => {
    $(`#${id}`).addEventListener("input", event => {
      state.settings[id] = event.target.value;
      saveState();
    });
  });

  $("#songImport").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try { await importSongsFromFile(file); }
    catch (error) { alert(error.message); }
    event.target.value = "";
  });

  $("#generateBtn").addEventListener("click", () => generateWithAI());
  $("#regenerateBtn").addEventListener("click", () => generateWithAI({ setIndex: state.selectedSetIndex || 0 }));
  $("#lockAllBtn").addEventListener("click", () => {
    if (!state.sets.length) return;
    pushUndo();
    const set = state.sets[state.selectedSetIndex || 0];
    set.items.forEach(item => item.locked = true);
    saveState("Songs locked"); render(); toast("Visible set locked");
  });
  $("#undoBtn").addEventListener("click", () => {
    const previous = state.undo.pop();
    if (!previous) return toast("Nothing to undo");
    const restored = JSON.parse(previous);
    state.songs = restored.songs;
    state.sets = restored.sets;
    state.reasoning = restored.reasoning;
    saveState("Undo complete"); render();
  });
  $("#exportTextBtn").addEventListener("click", exportText);
  $("#exportSongFinderBtn").addEventListener("click", exportSongFinder);
  $("#exportPdfBtn").addEventListener("click", () => window.print());
  $("#saveSetBtn").addEventListener("click", saveCurrentSet);
  $("#exportAllBtn").addEventListener("click", exportBackup);
  $("#loadSampleBtn").addEventListener("click", loadSample);
  $("#librarySearch").addEventListener("input", renderLibrary);
  $("#addSongBtn").addEventListener("click", () => openSongDialog());
  $("#downloadLibraryBtn").addEventListener("click", exportLibrary);
  $("#saveSettingsBtn").addEventListener("click", () => {
    state.settings.aiEndpoint = $("#aiEndpoint").value.trim();
    state.settings.useAI = $("#useAI").checked;
    state.settings.brandName = $("#brandName").value.trim() || "Set List Creator";
    state.settings.accentMode = $("#accentMode").value;
    saveState("Settings saved");
    render();
    toast("Settings saved");
  });
  $("#resetAppBtn").addEventListener("click", () => {
    if (!confirm("Reset all app data in this browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    render();
    toast("App reset");
  });
  $("#clearSavedBtn").addEventListener("click", () => {
    if (!confirm("Clear saved sets?")) return;
    state.savedSets = [];
    saveState("Saved sets cleared"); render();
  });
  $("#clearHistoryBtn").addEventListener("click", () => {
    if (!confirm("Clear crowd feedback history?")) return;
    state.history = {};
    saveState("History cleared"); render();
  });

  $("#songForm").addEventListener("submit", event => {
    event.preventDefault();
    commitSong();
    $("#songDialog").close();
  });
  $("#deleteSongBtn").addEventListener("click", () => {
    deleteSong($("#editSongId").value);
    $("#songDialog").close();
  });

  document.addEventListener("click", event => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle-lock") {
      const set = state.sets[Number(target.dataset.set)];
      const item = set.items[Number(target.dataset.index)];
      item.locked = !item.locked;
      saveState(item.locked ? "Song locked" : "Song unlocked"); render();
    }
    if (action === "edit-song") openSongDialog(getSong(target.dataset.songId));
    if (action === "swap-selected") swapSelected(target.dataset.songId);
    if (action === "load-saved") {
      const saved = state.savedSets[Number(target.dataset.index)];
      if (!saved) return;
      pushUndo();
      state.settings = { ...state.settings, ...saved.settings };
      state.sets = structuredClone(saved.sets);
      state.reasoning = saved.reasoning;
      saveState("Saved set loaded"); render(); toast("Saved set loaded");
    }
    if (action === "delete-saved") {
      state.savedSets.splice(Number(target.dataset.index), 1);
      saveState("Saved set deleted"); render();
    }
    if (action === "rate") {
      const id = target.dataset.songId;
      const rating = target.dataset.rating;
      state.history[id] = state.history[id] || { killed: 0, worked: 0, okay: 0, died: 0 };
      state.history[id][rating] += 1;
      saveState("Feedback saved"); render(); toast("Feedback saved");
    }
    if (action === "add-to-set") {
      const setIndex = Number(target.dataset.set);
      const query = prompt("Type part of a song title or artist to add:");
      if (!query) return;
      const match = state.songs.find(song => songText(song).includes(query.toLowerCase()) && !state.sets[setIndex].items.some(item => item.id === song.id));
      if (!match) return toast("No matching unused song found");
      pushUndo();
      state.sets[setIndex].items.push({ id: match.id, locked: false });
      saveState("Song added"); render();
    }
  });

  document.addEventListener("click", event => {
    const li = event.target.closest(".set-song");
    if (!li) return;
    state.selectedSongId = li.dataset.songId;
    state.selectedSetIndex = Number(li.dataset.set);
    render();
  });

  document.addEventListener("dragstart", event => {
    const li = event.target.closest(".set-song");
    if (!li) return;
    dragged = { setIndex: Number(li.dataset.set), index: Number(li.dataset.index) };
    event.dataTransfer.effectAllowed = "move";
  });
  document.addEventListener("dragover", event => {
    if (event.target.closest(".set-song")) event.preventDefault();
  });
  document.addEventListener("drop", event => {
    const li = event.target.closest(".set-song");
    if (!li || !dragged) return;
    event.preventDefault();
    const to = { setIndex: Number(li.dataset.set), index: Number(li.dataset.index) };
    moveSong(dragged, to);
    dragged = null;
  });
}

function swapSelected(newSongId) {
  const selectedId = state.selectedSongId;
  if (!selectedId) return;
  pushUndo();
  state.sets.forEach(set => {
    set.items.forEach(item => {
      if (item.id === selectedId) item.id = newSongId;
    });
  });
  state.selectedSongId = newSongId;
  saveState("Song swapped"); render(); toast("Song swapped");
}

function moveSong(from, to) {
  pushUndo();
  const fromSet = state.sets[from.setIndex];
  const toSet = state.sets[to.setIndex];
  const [item] = fromSet.items.splice(from.index, 1);
  toSet.items.splice(to.index, 0, item);
  saveState("Song moved");
  render();
}

attachEvents();
render();
