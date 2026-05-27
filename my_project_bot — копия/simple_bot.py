import telebot
import sqlite3
from telebot.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton
import socks
import socket

# НАСТРОЙКА ПРОКСИ ДЛЯ HAPP
socks.set_default_proxy(socks.SOCKS5, "127.0.0.1", 10808)
socket.socket = socks.socksocket

from config import TOKEN, PROJECTS
import database as db

bot = telebot.TeleBot(TOKEN)

# --- Клавиатуры ---
main_kb = ReplyKeyboardMarkup(resize_keyboard=True)
main_kb.add(KeyboardButton("🔍 Смотреть анкеты"))
main_kb.add(KeyboardButton("❤️ Мои мэтчи"))
main_kb.add(KeyboardButton("📝 Моя анкета"))
main_kb.add(KeyboardButton("✏️ Редактировать профиль"))
main_kb.add(KeyboardButton("🗑️ Удалить профиль"))

# Хранилище состояний
user_states = {}
user_data = {}

# --- Команда /start ---
@bot.message_handler(commands=['start'])
def start(message):
    user_id = message.from_user.id
    if db.get_user(user_id):
        bot.send_message(user_id, "С возвращением!", reply_markup=main_kb)
        return
    
    # Показываем проекты
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    for proj in PROJECTS:
        kb.add(KeyboardButton(proj))
    
    bot.send_message(user_id, "Привет! 👋\n\nВыбери свой проект из списка:", reply_markup=kb)
    user_states[user_id] = "waiting_project"

# --- Регистрация ---
@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "waiting_project")
def reg_project(message):
    if message.text not in PROJECTS:
        bot.send_message(message.chat.id, "Пожалуйста, выбери проект из кнопок.")
        return
    user_data[message.from_user.id] = {'project': message.text}
    bot.send_message(message.chat.id, "Сколько тебе лет?", reply_markup=ReplyKeyboardMarkup(resize_keyboard=True))
    user_states[message.from_user.id] = "waiting_age"

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "waiting_age")
def reg_age(message):
    if not message.text.isdigit():
        bot.send_message(message.chat.id, "Введи число.")
        return
    user_data[message.from_user.id]['age'] = int(message.text)
    bot.send_message(message.chat.id, "Из какого ты города?")
    user_states[message.from_user.id] = "waiting_city"

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "waiting_city")
def reg_city(message):
    user_data[message.from_user.id]['city'] = message.text
    bot.send_message(message.chat.id, "Расскажи немного о себе:")
    user_states[message.from_user.id] = "waiting_bio"

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "waiting_bio")
def reg_bio(message):
    data = user_data[message.from_user.id]
    data['bio'] = message.text
    user = message.from_user
    
    db.save_user(
        user_id=user.id,
        username=user.username or user.first_name,
        project=data['project'],
        age=data['age'],
        city=data['city'],
        bio=data['bio']
    )
    
    bot.send_message(message.chat.id, "✅ Анкета создана!", reply_markup=main_kb)
    del user_states[message.from_user.id]
    del user_data[message.from_user.id]

# --- Моя анкета ---
@bot.message_handler(func=lambda msg: msg.text == "📝 Моя анкета")
def my_profile(message):
    user = db.get_user(message.from_user.id)
    if not user:
        bot.send_message(message.chat.id, "Сначала /start")
        return
    text = f"📌 Проект: {user[2]}\n🎂 {user[3]} лет\n🌍 {user[4]}\n📝 {user[5]}"
    bot.send_message(message.chat.id, text, reply_markup=main_kb)

# --- Мои мэтчи ---
@bot.message_handler(func=lambda msg: msg.text == "❤️ Мои мэтчи")
def show_matches(message):
    user_id = message.from_user.id
    matches = db.get_matches(user_id)
    
    if not matches:
        bot.send_message(message.chat.id, "💔 Пока нет взаимных симпатий. Листай анкеты и ставь лайки!")
        return
    
    text = "💞 Твои мэтчи:\n\n"
    for m in matches:
        other = m[0] if m[1] == user_id else m[1]
        other_data = db.get_user(other)
        if other_data:
            text += f"👤 {other_data[1]}\n📌 {other_data[2]}\n🎂 {other_data[3]} лет\n🌍 {other_data[4]}\n"
            text += f"💬 Напиши: https://t.me/{other_data[1]}\n\n"
    
    bot.send_message(message.chat.id, text, reply_markup=main_kb)

# --- Просмотр анкет ---
current_profile = {}

@bot.message_handler(func=lambda msg: msg.text == "🔍 Смотреть анкеты")
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
    user_data = db.get_user(next_user)
    
    if not user_data:
        db.add_viewed(user_id, next_user)
        show_next_profile(user_id)
        return
    
    db.add_viewed(user_id, next_user)
    text = f"📌 Проект: {user_data[2]}\n🎂 {user_data[3]} лет\n🌍 {user_data[4]}\n📝 {user_data[5]}"
    
    current_profile[user_id] = next_user
    
    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("❤️ Лайк", callback_data=f"like_{next_user}"))
    kb.add(InlineKeyboardButton("❌ Дизлайк", callback_data=f"dislike_{next_user}"))
    
    bot.send_message(user_id, text, reply_markup=kb)

