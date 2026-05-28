// ==========================================
// Школа Фонда Потанина 2026 — Обмен лагерями
// Google Apps Script Backend
// ==========================================

function doGet(e) { return handleGet(e); }

function doPost(e) {
  // Telegram webhook updates arrive as JSON; the site uses form-encoded params.
  // We also require a shared secret in the query string (Apps Script can't
  // read request headers, so secret-via-URL is the only practical option).
  if (e && e.postData && e.postData.type &&
      e.postData.type.indexOf("application/json") === 0 &&
      e.parameter && e.parameter.secret === getTgWebhookSecret_()) {
    return handleTelegramUpdate(e);
  }
  return handlePost(e);
}

function getTgWebhookSecret_() {
  return PropertiesService.getScriptProperties().getProperty("TG_WEBHOOK_SECRET") || "";
}

function getTgToken_() {
  return PropertiesService.getScriptProperties().getProperty("TG_TOKEN") || "";
}

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
      const campDates = params.campDates || "";
      const contact = params.contact || "";
      const passwordHash = params.passwordHash;
      if (!name || !camp || !campDates || !passwordHash) return jsonResponse({ error: "Missing fields" }, 400);
      if (!isCampSession_(camp, campDates)) return jsonResponse({ error: "Такой сессии лагеря нет в списке" }, 400);
      if (findLeaderBySession_(camp, campDates)) return jsonResponse({ error: "Эта сессия уже занята кэмп-лидером" }, 409);
      const sheet = getLeadersSheet_();
      const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      sheet.appendRow([camp, campDates, name, passwordHash, contact, timestamp]);
      return jsonResponse({ success: true });
    }

    if (action === "loginLeader") {
      const camp = params.camp;
      const campDates = params.campDates || "";
      const passwordHash = params.passwordHash;
      if (!camp || !passwordHash) return jsonResponse({ error: "Missing fields" }, 400);
      const leader = findLeaderBySession_(camp, campDates);
      if (!leader || leader.passwordHash !== passwordHash) {
        return jsonResponse({ error: "Неверный пароль" }, 401);
      }
      return jsonResponse({ success: true, name: leader.name, camp: leader.camp, campDates: leader.campDates });
    }

    if (action === "updateLeader") {
      // Authenticate using the CURRENT (camp, campDates) + password.
      const camp = params.camp;
      const campDates = params.campDates || "";
      const passwordHash = params.passwordHash;
      if (!camp || !passwordHash) return jsonResponse({ error: "Missing fields" }, 400);
      const current = findLeaderBySession_(camp, campDates);
      if (!current || current.passwordHash !== passwordHash) {
        return jsonResponse({ error: "Не авторизован" }, 401);
      }

      const newCamp = params.newCamp || camp;
      const newCampDates = params.newCampDates || campDates;
      const newContact = (params.newContact !== undefined) ? String(params.newContact) : current.contact;

      // Validate new session and uniqueness only if changed
      const sessionChanged = (newCamp !== camp) || (newCampDates !== campDates);
      if (sessionChanged) {
        if (!isCampSession_(newCamp, newCampDates)) {
          return jsonResponse({ error: "Такой сессии лагеря нет в списке" }, 400);
        }
        const existing = findLeaderBySession_(newCamp, newCampDates);
        if (existing) {
          return jsonResponse({ error: "Эта сессия уже занята другим кэмп-лидером" }, 409);
        }
      }

      const sheet = getLeadersSheet_();
      // schema: camp | campDates | name | passwordHash | contact | createdAt
      sheet.getRange(current.row, 1).setValue(newCamp);
      sheet.getRange(current.row, 2).setValue(newCampDates);
      sheet.getRange(current.row, 5).setValue(newContact);

      return jsonResponse({
        success: true,
        camp: newCamp,
        campDates: newCampDates,
        contact: newContact,
        name: current.name
      });
    }

    if (action === "setConfirmed" || action === "unsetConfirmed") {
      const targetName = params.name;
      const role = params.role;
      const passwordHash = params.passwordHash;
      const camp = params.camp || "";
      const campDates = params.campDates || "";
      if (!targetName || !role || !passwordHash) {
        return jsonResponse({ error: "Missing fields" }, 400);
      }
      if (role === "volunteer") {
        if (!verifyAuth_(targetName, passwordHash)) {
          return jsonResponse({ error: "Не авторизован" }, 401);
        }
      } else if (role === "leader") {
        if (!camp || !campDates) return jsonResponse({ error: "Missing camp/campDates" }, 400);
        if (!verifyLeaderAuth_(camp, campDates, passwordHash)) {
          return jsonResponse({ error: "Не авторизован" }, 401);
        }
        const target = getParticipantSession_(targetName);
        if (!target) return jsonResponse({ error: "Участника нет в списке" }, 404);
        if (target.camp !== camp || target.campDates !== campDates) {
          return jsonResponse({ error: "Участник не из вашей сессии лагеря" }, 403);
        }
      } else {
        return jsonResponse({ error: "Unknown role" }, 400);
      }

      if (action === "setConfirmed") {
        const setBy = role === "leader" ? ("leader:" + camp) : ("volunteer:" + targetName);
        const r = setConfirmedImpl_(targetName, setBy);
        if (!r.ok) return jsonResponse({ error: r.error }, r.code || 400);
        return jsonResponse({ success: true, message: r.message });
      } else {
        const r = unsetConfirmedImpl_(targetName);
        if (!r.ok) return jsonResponse({ error: r.error }, r.code || 400);
        return jsonResponse({ success: true, message: r.message });
      }
    }

    if (action === "createOffer") {
      const name = params.name;
      if (!name) return jsonResponse({ error: "Missing name" }, 400);
      if (!verifyAuth_(name, params.passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);
      const r = createOfferImpl_(name, params.toCamp || "", params.toCampDates || "", params.contact || "", params.note || "");
      if (!r.ok) return jsonResponse({ error: r.error }, r.code || 400);
      return jsonResponse({ success: true, message: r.message });
    }

    if (action === "deleteOffer") {
      const name = params.name;
      const rowNum = parseInt(params.row);
      if (!verifyAuth_(name, params.passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);
      const r = deleteOfferImpl_(name, rowNum);
      if (!r.ok) return jsonResponse({ error: r.error }, r.code || 400);
      return jsonResponse({ success: true, message: r.message });
    }

    if (action === "likeOffer") {
      const likerName = params.likerName;
      const offerRow = parseInt(params.offerRow);
      if (!verifyAuth_(likerName, params.passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);
      const r = likeOfferImpl_(likerName, offerRow, params.offerName || "", params.offerFrom || "", params.offerTo || "");
      if (!r.ok) return jsonResponse({ error: r.error }, r.code || 400);
      return jsonResponse({ success: true, message: r.message });
    }

    if (action === "unlikeOffer") {
      const likerName = params.likerName;
      const offerRow = parseInt(params.offerRow);
      if (!verifyAuth_(likerName, params.passwordHash)) return jsonResponse({ error: "Не авторизован" }, 401);
      const r = unlikeOfferImpl_(likerName, offerRow);
      if (!r.ok) return jsonResponse({ error: r.error }, r.code || 400);
      return jsonResponse({ success: true, message: r.message });
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
  // participants schema: id | name | university | region | city | camp | campDates
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === name) return true;
  }
  return false;
}

function getParticipantSession_(name) {
  // Returns { camp, campDates } or null
  const sheet = getSheetByName_("participants");
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === name) {
      return { camp: String(data[i][5] || ""), campDates: String(data[i][6] || "") };
    }
  }
  return null;
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
    sheet.appendRow(["camp", "campDates", "name", "passwordHash", "contact", "createdAt"]);
  }
  return sheet;
}

