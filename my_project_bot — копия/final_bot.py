import telebot
import sqlite3
import requests
from telebot.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton
from config import TOKEN, PROXY_PORT, PROJECTS_BY_MONTH
import database as db

# Создаём сессию с прокси
session = requests.Session()
session.proxies = {
    'http': f'socks5://127.0.0.1:{PROXY_PORT}',
    'https': f'socks5://127.0.0.1:{PROXY_PORT}'
}
session.timeout = 30

# Создаём бота
bot = telebot.TeleBot(TOKEN)

# Подменяем сессию через apihelper
import telebot.apihelper
telebot.apihelper.session = session

# Клавиатура с месяцами
months_kb = ReplyKeyboardMarkup(resize_keyboard=True)
months_kb.add(KeyboardButton("Июнь"), KeyboardButton("Июль"))
months_kb.add(KeyboardButton("Август"), KeyboardButton("Сентябрь"))
months_kb.add(KeyboardButton("❌ Отмена"))

# Основное меню
main_kb = ReplyKeyboardMarkup(resize_keyboard=True)
main_kb.add(KeyboardButton("🔍 Смотреть анкеты"))
main_kb.add(KeyboardButton("❤️ Мои мэтчи"))
main_kb.add(KeyboardButton("📝 Моя анкета"))
main_kb.add(KeyboardButton("✏️ Редактировать проект"))
main_kb.add(KeyboardButton("🗑️ Удалить профиль"))

# Хранилище состояний
user_states = {}
user_data = {}

# === ОБРАБОТЧИКИ ===
@bot.message_handler(commands=['start'])
def start(message):
    uid = message.from_user.id
    if db.get_user(uid):
        bot.send_message(uid, "С возвращением!", reply_markup=main_kb)
        return
    
    welcome_text = """
🏫 **Школа Потанина 2026** | Обмен проектами

🔄 Тебя распределили в один заповедник, но хочется в другой?

🔥 **Как работает бот:**
1️⃣ Выбери **свой проект** (куда тебя распределили)
2️⃣ Листай **карточки участников Школы Потанина** с их проектами
3️⃣ Нравится чужой проект? → ❤️ **Лайк**
4️⃣ Не нравится? → ❌ **Дизлайк**
5️⃣ Если вы **оба лайкнули** друг друга → 💘 **Мэтч**!
6️⃣ Обменивайтесь контактами и договаривайтесь об обмене проектами

🏞️ **63 проекта** в заповедниках и нацпарках России
📅 Июнь, июль, август, сентябрь
"""
    bot.send_message(uid, welcome_text, parse_mode="Markdown")
    
    bot.send_message(uid, "Сначала выбери месяц, в котором ты участвуешь:", reply_markup=months_kb)
    user_states[uid] = "waiting_month"

@bot.message_handler(func=lambda m: user_states.get(m.from_user.id) == "waiting_month")
def select_month(message):
    uid = message.from_user.id
    
    if message.text == "❌ Отмена":
        bot.send_message(uid, "Регистрация отменена. Напиши /start чтобы начать заново.", reply_markup=telebot.types.ReplyKeyboardRemove())
        del user_states[uid]
        return
    
    if message.text not in PROJECTS_BY_MONTH:
        bot.send_message(uid, "Пожалуйста, выбери месяц из кнопок:", reply_markup=months_kb)
        return
    
    user_data[uid] = {"month": message.text}
    
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    for project in PROJECTS_BY_MONTH[message.text]:
        kb.add(KeyboardButton(project))
    kb.add(KeyboardButton("◀️ Назад к месяцам"))
    
    bot.send_message(uid, f"Выбран месяц: {message.text}\n\nТеперь выбери свой проект:", reply_markup=kb)
    user_states[uid] = "waiting_project"

