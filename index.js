require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./db');
const crypto = require('crypto');
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = process.env.CHANNEL_ID;

// ─── /start ──────────────────────────────────────────────────────────────────
bot.start((ctx) => {
    ctx.reply(
        "Rasm yuboring va srok yozing\n" +
        "Masalan: 25.06.2026"
    );
});

// ─── Rasm qabul qilish ────────────────────────────────────────────────────────
bot.on('photo', (ctx) => {
    const message = ctx.message;
    const userId  = ctx.from.id;

    // Caption tekshiruvi
    if (!message.caption) {
        return ctx.reply("❌ Caption yozilmagan!\nRasmga sana yozing: 25.06.2026");
    }

    const caption = message.caption.trim();

    // 2. Sana ajratish
    const dateRegex = /(\d{2})[.\-](\d{2})[.\-](\d{4})/;
    const match = caption.match(dateRegex);

    if (!match) {
        return ctx.reply("❌ Sana noto'g'ri! To'g'ri yozing: 25.06.2026");
    }

    const day   = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year  = parseInt(match[3], 10);

    // Sana mantiqiy to'g'riligini tekshiruv
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return ctx.reply("❌ Sana noto'g'ri! To'g'ri yozing: 25.06.2026");
    }

    // 3. Hisoblash:
    // end_date = captiondagi sana
    // send_date = end_date - 30 kun

    // 4. MUHIM: Soat = 10, Minut = 30 (doim bir xil)
    const sendDate = new Date(year, month - 1, day);
    sendDate.setDate(sendDate.getDate() - 30);
    sendDate.setHours(10, 30, 0, 0);

    // 5. TIMEZONE: Asia/Tashkent
    // sendDate.getTime() – local JS timestamp
    // Tashkent offset = UTC+5 = 5*60 = 300 daqiqa
    // Biz new Date(year, month-1, day) bilan local vaqt yaratdik,
    // lekin Node.js serveri har xil timezone'da ishlashi mumkin.
    // Shuning uchun Tashkent bo'yicha aniq timestamp olishimiz kerak.

    const tashkentOffset = 5 * 60; // daqiqada
    const localOffset    = -sendDate.getTimezoneOffset(); // daqiqada (local server)
    const diffMs         = (tashkentOffset - localOffset) * 60 * 1000;
    const sendTimestamp  = sendDate.getTime() - diffMs;

    const photoId = message.photo[message.photo.length - 1].file_id;

    // 6. Saqlash
    const newPost = {
        id:            crypto.randomUUID(),
        user_id:       userId,
        file_id:       photoId,
        caption:       caption,
        end_date:      `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`,
        send_datetime: sendTimestamp,   // UTC ms — Tashkent 10:30 ga mos
        status:        'pending'
    };

    db.addPost(newPost);
    console.log(`✅ Post saqlandi | user: ${userId} | yuboriladi: ${new Date(sendTimestamp).toISOString()}`);

    // Userga tasdiq xabari (formatlab)
    const sd         = new Date(sendTimestamp);
    const sdTashkent = new Date(sd.getTime() + (tashkentOffset - (-sd.getTimezoneOffset())) * 60 * 1000);

    const fDay   = String(sdTashkent.getDate()).padStart(2, '0');
    const fMonth = String(sdTashkent.getMonth() + 1).padStart(2, '0');
    const fYear  = sdTashkent.getFullYear();

    ctx.reply(
        `✅ Saqlandi!\n\n` +
        `📅 Yuboriladi:\n` +
        `${fDay}.${fMonth}.${fYear} 10:30`
    );
});

// ─── Matn xabarlari ────────────────────────────────────────────────────────────
bot.on('text', (ctx) => {
    if (!ctx.message.text.startsWith('/')) {
        ctx.reply("Iltimos rasm yuboring va srok yozing\nMasalan: 25.06.2026");
    }
});

// ─── 7. Scheduler: har 1 daqiqa ───────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
    // Hozirgi vaqtni Asia/Tashkent bo'yicha ol
    const nowTashkent = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Tashkent' })
    );
    const nowMs = nowTashkent.getTime();

    // DB'dagi pending postlarni ol (send_datetime Tashkent bo'yicha ms)
    // send_datetime saqlanganda Tashkent bo'yicha hisoblangan edi,
    // lekin u Date.getTime() — bu UTC ms.
    // now uchun ham UTC ms ishlatamiz:
    const nowUtcMs = Date.now();

    const pendingPosts = db.getPendingPosts(nowUtcMs);

    for (const post of pendingPosts) {
        try {
            // 8. Userga yuborish
            await bot.telegram.sendPhoto(post.user_id, post.file_id, {
                caption: post.caption
            });
            console.log(`📤 Userga yuborildi: ${post.user_id}`);

            // Kanalga yuborish
            if (CHANNEL_ID) {
                try {
                    await bot.telegram.sendPhoto(CHANNEL_ID, post.file_id, {
                        caption: post.caption + '\n⚠️ Srok yaqinlashmoqda!'
                    });
                    console.log(`📢 Kanalga yuborildi: ${CHANNEL_ID}`);
                } catch (channelErr) {
                    console.error(`Kanalga yuborishda xatolik:`, channelErr.message);
                }
            }

            // Status = sent
            db.markPostAsSent(post.id);
        } catch (err) {
            console.error(`Xatolik (Post ID: ${post.id}):`, err.message);
            // Qayta urinmaslik uchun sent qilamiz
            db.markPostAsSent(post.id);
        }
    }
});

// ─── Global xatoliklar ─────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`Global xatolik [${ctx.updateType}]:`, err.message);
});

// ─── Botni ishga tushirish ─────────────────────────────────────────────────────
bot.launch().then(() => {
    console.log('🤖 Bot ishga tushdi (Asia/Tashkent, 10:30 rejimi)');
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ─── Render uchun HTTP server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(PORT, () => {
    console.log(`🌐 Web server: ${PORT}-portda`);
});
