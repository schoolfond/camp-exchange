// ==========================================
// Школа Фонда Потанина 2026 — Telegram bot
// Webhook entry: handleTelegramUpdate(e), called from doPost in backend.gs.
// State per chat lives in ScriptProperties under key "state:<chatId>".
// ==========================================

// ---- HTTP ----

function tgApi_(method, payload) {
  const token = getTgToken_();
  if (!token) throw new Error("TG_TOKEN not set in Script properties");
  const url = "https://api.telegram.org/bot" + token + "/" + method;
  return UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function tgSend_(chatId, text, opts) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (opts && opts.reply_markup) payload.reply_markup = opts.reply_markup;
  return tgApi_("sendMessage", payload);
}

function tgAnswerCallback_(callbackId, text) {
  return tgApi_("answerCallbackQuery", { callback_query_id: callbackId, text: text || "" });
}

function tgDelete_(chatId, messageId) {
  return tgApi_("deleteMessage", { chat_id: chatId, message_id: messageId });
}

// ---- Keyboards ----

function mainMenuKb_() {
  return {
    keyboard: [
      [{ text: "📝 Моя анкета" }, { text: "🔍 Смотреть анкеты" }],
      [{ text: "🎯 Хочу в конкретный лагерь" }],
      [{ text: "❤️ Мои мэтчи" }],
      [{ text: "🚪 Отвязать аккаунт" }],
    ],
    resize_keyboard: true,
  };
}

function hideKb_() {
  return { remove_keyboard: true };
}

// ---- State (per-chat) ----

function getState_(chatId) {
  const raw = PropertiesService.getScriptProperties().getProperty("state:" + chatId);
  if (!raw) return { step: "idle", data: {} };
  try { return JSON.parse(raw); } catch (e) { return { step: "idle", data: {} }; }
}

function setState_(chatId, step, data) {
  PropertiesService.getScriptProperties()
    .setProperty("state:" + chatId, JSON.stringify({ step: step, data: data || {} }));
}

function clearState_(chatId) {
  PropertiesService.getScriptProperties().deleteProperty("state:" + chatId);
}

// ---- Entry ----

function handleTelegramUpdate(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    if (update.message) handleMessage_(update.message);
    else if (update.callback_query) handleCallback_(update.callback_query);
  } catch (err) {
    console.error("handleTelegramUpdate", err && err.stack ? err.stack : err);
  }
  // Always 200 OK — Telegram retries on non-2xx, which would amplify any bug.
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

// ---- Message routing ----

function handleMessage_(msg) {
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const state = getState_(chatId);

  // Commands reset state
  if (text === "/start") { clearState_(chatId); return handleStart_(chatId); }
  if (text === "/menu" || text === "/help") { clearState_(chatId); return handleMenu_(chatId); }
  if (text === "/cancel") {
    clearState_(chatId);
    tgSend_(chatId, "Отменено.", { reply_markup: mainMenuKb_() });
    return;
  }

  if (state.step === "waiting_name") return handleNameInput_(chatId, text);
  if (state.step === "wc_query")    return handleWcQuery_(chatId, text);
  if (state.step === "wc_contact")  return handleWcContact_(chatId, text, state);
  if (state.step === "wc_note")     return handleWcNote_(chatId, text, state);
  if (state.step === "unlink_confirm") return handleUnlinkConfirm_(chatId, text);

  // Main menu (idle state)
  const name = verifyTelegramActor_(chatId);
  if (!name) {
    tgSend_(chatId, "Сначала /start чтобы начать.", { reply_markup: hideKb_() });
    return;
  }
  if (text === "📝 Моя анкета") return showMyProfile_(chatId, name);
  if (text === "🔍 Смотреть анкеты") return showNextProfile_(chatId, name);
  if (text === "🎯 Хочу в конкретный лагерь") return startWantCamp_(chatId);
  if (text === "❤️ Мои мэтчи") return showMatches_(chatId, name);
  if (text === "🚪 Отвязать аккаунт") return confirmUnlink_(chatId);

  tgSend_(chatId, "Не понял. Используй кнопки или /menu.", { reply_markup: mainMenuKb_() });
}

// ---- /start ----

