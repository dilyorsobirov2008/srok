require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./db');
const crypto = require('crypto');
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = process.env.CHANNEL_ID;

// Asia/Tashkent = UTC+5
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Tashkent bo'yicha sana/vaqtdan UTC timestamp (ms) qaytaradi.
 * new Date(year, month-1, day, h, m) — bu server local vaqtida yaratadi,
 * shuning uchun biz uni UTC ga aylantirib, Tashkent offset qo'shamiz.
 */
function tashkentToUtcMs(year, month, day, hours, minutes) {
    // UTC da "Tashkent vaqti" = Tashkent soat - 5
    const utcMs = Date.UTC(year, month - 1, day, hours - 5, minutes, 0, 0);
    return utcMs;
}

/**
 * UTC ms → "DD.MM.YYYY HH:mm" (Tashkent ko'rinishida)
 */
function formatTashkent(utcMs) {
    const d = new Date(utcMs + TASHKENT_OFFSET_MS);
    const day   = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year  = d.getUTCFullYear();
    const hh    = String(d.getUTCHours()).padStart(2, '0');
    const mm    = String(d.getUTCMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hh}:${mm}`;
}

// ─── /start ────────────────────────────────────────────────────────────────────
bot.start((ctx) => {
    ctx.reply(
        'Rasm yuboring va caption ga sana (va ixtiyoriy vaqt) yozing.\n\n' +
        'Misol (faqat sana):\n25.06.2026\n\n' +
        'Misol (sana + vaqt):\n25.06.2026 14:00'
    );
});

// ─── Rasm qabul qilish ─────────────────────────────────────────────────────────
bot.on('photo', (ctx) => {
    const message = ctx.message;
    const userId  = ctx.from.id;

    if (!message.caption) {
        return ctx.reply("❌ Caption yozilmagan!\nMisol: 25.06.2026  yoki  25.06.2026 14:00");
    }

    const caption = message.caption.trim();

    // 1. Sana va ixtiyoriy vaqt ajratish
    // Regex: DD.MM.YYYY  va  ixtiyoriy HH:mm
    const dateTimeRegex = /(\d{2})[.\-](\d{2})[.\-](\d{4})(?:\s+(\d{2}):(\d{2}))?/;
    const match = caption.match(dateTimeRegex);

    if (!match) {
        return ctx.reply("❌ Sana noto'g'ri! To'g'ri yozing: 25.06.2026  yoki  25.06.2026 14:00");
    }

    const day   = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year  = parseInt(match[3], 10);

    // 2. Vaqt logikasi: bor bo'lsa o'sha, yo'q bo'lsa 10:30
    const hasTime    = !!(match[4] && match[5]);
    const userHours  = hasTime ? parseInt(match[4], 10) : 10;
    const userMinutes = hasTime ? parseInt(match[5], 10) : 30;

    // Sana mantiqiy tekshiruv
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return ctx.reply("❌ Sana noto'g'ri! To'g'ri yozing: 25.06.2026");
    }
    if (userHours > 23 || userMinutes > 59) {
        return ctx.reply("❌ Vaqt noto'g'ri! To'g'ri yozing: 14:00");
    }

    // 3. Hisoblash: send_date = end_date - 30 kun
    // end_date UTC ms (Tashkent bo'yicha)
    const endUtcMs  = tashkentToUtcMs(year, month, day, userHours, userMinutes);

    // 30 kun oldin
    const sendUtcMs = endUtcMs - 30 * 24 * 60 * 60 * 1000;

    const photoId = message.photo[message.photo.length - 1].file_id;

    // Saqlash
    const newPost = {
        id:            crypto.randomUUID(),
        user_id:       userId,
        file_id:       photoId,
        caption:       caption,
        end_date:      `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`,
        send_datetime: sendUtcMs,
        status:        'pending'
    };

    db.addPost(newPost);
    console.log(`✅ Saqlandi | user: ${userId} | send: ${formatTashkent(sendUtcMs)}`);

    // Userga tasdiq
    ctx.reply(
        `✅ Saqlandi!\n\n` +
        `📅 Yuboriladi:\n` +
        `${formatTashkent(sendUtcMs)}`
    );
});

// ─── Matn xabarlar ────────────────────────────────────────────────────────────
bot.on('text', (ctx) => {
    if (!ctx.message.text.startsWith('/')) {
        ctx.reply('Iltimos rasm yuboring va srok yozing.\nMisol: 25.06.2026  yoki  25.06.2026 14:00');
    }
});

// ─── Scheduler: har 1 daqiqa ──────────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
    const nowUtcMs = Date.now();
    const pendingPosts = db.getPendingPosts(nowUtcMs);

    for (const post of pendingPosts) {
        try {
            // Userga yuborish
            await bot.telegram.sendPhoto(post.user_id, post.file_id, {
                caption: post.caption
            });
            console.log(`📤 Userga yuborildi: ${post.user_id}`);

            // Kanalga yuborish (majburiy)
            try {
                await bot.telegram.sendPhoto(CHANNEL_ID, post.file_id, {
                    caption: post.caption + '\n⚠️ Srok yaqinlashmoqda!'
                });
                console.log(`📢 Kanalga yuborildi: ${CHANNEL_ID}`);
            } catch (err) {
                console.log('Kanalga yuborilmadi:', err.message);
            }

            // Status = sent
            db.markPostAsSent(post.id);

        } catch (err) {
            console.error(`Xatolik (Post ID: ${post.id}):`, err.message);
            db.markPostAsSent(post.id);
        }
    }
});

// ─── Global xatolik ───────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`Global xatolik [${ctx.updateType}]:`, err.message);
});

// ─── Botni ishga tushirish ────────────────────────────────────────────────────
bot.launch().then(() => {
    console.log('🤖 Bot ishga tushdi | Asia/Tashkent rejimi');
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ─── Render uchun HTTP server ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(PORT, () => {
    console.log(`🌐 Web server: ${PORT}-portda`);
});