@bot.message_handler(func=lambda m: user_states.get(m.from_user.id) == "waiting_project")
def select_project(message):
    uid = message.from_user.id
    
    if message.text == "◀️ Назад к месяцам":
        bot.send_message(uid, "Выбери месяц:", reply_markup=months_kb)
        user_states[uid] = "waiting_month"
        return
    
    month = user_data.get(uid, {}).get("month")
    if not month or message.text not in PROJECTS_BY_MONTH.get(month, []):
        bot.send_message(uid, "Пожалуйста, выбери проект из списка кнопок.")
        return
    
    user = message.from_user
    db.save_user(
        user_id=user.id,
        username=user.username or user.first_name,
        project=message.text,
        month=month
    )
    
    bot.send_message(uid, f"✅ Анкета создана!\n\n📅 Месяц: {month}\n📌 Проект: {message.text}", reply_markup=main_kb)
    del user_states[uid]
    del user_data[uid]

@bot.message_handler(func=lambda m: m.text == "📝 Моя анкета")
def my_profile(message):
    user = db.get_user(message.from_user.id)
    if not user:
        bot.send_message(message.chat.id, "Сначала /start")
        return
    
    text = f"📅 Месяц: {user[3]}\n📌 Проект: {user[2]}"
    bot.send_message(message.chat.id, text, reply_markup=main_kb)

@bot.message_handler(func=lambda m: m.text == "❤️ Мои мэтчи")
def show_matches(message):
    user_id = message.from_user.id
    matches = db.get_matches(user_id)
    
    if not matches:
        bot.send_message(user_id, "💔 Пока нет взаимных симпатий. Листай анкеты!")
        return
    
    text = "💞 Твои мэтчи:\n\n"
    for match in matches:
        other = match[0] if match[1] == user_id else match[1]
        other_data = db.get_user(other)
        if other_data:
            text += f"👤 {other_data[1]}\n📅 {other_data[3]}\n📌 {other_data[2]}\n"
            text += f"💬 Напиши: https://t.me/{other_data[1]}\n\n"
    
    bot.send_message(user_id, text, reply_markup=main_kb)

@bot.message_handler(func=lambda m: m.text == "🔍 Смотреть анкеты")
def start_viewing(message):
    show_next_profile(message.from_user.id)

def show_next_profile(user_id):
    viewed = db.get_viewed(user_id)
    all_users = db.get_all_users_except(user_id)
    available = [u for u in all_users if u not in viewed]
    
    if not available:
        bot.send_message(user_id, "✨ Ты посмотрел всех! Новые люди появятся позже.", reply_markup=main_kb)
        return
    
    next_user = available[0]
    user_data_db = db.get_user(next_user)
    
    if not user_data_db:
        db.add_viewed(user_id, next_user)
        show_next_profile(user_id)
        return
    
    db.add_viewed(user_id, next_user)
    text = f"📅 Месяц: {user_data_db[3]}\n📌 Проект: {user_data_db[2]}"
    
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("❤️ Лайк", callback_data=f"like_{next_user}"), 
           InlineKeyboardButton("❌ Дизлайк", callback_data=f"dislike_{next_user}"))
    
    bot.send_message(user_id, text, reply_markup=kb)

@bot.callback_query_handler(func=lambda c: c.data.startswith("like_"))
def like_callback(call):
    user_id = call.from_user.id
    target_id = int(call.data.split("_")[1])
    
    db.add_like(user_id, target_id)
    bot.answer_callback_query(call.id, "👍 Лайк!")
    
    if db.has_liked(target_id, user_id):
        db.add_match(user_id, target_id)
        bot.send_message(user_id, f"💘 ВЗАИМНО! Напиши @{db.get_user(target_id)[1]}")
        bot.send_message(target_id, f"💘 ВЗАИМНО! @{db.get_user(user_id)[1]} лайкнул тебя!")
    
    bot.delete_message(call.message.chat.id, call.message.message_id)
    show_next_profile(user_id)

@bot.callback_query_handler(func=lambda c: c.data.startswith("dislike_"))
def dislike_callback(call):
    user_id = call.from_user.id
    bot.answer_callback_query(call.id, "👎")
    bot.delete_message(call.message.chat.id, call.message.message_id)
    show_next_profile(user_id)