function findLeaderBySession_(camp, campDates) {
  const sheet = getLeadersSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === camp && String(data[i][1]) === campDates) {
      return {
        row: i + 1,
        camp: String(data[i][0]),
        campDates: String(data[i][1]),
        name: String(data[i][2] || ""),
        passwordHash: String(data[i][3] || ""),
        contact: String(data[i][4] || "")
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
    campDates: String(row[1] || ""),
    name: String(row[2] || ""),
    contact: String(row[4] || "")
  }));
}

function isCampSession_(camp, campDates) {
  // True if the (camp, dates) pair exists in the camps sheet.
  const sheet = getSheetByName_("camps");
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  // schema: name | dates | region
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === camp && String(data[i][1]) === campDates) return true;
  }
  return false;
}

function verifyLeaderAuth_(camp, campDates, passwordHash) {
  if (!camp || !passwordHash) return false;
  const leader = findLeaderBySession_(camp, campDates || "");
  if (!leader) return false;
  return leader.passwordHash === passwordHash;
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
  // Exclude offers from participants who confirmed «Точно еду / договор подписан»
  const confirmedNames = new Set(getConfirmedList_().map(c => c.name));
  const offers = getOffers().filter(o => !confirmedNames.has(o.name));
  // Direct-exchange uses only offers with an explicit toCamp.
  const offersWithTarget = offers.filter(o => o.toCamp);
  const likesAll = getSheet("likes");
  const matches = [];

  // 1. Classic matches: A wants X→Y (specific sessions), B wants Y→X (specific sessions)
  for (let i = 0; i < offersWithTarget.length; i++) {
    for (let j = i + 1; j < offersWithTarget.length; j++) {
      const a = offersWithTarget[i], b = offersWithTarget[j];
      if (a.fromCamp === b.toCamp && (a.fromCampDates || "") === (b.toCampDates || "")
       && a.toCamp === b.fromCamp && (a.toCampDates || "") === (b.fromCampDates || "")) {
        matches.push({
          type: "exchange",
          personA: { name: a.name, from: a.fromCamp, fromDates: a.fromCampDates, to: a.toCamp, toDates: a.toCampDates, contact: a.contact },
          personB: { name: b.name, from: b.fromCamp, fromDates: b.fromCampDates, to: b.toCamp, toDates: b.toCampDates, contact: b.contact }
        });
      }
    }
  }

  // 2. Cross-likes: A liked B's offer AND B liked A's offer (only when filtering by name)
  // Skip entirely if the filtered user is themselves confirmed.
  if (filterName && !confirmedNames.has(filterName)) {
    for (const like of likesAll) {
      if (like.offerName !== filterName) continue;
      if (confirmedNames.has(like.likerName)) continue; // skip if other side confirmed
      // like.likerName liked MY offer; check if I also liked THEIR offer
      const likedByMe = likesAll.some(l =>
        l.likerName === filterName && l.offerName === like.likerName
      );
      if (likedByMe) {
        const myOffer = offers.find(o => o.name === filterName);
        const theirOffer = offers.find(o => o.name === like.likerName);
        if (!theirOffer) continue; // their offer was removed/confirmed-out
        matches.push({
          type: "like",
          personA: {
            name: filterName,
            from: myOffer?.fromCamp || "",
            fromDates: myOffer?.fromCampDates || "",
            to: myOffer?.toCamp || "",
            toDates: myOffer?.toCampDates || "",
            contact: myOffer?.contact || ""
          },
          personB: {
            name: like.likerName,
            from: theirOffer.fromCamp,
            fromDates: theirOffer.fromCampDates || "",
            to: theirOffer.toCamp,
            toDates: theirOffer.toCampDates || "",
            contact: theirOffer.contact || ""
          }
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

// ==========================================
// Pure business-logic helpers (no auth, no HTTP).
// Called by both the web (handlePost — after password auth)
// and the Telegram bot (tgBot.gs — after telegram-link auth).
// Return shape: { ok: true, ...payload } | { ok: false, error, code }
// ==========================================

function createOfferImpl_(name, toCamp, toCampDates, contact, note) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const session = getParticipantSession_(name);
    if (!session) return { ok: false, error: "Участника нет в списке", code: 403 };
    const sheet = getSheetByName_("offers");
    if (!sheet) return { ok: false, error: "Sheet 'offers' not found", code: 500 };
    const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    const pId = name.replace(/\s+/g, "_").toLowerCase();
    // offers schema: timestamp | participantId | name | fromCamp | toCamp | contact | note | status | fromCampDates | toCampDates
    sheet.appendRow([timestamp, pId, name, session.camp, toCamp || "", contact || "", note || "", "active", session.campDates, toCampDates || ""]);
    return { ok: true, message: "Заявка создана!", row: sheet.getLastRow() };
  } finally {
    lock.releaseLock();
  }
}

function deleteOfferImpl_(name, rowNum) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!rowNum || rowNum < 2) return { ok: false, error: "Invalid row number", code: 400 };
    const sheet = getSheetByName_("offers");
    if (!sheet) return { ok: false, error: "Sheet 'offers' not found", code: 500 };
    const data = sheet.getDataRange().getValues();
    if (rowNum > data.length) return { ok: false, error: "Row out of range", code: 400 };
    const offerOwner = String(data[rowNum - 1][2] || "");
    if (offerOwner !== name) return { ok: false, error: "Нельзя удалить чужую заявку", code: 403 };
    sheet.deleteRow(rowNum);
    return { ok: true, message: "Заявка удалена" };
  } finally {
    lock.releaseLock();
  }
}

function likeOfferImpl_(likerName, offerRow, offerName, offerFrom, offerTo) {
  if (!likerName || !offerRow) return { ok: false, error: "Missing likerName or offerRow", code: 400 };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("likes");
    if (!sheet) {
      sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("likes");
      sheet.appendRow(["timestamp", "likerName", "offerRow", "offerName", "offerFrom", "offerTo"]);
    }
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === likerName && parseInt(data[i][2]) === offerRow) {
        return { ok: true, message: "Уже лайкнуто", duplicate: true };
      }
    }
    const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    sheet.appendRow([timestamp, likerName, offerRow, offerName || "", offerFrom || "", offerTo || ""]);
    return { ok: true, message: "Лайк!" };
  } finally {
    lock.releaseLock();
  }
}

