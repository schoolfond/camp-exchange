// ==========================================
// Школа Фонда Потанина 2026 — Обмен лагерями
// Google Apps Script Backend
// ==========================================

function doGet(e) { return handleGet(e); }
function doPost(e) { return handlePost(e); }

function handleGet(e) {
  try {
    const action = e?.parameter?.action || "camps";
    switch (action) {
      case "camps": return jsonResponse(getSheet("camps"));
      case "participants": return jsonResponse(getSheet("participants"));
      case "offers": return jsonResponse(getOffers());
      case "matches": {
        const name = e?.parameter?.name || "";
        return jsonResponse(findMatches(name));
      }
      case "likes": return jsonResponse(getSheet("likes"));
      case "likesFor": {
        const name = e?.parameter?.name || "";
        return jsonResponse(getLikesFor(name));
      }
      default: return jsonResponse({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  }
}

function handlePost(e) {
  try {
    const params = e?.parameter || {};
    const action = params.action;

    if (action === "createOffer") {
      const name = params.name;
      const fromCamp = params.fromCamp || "";
      const toCamp = params.toCamp || "";
      const contact = params.contact || "";
      const note = params.note || "";

      if (!name || !fromCamp) {
        return jsonResponse({ error: "Missing required fields (name, fromCamp)" }, 400);
      }

      const sheet = getSheetByName_("offers");
      if (!sheet) return jsonResponse({ error: "Sheet 'offers' not found" }, 500);

      const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      const pId = name.replace(/\s+/g, "_").toLowerCase();
      sheet.appendRow([timestamp, pId, name, fromCamp, toCamp, contact, note, "active"]);
      return jsonResponse({ success: true, message: "Заявка создана!" });
    }

    if (action === "deleteOffer") {
      const rowNum = parseInt(params.row);
      if (!rowNum || rowNum < 2) return jsonResponse({ error: "Invalid row number" }, 400);
      const sheet = getSheetByName_("offers");
      if (!sheet) return jsonResponse({ error: "Sheet 'offers' not found" }, 500);
      sheet.deleteRow(rowNum);
      return jsonResponse({ success: true, message: "Заявка удалена" });
    }

    if (action === "likeOffer") {
      const likerName = params.likerName;
      const offerRow = parseInt(params.offerRow);
      const offerName = params.offerName || "";
      const offerFrom = params.offerFrom || "";
      const offerTo = params.offerTo || "";

      if (!likerName || !offerRow) {
        return jsonResponse({ error: "Missing likerName or offerRow" }, 400);
      }

      let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("likes");
      if (!sheet) {
        sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("likes");
        sheet.appendRow(["timestamp", "likerName", "offerRow", "offerName", "offerFrom", "offerTo"]);
      }

      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][1]) === likerName && parseInt(data[i][2]) === offerRow) {
          return jsonResponse({ success: true, message: "Уже лайкнуто" });
        }
      }

      const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      sheet.appendRow([timestamp, likerName, offerRow, offerName, offerFrom, offerTo]);
      return jsonResponse({ success: true, message: "Лайк!" });
    }

    if (action === "unlikeOffer") {
      const likerName = params.likerName;
      const offerRow = parseInt(params.offerRow);

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("likes");
      if (!sheet) return jsonResponse({ error: "No likes sheet" }, 400);

      const data = sheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (String(data[i][1]) === likerName && parseInt(data[i][2]) === offerRow) {
          sheet.deleteRow(i + 1);
          return jsonResponse({ success: true, message: "Лайк удалён" });
        }
      }
      return jsonResponse({ success: true, message: "Лайк не найден" });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  }
}

// --- Helpers ---
function getSheetByName_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getSheet(sheetName) {
  const sheet = getSheetByName_(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = row[i] || ""));
    return obj;
  });
}

function getOffers() {
  const sheet = getSheetByName_("offers");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map((row, i) => {
    const obj = {};
    headers.forEach((h, j) => (obj[h] = row[j] || ""));
    obj._row = i + 2;
    return obj;
  });
}

// --- Likes for a specific person ---
function getLikesFor(name) {
  const sheet = getSheetByName_("likes");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = row[i] || ""));
    return obj;
  }).filter(l => l.offerName === name);
}

// --- Matches ---
function findMatches(filterName) {
  const offers = getOffers().filter(o => o.toCamp); // only offers with target
  const likesAll = getSheet("likes");
  const matches = [];

  // 1. Classic matches: A wants X→Y, B wants Y→X
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i], b = offers[j];
      if (a.fromCamp === b.toCamp && a.toCamp === b.fromCamp) {
        matches.push({
          type: "exchange",
          personA: { name: a.name, from: a.fromCamp, to: a.toCamp, contact: a.contact },
          personB: { name: b.name, from: b.fromCamp, to: b.toCamp, contact: b.contact }
        });
      }
    }
  }

  // 2. Cross-likes: A liked B's offer AND B liked A's offer (only when filtering by name)
  if (filterName) {
    const myOffers = offers.filter(o => o.name === filterName);
    const myOfferRows = new Set(myOffers.map(o => o._row));

    for (const like of likesAll) {
      if (like.offerName !== filterName) continue;
      // like.likerName liked MY offer
      // Check if I also liked THEIR offer
      const likedByMe = likesAll.some(l =>
        l.likerName === filterName && l.offerName === like.likerName
      );
      if (likedByMe) {
        const theirOffer = offers.find(o => o.name === like.likerName);
        matches.push({
          type: "like",
          personA: { name: filterName, from: theirOffer?.fromCamp || "", to: theirOffer?.toCamp || "", contact: "" },
          personB: { name: like.likerName, from: like.offerFrom, to: like.offerTo, contact: "" }
        });
      }
    }
  }

  return matches;
}

function jsonResponse(data, code) {
  code = code || 200;
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}