// ==========================================
// Школа Фонда Потанина 2026 — Биржа обмена лагерями
// Google Apps Script Backend
// ==========================================
// Развернуть: Deploy → New Deployment → Web App
// Execute as: Me, Who has access: Anyone

const SHEET_NAME = "ШколаФондаПотанина2026";

function doGet(e) {
  return handleGet(e);
}

function doPost(e) {
  return handlePost(e);
}

function handleGet(e) {
  try {
    const action = e?.parameter?.action || "camps";

    switch (action) {
      case "camps":
        return jsonResponse(getCamps());
      case "participants":
        return jsonResponse(getParticipants());
      case "offers":
        return jsonResponse(getOffers());
      case "matches":
        return jsonResponse(findMatches());
      default:
        return jsonResponse({ error: "Unknown action" }, 400);
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
      const participantId = params.participantId;
      const name = params.name;
      const fromCamp = params.fromCamp;
      const toCamp = params.toCamp;
      const contact = params.contact || "";
      const note = params.note || "";

      if (!participantId || !name || !fromCamp || !toCamp) {
        return jsonResponse({ error: "Missing required fields (participantId, name, fromCamp, toCamp)" }, 400);
      }

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("offers");
      if (!sheet) return jsonResponse({ error: "Sheet 'offers' not found" }, 500);

      const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      sheet.appendRow([timestamp, participantId, name, fromCamp, toCamp, contact, note, "active"]);

      return jsonResponse({ success: true, message: "Заявка создана!" });
    }

    if (action === "deleteOffer") {
      const rowNum = parseInt(params.row);
      if (!rowNum || rowNum < 2) return jsonResponse({ error: "Invalid row number" }, 400);

      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("offers");
      if (!sheet) return jsonResponse({ error: "Sheet 'offers' not found" }, 500);

      sheet.deleteRow(rowNum);
      return jsonResponse({ success: true, message: "Заявка удалена" });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  }
}

// --- Чтение лагерей ---
function getCamps() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("camps");
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

// --- Чтение участников ---
function getParticipants() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("participants");
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

// --- Чтение заявок на обмен ---
function getOffers() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("offers");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map((row, i) => {
    const obj = {};
    headers.forEach((h, j) => (obj[h] = row[j] || ""));
    obj._row = i + 2; // sheet row number for delete
    return obj;
  });
}

// --- Поиск мэтчей ---
function findMatches() {
  const offers = getOffers();
  const matches = [];

  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      const a = offers[i];
      const b = offers[j];
      // A меняет X на Y, B меняет Y на X
      if (a.fromCamp === b.toCamp && a.toCamp === b.fromCamp) {
        matches.push({
          personA: { name: a.name, from: a.fromCamp, to: a.toCamp, contact: a.contact },
          personB: { name: b.name, from: b.fromCamp, to: b.toCamp, contact: b.contact },
        });
      }
    }
  }

  return matches;
}

// --- Хелпер для JSON ответа с CORS ---
function jsonResponse(data, code) {
  const code_ = code || 200;
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}