function unlikeOfferImpl_(likerName, offerRow) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("likes");
    if (!sheet) return { ok: false, error: "No likes sheet", code: 400 };
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][1]) === likerName && parseInt(data[i][2]) === offerRow) {
        sheet.deleteRow(i + 1);
        return { ok: true, message: "Лайк удалён" };
      }
    }
    return { ok: true, message: "Лайк не найден" };
  } finally {
    lock.releaseLock();
  }
}

function setConfirmedImpl_(targetName, setBy) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (findConfirmedRow_(targetName)) return { ok: true, message: "Уже подтверждено" };
    const sheet = getConfirmedSheet_();
    const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    sheet.appendRow([targetName, timestamp, setBy]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function unsetConfirmedImpl_(targetName) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = findConfirmedRow_(targetName);
    if (!row) return { ok: true, message: "Уже снято" };
    getConfirmedSheet_().deleteRow(row.row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// Telegram-link helpers
// ==========================================

function getTgUsersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("tg_users");
  if (!sheet) {
    sheet = ss.insertSheet("tg_users");
    sheet.appendRow(["telegram_id", "name", "linkedAt"]);
  }
  return sheet;
}

function findTgUserByChatId_(chatId) {
  const sheet = getTgUsersSheet_();
  const data = sheet.getDataRange().getValues();
  const idStr = String(chatId);
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === idStr) return { row: i + 1, name: String(data[i][1] || "") };
  }
  return null;
}