function handleStart_(chatId) {
  const linked = verifyTelegramActor_(chatId);
  if (linked) {
    tgSend_(chatId, "С возвращением, " + linked + "!", { reply_markup: mainMenuKb_() });
    return;
  }
  const legacy = findLegacyTgUser_(chatId);
  let text;
  if (legacy) {
    text = "👋 Вижу, ты уже был в нашем боте как @" + escapeHtml_(legacy.username) +
      " (проект: " + escapeHtml_(legacy.project) + ").\n\n" +
      "Мы переехали на новую версию, и теперь сайт + бот = один аккаунт. " +
      "Чтобы продолжить, введи своё ФИО точно как в списке Школы Потанина 2026:";
  } else {
    text =
      "🏫 <b>Школа Фонда Потанина 2026</b> — Обмен лагерями\n\n" +
      "Бот помогает найти пару для обмена сменами в заповедниках.\n\n" +
      "Чтобы начать — введи своё ФИО так, как оно в списке участников Школы 2026:";
  }
  setState_(chatId, "waiting_name", {});
  tgSend_(chatId, text, { reply_markup: hideKb_() });
}

function handleNameInput_(chatId, name) {
  if (!name || name.length < 3) {
    tgSend_(chatId, "Введи ФИО полностью (минимум 3 символа).");
    return;
  }
  if (!isParticipant_(name)) {
    tgSend_(chatId,
      "❌ Не нашёл такое ФИО в списке участников Школы 2026.\n\n" +
      "Проверь, что написано как в официальном списке («Фамилия Имя Отчество»).\n" +
      "Если уверен, что в списке — напиши организаторам.\n\n" +
      "Попробуй ещё раз:");
    return;
  }
  if (findTgUserByName_(name)) {
    clearState_(chatId);
    tgSend_(chatId,
      "❌ Этот участник уже привязан к другому Telegram-аккаунту.\n\n" +
      "Если это ты, но потерял доступ к старому аккаунту — напиши организаторам.",
      { reply_markup: hideKb_() });
    return;
  }
  const r = linkTelegram_(chatId, name);
  if (!r.ok) {
    clearState_(chatId);
    tgSend_(chatId, "❌ " + r.error, { reply_markup: hideKb_() });
    return;
  }
  bootstrapEmptyOffer_(name);
  const migrated = migrateLegacyForUser_(chatId, name);
  removeLegacyTgUser_(chatId);
  clearState_(chatId);

  const session = getParticipantSession_(name);
  let out = "✅ Привет, <b>" + escapeHtml_(name) + "</b>!\n\n";
  if (session) out += "📅 " + escapeHtml_(session.camp) + "\n🗓 " + escapeHtml_(session.campDates) + "\n\n";
  if (migrated > 0) out += "🔄 Перенесено лайков из старого бота: " + migrated + ".\n\n";
  out += "Выбирай в меню, что делаем дальше:";
  tgSend_(chatId, out, { reply_markup: mainMenuKb_() });
}

function bootstrapEmptyOffer_(name) {
  const offers = getOffers();
  if (offers.find(o => o.name === name)) return;
  createOfferImpl_(name, "", "", "", "");
}

function migrateLegacyForUser_(chatId, name) {
  // Walk legacy_tg_likes; for each row where this chat is involved AND the other party
  // is already linked, copy the like into the live `likes` sheet.
  const sheet = getLegacyTgLikesSheet_();
  if (!sheet) return 0;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0;
  const myId = String(chatId);
  let migrated = 0;
  let offers = getOffers();
  // bottom-up so deletes don't shift indices we still need
  for (let i = data.length - 1; i >= 1; i--) {
    const fromId = String(data[i][0]);
    const toId = String(data[i][1]);
    if (fromId !== myId && toId !== myId) continue;
    const otherId = (fromId === myId) ? toId : fromId;
    const other = findTgUserByChatId_(otherId);
    if (!other) continue;
    const likerName = (fromId === myId) ? name : other.name;
    const ownerName = (fromId === myId) ? other.name : name;
    const ownerOffer = offers.find(o => o.name === ownerName);
    if (!ownerOffer) continue;
    const r = likeOfferImpl_(likerName, ownerOffer._row, ownerName, ownerOffer.fromCamp, ownerOffer.toCamp);
    if (r.ok && !r.duplicate) migrated++;
    sheet.deleteRow(i + 1);
  }
  return migrated;
}

