"use strict";

// ============================================================
// SEARCH + MATCHING
// ============================================================

// ---------- Debug ----------
function debugSearch(msg) {
console.log("[NetflixNF][SEARCH] " + msg);
}

// ---------- Normalization ----------
function normalizeTitle(str) {
return String(str || "")
.toLowerCase()

// Unicode/special sequel symbols
.replace(/²/g, " square")
.replace(/³/g, " 3")

// Common separators
.replace(/&/g, " and ")

// Remove punctuation but preserve words
.replace(/[^a-z0-9\s]/g, " ")

// Collapse spaces
.replace(/\s+/g, " ")
.trim();

}

function normalizeYear(year) {
var y = String(year || "").trim();
return /^\d{4}$/.test(y) ? y : "";
}

// ---------- Title aliases ----------
// Add special aliases here when TMDB and Net52 use different names.
function getTitleAliases(title, year) {
var aliases = [];

function add(value) {
value = String(value || "").trim();
if (!value) return;

for (var i = 0; i < aliases.length; i++) {
  if (normalizeTitle(aliases[i]) === normalizeTitle(value)) {
    return;
  }
}

aliases.push(value);

}

var original = String(title || "").trim();
var normalized = normalizeTitle(original);

// Always search original first
add(original);

// ----------------------------------------------------------
// MAD (2023) / (MAD)² aka MAD Square
// ----------------------------------------------------------

if (
original === "(MAD)²" ||
normalized === "mad square" ||
normalized === "mad 2"
) {
add("MAD Square");
add("Mad Square");
add("MAD 2");
add("(MAD)²");
}

// ----------------------------------------------------------
// Generic sequel aliases
// Example:
// Movie 2
// Movie II
// ----------------------------------------------------------

var romanMatch = original.match(/^(.*?)\s+II$/i);

if (romanMatch) {
var baseRoman = romanMatch[1].trim();

add(baseRoman + " 2");

}

var numberMatch = original.match(/^(.*?)\s+2$/i);

if (numberMatch) {
var baseNumber = numberMatch[1].trim();

add(baseNumber + " II");

}

// Also search normalized version if different
var normalizedSearch = normalizeTitle(original);

if (
normalizedSearch &&
normalizedSearch !== normalizeTitle(original)
) {
add(normalizedSearch);
}

debugSearch(
"Aliases for "" +
original +
"" (" +
year +
"): [" +
aliases.join(" | ") +
"]"
);

return aliases;
}

// ============================================================
// LANGUAGE PRIORITY
// Only used AFTER title/year matching.
// ============================================================

function langPriority(title) {
var t = String(title || "").toLowerCase();

if (/\bhindi\b/.test(t)) return 100;

if (/\benglish\b/.test(t)) return 90;

if (!/\b(tamil|telugu|malayalam|kannada|bengali|marathi)\b/.test(t)) {
return 50;
}

return 10;
}

// ============================================================
// TITLE SCORING
// ============================================================

function getWords(str) {
var normalized = normalizeTitle(str);

if (!normalized) return [];

return normalized.split(" ");
}

function wordSimilarity(a, b) {
var wordsA = getWords(a);
var wordsB = getWords(b);

if (!wordsA.length || !wordsB.length) {
return 0;
}

var found = 0;

for (var i = 0; i < wordsA.length; i++) {
if (wordsB.indexOf(wordsA[i]) !== -1) {
found++;
}
}

return found / Math.max(wordsA.length, wordsB.length);
}

function isExactAliasMatch(resultTitle, aliases) {
var normalizedResult = normalizeTitle(resultTitle);

for (var i = 0; i < aliases.length; i++) {
if (
normalizedResult ===
normalizeTitle(aliases[i])
) {
return true;
}
}

return false;
}

function scoreResult(result, targetTitle, targetYear, aliases) {
var resultTitle = String(result.t || "");
var resultYear = normalizeYear(result.y);

var targetNormalized = normalizeTitle(targetTitle);
var resultNormalized = normalizeTitle(resultTitle);

var score = 0;
var reasons = [];

// ----------------------------------------------------------
// 1. Exact original title
// ----------------------------------------------------------

if (resultNormalized === targetNormalized) {
score += 10000;
reasons.push("EXACT_TITLE +10000");
}

// ----------------------------------------------------------
// 2. Exact alias
// ----------------------------------------------------------

if (isExactAliasMatch(resultTitle, aliases)) {
score += 9000;
reasons.push("ALIAS_MATCH +9000");
}

// ----------------------------------------------------------
// 3. Year
// ----------------------------------------------------------

if (
targetYear &&
resultYear &&
String(targetYear) === String(resultYear)
) {
score += 2000;
reasons.push("YEAR_MATCH +2000");
} else if (
targetYear &&
resultYear &&
String(targetYear) !== String(resultYear)
) {
score -= 500;
reasons.push("YEAR_MISMATCH -500");
}

// ----------------------------------------------------------
// 4. Word similarity
// ----------------------------------------------------------

var similarity = wordSimilarity(
targetTitle,
resultTitle
);

var similarityScore = Math.round(
similarity * 1000
);

score += similarityScore;

reasons.push(
"SIMILARITY " +
similarity.toFixed(2) +
" +" +
similarityScore
);

// ----------------------------------------------------------
// 5. IMPORTANT:
// Prevent original MAD and MAD Square confusion
// ----------------------------------------------------------

var targetIsMad =
targetNormalized === "mad";

var targetIsMadSquare =
targetNormalized === "mad square" ||
targetNormalized === "mad 2";

var resultIsMad =
resultNormalized === "mad";

var resultIsMadSquare =
resultNormalized === "mad square" ||
resultNormalized === "mad 2";

if (
targetIsMadSquare &&
resultIsMad
) {
score -= 20000;

reasons.push(
  "WRONG_MOVIE_MAD_INSTEAD_OF_MAD_SQUARE -20000"
);

}

if (
targetIsMad &&
resultIsMadSquare
) {
score -= 20000;

reasons.push(
  "WRONG_MOVIE_MAD_SQUARE_INSTEAD_OF_MAD -20000"
);

}

// ----------------------------------------------------------
// 6. Language priority
// Small bonus only.
// Never enough to beat correct title.
// ----------------------------------------------------------

var languageScore = langPriority(resultTitle);

score += languageScore;

reasons.push(
"LANGUAGE +" +
languageScore
);

return {
score: score,
reasons: reasons,
similarity: similarity,
exactMatch:
resultNormalized === targetNormalized,
aliasMatch:
isExactAliasMatch(resultTitle, aliases),
yearMatch:
!!(
targetYear &&
resultYear &&
String(targetYear) === String(resultYear)
)
};
}

// ============================================================
// RESULT PICKER
// ============================================================

function pickBestResult(
results,
targetTitle,
targetYear
) {
if (!results || !results.length) {
debugSearch("pickBestResult: no results");
return null;
}

var aliases = getTitleAliases(
targetTitle,
targetYear
);

debugSearch(
"========================================"
);

debugSearch(
"TARGET: "" +
targetTitle +
"" YEAR=" +
targetYear
);

debugSearch(
"RESULT COUNT: " +
results.length
);

var best = null;
var bestScore = -Infinity;
var bestInfo = null;

for (var i = 0; i < results.length; i++) {
var result = results[i];

var info = scoreResult(
  result,
  targetTitle,
  targetYear,
  aliases
);

debugSearch(
  "----------------------------------------"
);

debugSearch(
  "CANDIDATE #" +
  (i + 1)
);

debugSearch(
  "ID: " +
  result.id
);

debugSearch(
  "TITLE: " +
  result.t
);

debugSearch(
  "YEAR: " +
  result.y
);

debugSearch(
  "SCORE: " +
  info.score
);

debugSearch(
  "REASONS: " +
  info.reasons.join(" | ")
);

if (info.score > bestScore) {
  bestScore = info.score;
  best = result;
  bestInfo = info;

  debugSearch(
    ">>> NEW BEST MATCH"
  );
}

}

debugSearch(
"========================================"
);

if (best) {
debugSearch(
"FINAL MATCH:"
);

debugSearch(
  "ID=" +
  best.id +
  " TITLE=\"" +
  best.t +
  "\" YEAR=" +
  best.y +
  " SCORE=" +
  bestScore
);

debugSearch(
  "FINAL REASONS: " +
  bestInfo.reasons.join(" | ")
);

}

debugSearch(
"========================================"
);

return best;
}

// ============================================================
// SEARCH ALL ALIASES
// ============================================================

async function searchWithFallback(
originalTitle,
year
) {
var aliases = getTitleAliases(
originalTitle,
year
);

var allResults = [];
var seen = {};

debugSearch(
"========================================"
);

debugSearch(
"START SEARCH:"
);

debugSearch(
"TITLE="" +
originalTitle +
"" YEAR=" +
year
);

for (
var i = 0;
i < aliases.length;
i++
) {
var query = aliases[i];

debugSearch(
  "Searching Net52: \"" +
  query +
  "\""
);

var results = [];

try {
  results = await search(query);

  debugSearch(
    "Search returned " +
    results.length +
    " results"
  );
} catch (err) {
  debugSearch(
    "SEARCH ERROR for \"" +
    query +
    "\": " +
    err.message
  );

  continue;
}

for (
  var j = 0;
  j < results.length;
  j++
) {
  var item = results[j];

  if (!item || !item.id) {
    continue;
  }

  if (!seen[item.id]) {
    seen[item.id] = true;

    allResults.push(item);

    debugSearch(
      "ADD RESULT: ID=" +
      item.id +
      " TITLE=\"" +
      item.t +
      "\" YEAR=" +
      item.y
    );
  } else {
    debugSearch(
      "DUPLICATE SKIPPED: ID=" +
      item.id +
      " TITLE=\"" +
      item.t +
      "\""
    );
  }
}

}

debugSearch(
"TOTAL UNIQUE RESULTS: " +
allResults.length
);

// ----------------------------------------------------------
// Optional year-first filtering
// Keep ALL results because title matching still decides,
// but show how many match the requested year.
// ----------------------------------------------------------

if (year) {
var yearMatches = allResults.filter(
function(item) {
return (
String(item.y || "") ===
String(year)
);
}
);

debugSearch(
  "YEAR MATCHES (" +
  year +
  "): " +
  yearMatches.length
);

}

debugSearch(
"========================================"
);

return allResults;
}

// ============================================================
// USE IN getStreams()
// ============================================================
//
// REPLACE:
//
// const results = await searchWithFallback(title, year);
//
// let selected = pickBestResult(results, year);
//
// WITH:
//
// const results = await searchWithFallback(title, year);
//
// let selected = pickBestResult(
//   results,
//   title,
//   year
// );
//
// ============================================================