@bot.callback_query_handler(func=lambda call: call.data.startswith("like_"))
def like_callback(call):
    user_id = call.from_user.id
    target_id = int(call.data.split("_")[1])
    
    db.add_like(user_id, target_id)
    bot.answer_callback_query(call.id, "👍 Лайк поставлен!")
    
    if db.has_liked(target_id, user_id):
        db.add_match(user_id, target_id)
        bot.send_message(user_id, f"💘 ВЗАИМНАЯ СИМПАТИЯ! Напиши @{db.get_user(target_id)[1]}")
        bot.send_message(target_id, f"💘 ВЗАИМНАЯ СИМПАТИЯ! @{db.get_user(user_id)[1]} лайкнул тебя!")
    
    bot.delete_message(call.message.chat.id, call.message.message_id)
    show_next_profile(user_id)

@bot.callback_query_handler(func=lambda call: call.data.startswith("dislike_"))
def dislike_callback(call):
    user_id = call.from_user.id
    bot.answer_callback_query(call.id, "👎 Дизлайк")
    bot.delete_message(call.message.chat.id, call.message.message_id)
    show_next_profile(user_id)

# --- Редактирование ---
@bot.message_handler(func=lambda msg: msg.text == "✏️ Редактировать профиль")
def edit_start(message):
    user = db.get_user(message.from_user.id)
    if not user:
        bot.send_message(message.chat.id, "Сначала /start")
        return
    
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    kb.add(KeyboardButton("📌 Проект"))
    kb.add(KeyboardButton("🎂 Возраст"))
    kb.add(KeyboardButton("🌍 Город"))
    kb.add(KeyboardButton("📝 Описание"))
    kb.add(KeyboardButton("❌ Отмена"))
    
    bot.send_message(message.chat.id, f"Твой профиль:\n📌 {user[2]}\n🎂 {user[3]} лет\n🌍 {user[4]}\n📝 {user[5]}\n\nЧто изменить?", reply_markup=kb)
    user_states[message.from_user.id] = "edit_choice"

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "edit_choice")
def edit_choice(message):
    if message.text == "❌ Отмена":
        bot.send_message(message.chat.id, "Редактирование отменено", reply_markup=main_kb)
        del user_states[message.from_user.id]
        return
    
    if message.text == "📌 Проект":
        kb = ReplyKeyboardMarkup(resize_keyboard=True)
        for proj in PROJECTS:
            kb.add(KeyboardButton(proj))
        bot.send_message(message.chat.id, "Выбери новый проект:", reply_markup=kb)
        user_states[message.from_user.id] = "edit_project"
    elif message.text == "🎂 Возраст":
        bot.send_message(message.chat.id, "Введи новый возраст:", reply_markup=ReplyKeyboardMarkup(resize_keyboard=True))
        user_states[message.from_user.id] = "edit_age"
    elif message.text == "🌍 Город":
        bot.send_message(message.chat.id, "Введи новый город:")
        user_states[message.from_user.id] = "edit_city"
    elif message.text == "📝 Описание":
        bot.send_message(message.chat.id, "Введи новое описание:")
        user_states[message.from_user.id] = "edit_bio"

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "edit_project")
def edit_project(message):
    if message.text not in PROJECTS:
        bot.send_message(message.chat.id, "Выбери проект из кнопок.")
        return
    db.update_user_field(message.from_user.id, "project", message.text)
    bot.send_message(message.chat.id, "✅ Проект обновлен!", reply_markup=main_kb)
    del user_states[message.from_user.id]

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "edit_age")
def edit_age(message):
    if not message.text.isdigit():
        bot.send_message(message.chat.id, "Введи число.")
        return
    db.update_user_field(message.from_user.id, "age", int(message.text))
    bot.send_message(message.chat.id, "✅ Возраст обновлен!", reply_markup=main_kb)
    del user_states[message.from_user.id]

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "edit_city")
def edit_city(message):
    db.update_user_field(message.from_user.id, "city", message.text)
    bot.send_message(message.chat.id, "✅ Город обновлен!", reply_markup=main_kb)
    del user_states[message.from_user.id]

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "edit_bio")
def edit_bio(message):
    db.update_user_field(message.from_user.id, "bio", message.text)
    bot.send_message(message.chat.id, "✅ Описание обновлено!", reply_markup=main_kb)
    del user_states[message.from_user.id]

# --- Удаление ---
@bot.message_handler(func=lambda msg: msg.text == "🗑️ Удалить профиль")
def delete_confirm(message):
    kb = ReplyKeyboardMarkup(resize_keyboard=True)
    kb.add(KeyboardButton("✅ ДА, удалить"))
    kb.add(KeyboardButton("❌ НЕТ"))
    bot.send_message(message.chat.id, "⚠️ Это НЕОБРАТИМО! Удалить профиль?", reply_markup=kb)
    user_states[message.from_user.id] = "delete_confirm"

@bot.message_handler(func=lambda msg: user_states.get(msg.from_user.id) == "delete_confirm")
def delete_execute(message):
    if message.text == "✅ ДА, удалить":
        db.delete_user(message.from_user.id)
        bot.send_message(message.chat.id, "🗑️ Профиль удален. Для создания нового напиши /start", reply_markup=ReplyKeyboardMarkup(resize_keyboard=True))
    else:
        bot.send_message(message.chat.id, "Удаление отменено", reply_markup=main_kb)
    del user_states[message.from_user.id]

# --- Запуск ---
if __name__ == "__main__":
    db.init_db()
    print("✅ Бот запущен!")
    bot.infinity_polling()