// ---- Main menu actions ----

function handleMenu_(chatId) {
  const name = verifyTelegramActor_(chatId);
  if (!name) return handleStart_(chatId);
  tgSend_(chatId, "Меню:", { reply_markup: mainMenuKb_() });
}

function showMyProfile_(chatId, name) {
  const session = getParticipantSession_(name);
  if (!session) {
    tgSend_(chatId, "❌ Тебя нет в текущем списке участников — напиши организаторам.", { reply_markup: mainMenuKb_() });
    return;
  }
  const myOffer = getOffers().find(o => o.name === name);
  let text = "<b>" + escapeHtml_(name) + "</b>\n\n";
  text += "📅 " + escapeHtml_(session.camp) + "\n";
  text += "🗓 " + escapeHtml_(session.campDates) + "\n\n";
  if (myOffer && myOffer.toCamp) {
    text += "🎯 Хочу в: " + escapeHtml_(myOffer.toCamp) +
      (myOffer.toCampDates ? " (" + escapeHtml_(myOffer.toCampDates) + ")" : "") + "\n";
  } else {
    text += "🎯 Целевой лагерь: не указан (только лайки)\n";
  }
  if (myOffer && myOffer.contact) text += "📞 Контакт: " + escapeHtml_(myOffer.contact) + "\n";
  if (myOffer && myOffer.note) text += "💬 " + escapeHtml_(myOffer.note) + "\n";
  tgSend_(chatId, text, { reply_markup: mainMenuKb_() });
}

