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
      case "checkUser": {
        const name = e?.parameter?.name || "";
        if (!name) return jsonResponse({ error: "Missing name" }, 400);
        return jsonResponse({ inList: isParticipant_(name), registered: !!findUserRow_(name) });
      }
      case "leaders": return jsonResponse(getLeadersList_());
      case "confirmed": return jsonResponse(getConfirmedList_());
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

    if (action === "register") {
      const name = params.name;
      const passwordHash = params.passwordHash;
      if (!name || !passwordHash) return jsonResponse({ error: "Missing name or passwordHash" }, 400);
      if (!isParticipant_(name)) return jsonResponse({ error: "Вас нет в списке участников" }, 403);
      if (findUserRow_(name)) return jsonResponse({ error: "Пользователь уже зарегистрирован" }, 409);
      const sheet = getUsersSheet_();
      const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      sheet.appendRow([name, passwordHash, timestamp]);
      return jsonResponse({ success: true });
    }

    if (action === "login") {
      const name = params.name;
      const passwordHash = params.passwordHash;
      if (!name || !passwordHash) return jsonResponse({ error: "Missing name or passwordHash" }, 400);
      if (!verifyAuth_(name, passwordHash)) return jsonResponse({ error: "Неверный пароль" }, 401);
      return jsonResponse({ success: true });
    }

    if (action === "registerLeader") {
      const name = params.name;
      const camp = params.camp;
      const contact = params.contact || "";
      const passwordHash = params.passwordHash;
      if (!name || !camp || !passwordHash) return jsonResponse({ error: "Missing fields" }, 400);
      if (!isCamp_(camp)) return jsonResponse({ error: "Такого лагеря нет в списке" }, 400);
      if (findLeaderByCamp_(camp)) return jsonResponse({ error: "Этот лагерь уже занят кэмп-лидером" }, 409);
      const sheet = getLeadersSheet_();
      const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      sheet.appendRow([camp, name, passwordHash, contact, timestamp]);
      return jsonResponse({ success: true });
    }

    if (action === "loginLeader") {
      const camp = params.camp;
      const passwordHash = params.passwordHash;
      if (!camp || !passwordHash) return jsonResponse({ error: "Missing fields" }, 400);
      const leader = findLeaderByCamp_(camp);
      if (!leader || leader.passwordHash !== passwordHash) {
        return jsonResponse({ error: "Неверный пароль" }, 401);
      }
      return jsonResponse({ success: true, name: leader.name, camp: leader.camp });
    }

    if (action === "setConfirmed" || action === "unsetConfirmed") {
      const targetName = params.name;
      const role = params.role;
      const passwordHash = params.passwordHash;
      const camp = params.camp || "";
      if (!targetName || !role || !passwordHash) {
        return jsonResponse({ error: "Missing fields" }, 400);
      }
      if (role === "volunteer") {
        if (!verifyAuth_(targetName, passwordHash)) {
          return jsonResponse({ error: "Не авторизован" }, 401);
        }
      } else if (role === "leader") {
        if (!camp) return jsonResponse({ error: "Missing camp" }, 400);
        if (!verifyLeaderAuth_(camp, passwordHash)) {
          return jsonResponse({ error: "Не авторизован" }, 401);
        }
        const targetCamp = getParticipantCamp_(targetName);
        if (!targetCamp) return jsonResponse({ error: "Участника нет в списке" }, 404);
        if (targetCamp !== camp) return jsonResponse({ error: "Участник не из вашего лагеря" }, 403);
      } else {
        return jsonResponse({ error: "Unknown role" }, 400);
      }

      if (action === "setConfirmed") {
        if (findConfirmedRow_(targetName)) return jsonResponse({ success: true, message: "Уже подтверждено" });
        const sheet = getConfirmedSheet_();
        const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
        const setBy = role === "leader" ? ("leader:" + camp) : ("volunteer:" + targetName);
        sheet.appendRow([targetName, timestamp, setBy]);
        return jsonResponse({ success: true });
      } else {
        const row = findConfirmedRow_(targetName);
        if (!row) return jsonResponse({ success: true, message: "Уже снято" });
        const sheet = getConfirmedSheet_();
        sheet.deleteRow(row.row);
        return jsonResponse({ success: true });
      }
    }

    if (action === "createOffer") {
      const name = params.name;
      const passwordHash = params.passwordHash;
      const fromCamp = params.fromCamp || "";
      const toCamp = params.toCamp || "";
      const contact = params.contact || "";
      const note = params.note || "";

      if (!name || !fromCamp) {
        return jsonResponse({ error: "Missing required fields (name, fromCamp)" }, 400);
      }
      if (!verifyAuth_(name, passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);

      const sheet = getSheetByName_("offers");
      if (!sheet) return jsonResponse({ error: "Sheet 'offers' not found" }, 500);

      const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      const pId = name.replace(/\s+/g, "_").toLowerCase();
      sheet.appendRow([timestamp, pId, name, fromCamp, toCamp, contact, note, "active"]);
      return jsonResponse({ success: true, message: "Заявка создана!" });
    }

    if (action === "deleteOffer") {
      const name = params.name;
      const passwordHash = params.passwordHash;
      const rowNum = parseInt(params.row);
      if (!rowNum || rowNum < 2) return jsonResponse({ error: "Invalid row number" }, 400);
      if (!verifyAuth_(name, passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);

      const sheet = getSheetByName_("offers");
      if (!sheet) return jsonResponse({ error: "Sheet 'offers' not found" }, 500);
      const data = sheet.getDataRange().getValues();
      if (rowNum > data.length) return jsonResponse({ error: "Row out of range" }, 400);
      // offers schema: timestamp | participantId | name | fromCamp | toCamp | contact | note | status
      const offerOwner = String(data[rowNum - 1][2] || "");
      if (offerOwner !== name) return jsonResponse({ error: "Нельзя удалить чужую заявку" }, 403);

      sheet.deleteRow(rowNum);
      return jsonResponse({ success: true, message: "Заявка удалена" });
    }

    if (action === "likeOffer") {
      const likerName = params.likerName;
      const passwordHash = params.passwordHash;
      const offerRow = parseInt(params.offerRow);
      const offerName = params.offerName || "";
      const offerFrom = params.offerFrom || "";
      const offerTo = params.offerTo || "";

      if (!likerName || !offerRow) {
        return jsonResponse({ error: "Missing likerName or offerRow" }, 400);
      }
      if (!verifyAuth_(likerName, passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);

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
      const passwordHash = params.passwordHash;
      const offerRow = parseInt(params.offerRow);

      if (!verifyAuth_(likerName, passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);

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

// --- Auth helpers ---
function getUsersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("users");
  if (!sheet) {
    sheet = ss.insertSheet("users");
    sheet.appendRow(["name", "passwordHash", "createdAt"]);
  }
  return sheet;
}

function findUserRow_(name) {
  const sheet = getUsersSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === name) return { row: i + 1, passwordHash: String(data[i][1] || "") };
  }
  return null;
}

function isParticipant_(name) {
  const sheet = getSheetByName_("participants");
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  // participants schema: id | name | university | region | city | camp
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === name) return true;
  }
  return false;
}