@bot.message_handler(func=lambda m: m.text == "✏️ Редактировать проект")
def edit_start(message):
    user = db.get_user(message.from_user.id)
    if not user:
        bot.send_message(message.chat.id, "Сначала /start")
        return
    
    bot.send_message(message.chat.id, "Выбери новый месяц:", reply_markup=months_kb)
    user_states[message.from_user.id] = "edit_month"

@bot.message_handler(func=lambda m: user_states.get(m.from_user.id) == "edit_month")
def edit_month(message):
    uid = message.from_user.id
    
    if message.text == "❌ Отмена":
        bot.send_message(uid, "Редактирование отменено", reply_markup=main_kb)
        del user_states[uid]
        return
    
    if message.text not in PROJECTS_BY_MONTH:
        bot.send_message(uid, "Выбери месяц из кнопок:", reply_markup=months_kb)
        return
    
    user_data[uid] = {"edit_month": message.text}
    
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    for project in PROJECTS_BY_MONTH[message.text]:
        kb.add(KeyboardButton(project))
    kb.add(KeyboardButton("◀️ Назад к месяцам"))
    
    bot.send_message(uid, f"Выбери новый проект для месяца {message.text}:", reply_markup=kb)
    user_states[uid] = "edit_project"

@bot.message_handler(func=lambda m: user_states.get(m.from_user.id) == "edit_project")
def edit_project(message):
    uid = message.from_user.id
    
    if message.text == "◀️ Назад к месяцам":
        bot.send_message(uid, "Выбери месяц:", reply_markup=months_kb)
        user_states[uid] = "edit_month"
        return
    
    edit_month = user_data.get(uid, {}).get("edit_month")
    if not edit_month or message.text not in PROJECTS_BY_MONTH.get(edit_month, []):
        bot.send_message(uid, "Выбери проект из списка.")
        return
    
    db.update_user_field(uid, "project", message.text)
    db.update_user_field(uid, "month", edit_month)
    
    bot.send_message(uid, f"✅ Проект обновлен!\n\n📅 Месяц: {edit_month}\n📌 Проект: {message.text}", reply_markup=main_kb)
    del user_states[uid]
    del user_data[uid]

@bot.message_handler(func=lambda m: m.text == "🗑️ Удалить профиль")
def delete_confirm(message):
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    kb.add(KeyboardButton("✅ ДА, удалить"), KeyboardButton("❌ НЕТ"))
    bot.send_message(message.chat.id, "⚠️ Это НЕОБРАТИМО! Удалить профиль?", reply_markup=kb)
    user_states[message.from_user.id] = "delete_confirm"

@bot.message_handler(func=lambda m: user_states.get(m.from_user.id) == "delete_confirm")
def delete_execute(message):
    if message.text == "✅ ДА, удалить":
        db.delete_user(message.from_user.id)
        bot.send_message(message.chat.id, "🗑️ Профиль удален. Чтобы создать новый, напиши /start", reply_markup=telebot.types.ReplyKeyboardRemove())
    else:
        bot.send_message(message.chat.id, "Удаление отменено", reply_markup=main_kb)
    del user_states[message.from_user.id]

@bot.message_handler(commands=['check'])
def check_proxy(message):
    try:
        r = session.get('https://api.telegram.org', timeout=10)
        bot.reply_to(message, f"✅ Прокси работает! Статус: {r.status_code}")
    except Exception as e:
        bot.reply_to(message, f"❌ Ошибка: {str(e)[:100]}")

if __name__ == "__main__":
    db.init_db()
    print("✅ Бот запущен!")
    print(f"Загружено месяцев: {len(PROJECTS_BY_MONTH)}")
    for month, projects in PROJECTS_BY_MONTH.items():
        print(f"  {month}: {len(projects)} проектов")
    bot.infinity_polling(timeout=30)