function showNextProfile_(chatId, name) {
  const confirmedNames = new Set(getConfirmedList_().map(c => c.name));
  if (confirmedNames.has(name)) {
    tgSend_(chatId, "Ты в статусе «Точно еду / договор подписан» — листать смысла нет.", { reply_markup: mainMenuKb_() });
    return;
  }
  const likesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("likes");
  const myLikes = new Set();
  if (likesSheet) {
    const ld = likesSheet.getDataRange().getValues();
    for (let i = 1; i < ld.length; i++) {
      if (String(ld[i][1]) === name) myLikes.add(parseInt(ld[i][2]));
    }
  }
  const candidates = getOffers().filter(o =>
    o.name !== name && !confirmedNames.has(o.name) && !myLikes.has(o._row)
  );
  if (candidates.length === 0) {
    tgSend_(chatId, "Анкет больше нет — либо все уже лайкнуты, либо листать нечего. Зайди позже.", { reply_markup: mainMenuKb_() });
    return;
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const session = getParticipantSession_(pick.name);

  let text = "👤 <b>" + escapeHtml_(pick.name) + "</b>\n";
  if (session) text += "📅 " + escapeHtml_(session.camp) + " — " + escapeHtml_(session.campDates) + "\n";
  if (pick.toCamp) {
    text += "🎯 Хочет в: " + escapeHtml_(pick.toCamp) +
      (pick.toCampDates ? " (" + escapeHtml_(pick.toCampDates) + ")" : "") + "\n";
  } else {
    text += "🎯 Без конкретного направления (только лайки)\n";
  }
  if (pick.note) text += "\n💬 " + escapeHtml_(pick.note) + "\n";

  const kb = {
    inline_keyboard: [
      [
        { text: "❤️ Лайк", callback_data: "like:" + pick._row },
        { text: "❌ Пропустить", callback_data: "skip:" + pick._row },
      ],
      [{ text: "🛑 Хватит", callback_data: "stop" }],
    ],
  };
  tgSend_(chatId, text, { reply_markup: kb });
}

function showMatches_(chatId, name) {
  const matches = findMatches(name) || [];
  if (matches.length === 0) {
    tgSend_(chatId, "Пока нет мэтчей. Листай анкеты — лайки тоже считаются.", { reply_markup: mainMenuKb_() });
    return;
  }
  let text = "💞 <b>Твои мэтчи:</b>\n\n";
  for (const m of matches) {
    const other = m.personA.name === name ? m.personB : m.personA;
    const tag = m.type === "exchange" ? "🔁 Прямой обмен" : "❤️ Взаимные лайки";
    text += tag + "\n";
    text += "👤 " + escapeHtml_(other.name) + "\n";
    if (other.from) text += "📅 " + escapeHtml_(other.from) +
      (other.fromDates ? " (" + escapeHtml_(other.fromDates) + ")" : "") + "\n";
    if (other.to) text += "🎯 Хочет в: " + escapeHtml_(other.to) + "\n";
    if (other.contact) text += "📞 " + escapeHtml_(other.contact) + "\n";
    text += "\n";
  }
  tgSend_(chatId, text, { reply_markup: mainMenuKb_() });
}

// ---- "Хочу в конкретный лагерь" flow ----

function startWantCamp_(chatId) {
  setState_(chatId, "wc_query", {});
  tgSend_(chatId,
    "🎯 В какой лагерь хочешь? Введи название (или часть) — я покажу подходящие сессии.\n\nОтмена: /cancel",
    { reply_markup: hideKb_() });
}

function handleWcQuery_(chatId, query) {
  if (!query || query.length < 2) {
    tgSend_(chatId, "Введи минимум 2 символа.");
    return;
  }
  const camps = getSheet("camps"); // [{name, dates, region}]
  const q = query.toLowerCase();
  const matches = camps.filter(c =>
    String(c.name).toLowerCase().indexOf(q) >= 0 ||
    String(c.region).toLowerCase().indexOf(q) >= 0 ||
    String(c.dates).toLowerCase().indexOf(q) >= 0
  ).slice(0, 8);
  if (matches.length === 0) {
    tgSend_(chatId, "Ничего не нашёл. Попробуй другое слово или /cancel.");
    return;
  }
  const buttons = matches.map((c, i) => ([{
    text: shortenCamp_(c.name) + " — " + c.dates,
    callback_data: "wc:" + i,
  }]));
  buttons.push([{ text: "❌ Отмена", callback_data: "wc:cancel" }]);
  setState_(chatId, "wc_pick", { sessions: matches });
  tgSend_(chatId, "Найдено: " + matches.length + ". Выбери сессию:",
    { reply_markup: { inline_keyboard: buttons } });
}

function shortenCamp_(s) {
  s = String(s || "");
  return s.length > 45 ? s.slice(0, 42) + "…" : s;
}

function handleWcPick_(chatId, idx, state, callbackId, messageId) {
  if (idx === "cancel") {
    tgAnswerCallback_(callbackId, "Отменено");
    clearState_(chatId);
    if (messageId) tgDelete_(chatId, messageId);
    tgSend_(chatId, "Отменено.", { reply_markup: mainMenuKb_() });
    return;
  }
  const pick = (state.data.sessions || [])[parseInt(idx)];
  if (!pick) {
    tgAnswerCallback_(callbackId, "Сессия не найдена");
    return;
  }
  tgAnswerCallback_(callbackId, "");
  if (messageId) tgDelete_(chatId, messageId);
  setState_(chatId, "wc_contact", { toCamp: pick.name, toCampDates: pick.dates });
  tgSend_(chatId,
    "Выбрана: <b>" + escapeHtml_(pick.name) + "</b> (" + escapeHtml_(pick.dates) + ")\n\n" +
    "Контакт для связи — Telegram-юзернейм, телефон или email:",
    { reply_markup: hideKb_() });
}

function handleWcContact_(chatId, contact, state) {
  if (!contact || contact.length < 3) {
    tgSend_(chatId, "Введи нормальный контакт (минимум 3 символа).");
    return;
  }
  const d = state.data || {};
  d.contact = contact;
  setState_(chatId, "wc_note", d);
  tgSend_(chatId, "Что-то добавить к заявке? Кратко — условия, пожелания. Или /skip.");
}

function handleWcNote_(chatId, note, state) {
  const d = state.data || {};
  const cleanNote = (note === "/skip" || !note) ? "" : note;
  const name = verifyTelegramActor_(chatId);
  if (!name) { clearState_(chatId); tgSend_(chatId, "Не привязан. /start."); return; }
  // Одна активная заявка на юзера — старую удаляем
  const old = getOffers().find(o => o.name === name);
  if (old) deleteOfferImpl_(name, old._row);
  const r = createOfferImpl_(name, d.toCamp || "", d.toCampDates || "", d.contact || "", cleanNote);
  clearState_(chatId);
  if (!r.ok) {
    tgSend_(chatId, "❌ Не получилось: " + r.error, { reply_markup: mainMenuKb_() });
    return;
  }
  let out = "✅ Заявка создана!\n\n🎯 " + escapeHtml_(d.toCamp) +
    " (" + escapeHtml_(d.toCampDates) + ")\n📞 " + escapeHtml_(d.contact);
  if (cleanNote) out += "\n💬 " + escapeHtml_(cleanNote);
  tgSend_(chatId, out, { reply_markup: mainMenuKb_() });
}

// ---- Unlink ----

function confirmUnlink_(chatId) {
  setState_(chatId, "unlink_confirm", {});
  tgSend_(chatId,
    "Точно отвязать Telegram от аккаунта?\n\n" +
    "Лайки и заявка останутся в системе, но из бота ты выйдешь. " +
    "Напиши <b>ДА</b> чтобы подтвердить, или /cancel.");
}

function handleUnlinkConfirm_(chatId, text) {
  if ((text || "").toUpperCase() === "ДА") {
    unlinkTelegram_(chatId);
    clearState_(chatId);
    tgSend_(chatId, "Отвязал. Чтобы зайти заново — /start.", { reply_markup: hideKb_() });
    return;
  }
  clearState_(chatId);
  tgSend_(chatId, "Отменено.", { reply_markup: mainMenuKb_() });
}

// ---- Callback queries ----

function handleCallback_(cq) {
  if (!cq || !cq.message) return;
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const data = cq.data || "";
  const state = getState_(chatId);
  const name = verifyTelegramActor_(chatId);

  if (data.startsWith("wc:")) {
    return handleWcPick_(chatId, data.split(":")[1], state, cq.id, messageId);
  }

  if (!name) {
    tgAnswerCallback_(cq.id, "Сначала /start");
    return;
  }
  if (data.startsWith("like:")) {
    const row = parseInt(data.split(":")[1]);
    const offer = getOffers().find(o => o._row === row);
    if (!offer) { tgAnswerCallback_(cq.id, "Анкета пропала"); return; }
    const r = likeOfferImpl_(name, row, offer.name, offer.fromCamp, offer.toCamp);
    tgAnswerCallback_(cq.id, r.duplicate ? "Уже лайкал" : (r.ok ? "❤️" : (r.error || "Ошибка")));
    tgDelete_(chatId, messageId);
    return showNextProfile_(chatId, name);
  }
  if (data.startsWith("skip:")) {
    tgAnswerCallback_(cq.id, "Пропущено");
    tgDelete_(chatId, messageId);
    return showNextProfile_(chatId, name);
  }
  if (data === "stop") {
    tgAnswerCallback_(cq.id, "");
    tgDelete_(chatId, messageId);
    tgSend_(chatId, "Ок.", { reply_markup: mainMenuKb_() });
    return;
  }
  tgAnswerCallback_(cq.id, "");
}

// ---- Utility ----

function escapeHtml_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ==========================================
// Migration — run ONCE from the Apps Script editor.
// Idempotent: if it times out, just run again.
// ==========================================

// 40 silent mappings, auto-validated + 16 manually validated
// (kept in tgBot.gs so the migration code travels with the bot code).
const TG_AUTO_MAPPINGS = [
  [162962043, "Нефедов Данила Александрович"],            // @nefedovdanila
  [202356111, "Коромыслов Сергей Владимирович"],          // @Sergei_Koromyslov
  [218365885, "Жаркова Екатерина Олеговна"],              // @tamerikate
  [241529724, "Юфрякова Анастасия Александровна"],        // @yufryasha
  [317360489, "Крюкова Валерия Алексеевна"],              // @lera_nett
  [339928831, "Ященко Александр Игоревич"],               // @Yashchenko_Aleksandr
  [371080855, "Руднева (Хайруллина) Зулейха Мансуровна"], // @khairyllina
  [383231823, "Высотина Елизавета Андреевна"],            // @LizaVysotina
  [399227683, "Симанов Егор Сергеевич"],                  // @simakduck
  [446317718, "Компаниец Виталий Сергеевич"],             // @kompaniets_v
  [459916251, "Талашманова Софья Михайловна"],            // @sofyatalashmanova
  [523234458, "Пестерева Дарина Юрьевна"],                // @darlorean
  [526289322, "Валитова Лия Наилевна"],                   // @Liya_valitova
  [565408254, "Ломакина Полина Анатольевна"],             // @propolise
  [587520528, "Середа Константин Дмитриевич"],            // @kostyanchikd
  [587854180, "Садовский Данила Сергеевич"],              // @SDan1k
  [643582026, "Булыгина Полина Эдуардовна"],              // @bulbosun
  [670924093, "Екименко Анастасия Андреевна"],            // @anastasiaek
  [743045434, "Мельникова Светлана Витальевна"],          // @LanaMlnk
  [754862450, "Ярина Дарья Андреевна"],                   // @daryashasha
  [792113745, "Богомазова Арина Алексеевна"],             // @arnbgmz
  [852322406, "Бурова Татьяна Сергеевна"],                // @Burova_Tanya
  [871833966, "Фомичева Юлия Сергеевна"],                 // @fomichhh
  [892129972, "Акай Оксана Михайловна"],                  // @oksana_phil
  [928256640, "Лисман Анастасия Михайловна"],             // @NastyaLisman
  [977176547, "Ширикова Валерия Викторовна"],             // @shirikova_2001
  [978684229, "Мутугулина Нелли Игоревна"],               // @Mutugul
  [982890378, "Стрельцова Ярослава Антоновна"],           // @slava_streltsova
  [1013248560, "Кравченко Ирина Владимировна"],           // @irina052000
  [1127421161, "Шуклина Анна Артёмовна"],                 // @aa_shuklina
  [1179555367, "Егармин Павел Анатольевич"],              // @egarmin_pavel
  [1213416024, "Иванова Александра Денисовна"],           // @ivanovaleksa
  [1216192635, "Белоглазова Ольга Алексеевна"],           // @Ol_beloglazova
  [1389273739, "Капитонов Иван Владимирович"],            // @IvKapitonov
  [1426641689, "Гребёнкина Диана Юрьевна"],               // @din_vy
  [1909163836, "Грушкина Анжелика Максимовна"],           // @ne_angela
  [1911170337, "Бутенко Илья Александрович"],             // @Ilya_But
  [1973705670, "Чупин Дмитрий Юрьевич"],                  // @DY_Chupin
  [5154705564, "Деревенская Ольга Юрьевна"],              // @Olga_Yu_D
  [7961986660, "Леонова Анна Игоревна"],                  // @leonovaa_anna
];

function runMigration() {
  // Phase 1: link each silent user + bootstrap an empty offer.
  let linked = 0, skipped = 0, offersCreated = 0;
  for (const pair of TG_AUTO_MAPPINGS) {
    const chatId = pair[0], name = pair[1];
    if (findTgUserByChatId_(chatId)) { skipped++; continue; }
    const r = linkTelegram_(chatId, name);
    if (!r.ok) {
      console.warn("link failed", chatId, name, r.error);
      continue;
    }
    linked++;
    if (!getOffers().find(o => o.name === name)) {
      const sr = createOfferImpl_(name, "", "", "", "");
      if (sr.ok) offersCreated++;
    }
    removeLegacyTgUser_(chatId);
  }

  // Phase 2: walk legacy_tg_likes once; migrate pairs where both sides are linked.
  let likesMigrated = 0, likesPending = 0;
  const sheet = getLegacyTgLikesSheet_();
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    const offersByName = {};
    for (const o of getOffers()) offersByName[o.name] = o;
    for (let i = data.length - 1; i >= 1; i--) {
      const fromId = String(data[i][0]);
      const toId = String(data[i][1]);
      const fromUser = findTgUserByChatId_(fromId);
      const toUser = findTgUserByChatId_(toId);
      if (!fromUser || !toUser) { likesPending++; continue; }
      const toOffer = offersByName[toUser.name];
      if (!toOffer) { likesPending++; continue; }
      const r = likeOfferImpl_(fromUser.name, toOffer._row, toUser.name, toOffer.fromCamp, toOffer.toCamp);
      if (r.ok && !r.duplicate) likesMigrated++;
      sheet.deleteRow(i + 1);
    }
  }

  const summary =
    "Migration done.\n" +
    "  Linked: " + linked + " (skipped " + skipped + " already-linked)\n" +
    "  Offers bootstrapped: " + offersCreated + "\n" +
    "  Likes migrated: " + likesMigrated + "\n" +
    "  Likes still pending (wait for /start): " + likesPending;
  console.log(summary);
  return summary;
}