function verifyAuth_(name, passwordHash) {
  if (!name || !passwordHash) return false;
  const user = findUserRow_(name);
  if (!user) return false;
  return user.passwordHash === passwordHash;
}

function getLeadersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("leaders");
  if (!sheet) {
    sheet = ss.insertSheet("leaders");
    sheet.appendRow(["camp", "name", "passwordHash", "contact", "createdAt"]);
  }
  return sheet;
}

function findLeaderByCamp_(camp) {
  const sheet = getLeadersSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === camp) {
      return {
        row: i + 1,
        camp: String(data[i][0]),
        name: String(data[i][1] || ""),
        passwordHash: String(data[i][2] || ""),
        contact: String(data[i][3] || "")
      };
    }
  }
  return null;
}

function getLeadersList_() {
  // Public list for autocomplete — no passwordHash exposed.
  const sheet = getLeadersSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1).map(row => ({
    camp: String(row[0] || ""),
    name: String(row[1] || ""),
    contact: String(row[3] || "")
  }));
}

function isCamp_(camp) {
  const sheet = getSheetByName_("camps");
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === camp) return true;
  }
  return false;
}

function verifyLeaderAuth_(camp, passwordHash) {
  if (!camp || !passwordHash) return false;
  const leader = findLeaderByCamp_(camp);
  if (!leader) return false;
  return leader.passwordHash === passwordHash;
}

function getParticipantCamp_(name) {
  const sheet = getSheetByName_("participants");
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  // schema: id | name | university | region | city | camp
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === name) return String(data[i][5] || "");
  }
  return null;
}

function getConfirmedSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("confirmed");
  if (!sheet) {
    sheet = ss.insertSheet("confirmed");
    sheet.appendRow(["name", "timestamp", "setBy"]);
  }
  return sheet;
}

function findConfirmedRow_(name) {
  const sheet = getConfirmedSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === name) return { row: i + 1 };
  }
  return null;
}

function getConfirmedList_() {
  const sheet = getConfirmedSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  return data.slice(1).map(row => ({
    name: String(row[0] || ""),
    timestamp: String(row[1] || "")
  }));
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