function findTgUserByName_(name) {
  const sheet = getTgUsersSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === name) return { row: i + 1, telegramId: String(data[i][0]) };
  }
  return null;
}

function verifyTelegramActor_(chatId) {
  // Source-of-truth for "which participant is this Telegram chat?".
  // Returns the linked ФИО, or null if not linked.
  const user = findTgUserByChatId_(chatId);
  return user ? user.name : null;
}

function linkTelegram_(chatId, name) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!isParticipant_(name)) return { ok: false, error: "Участника нет в списке Школы 2026", code: 403 };
    if (findTgUserByChatId_(chatId)) return { ok: false, error: "Этот Telegram уже привязан", code: 409 };
    if (findTgUserByName_(name)) return { ok: false, error: "Этот участник уже привязан к другому Telegram", code: 409 };
    const sheet = getTgUsersSheet_();
    const timestamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    sheet.appendRow([String(chatId), name, timestamp]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function unlinkTelegram_(chatId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const user = findTgUserByChatId_(chatId);
    if (!user) return { ok: true, message: "Не был привязан" };
    getTgUsersSheet_().deleteRow(user.row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function getLegacyTgUsersSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("legacy_tg_users");
}

function getLegacyTgLikesSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("legacy_tg_likes");
}

function findLegacyTgUser_(chatId) {
  const sheet = getLegacyTgUsersSheet_();
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const idStr = String(chatId);
  // legacy_tg_users schema: telegram_id | username | project | month
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === idStr) {
      return {
        row: i + 1,
        username: String(data[i][1] || ""),
        project: String(data[i][2] || ""),
        month: String(data[i][3] || "")
      };
    }
  }
  return null;
}

function removeLegacyTgUser_(chatId) {
  const sheet = getLegacyTgUsersSheet_();
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const idStr = String(chatId);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === idStr) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}