require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const moment = require('moment-timezone');
const http = require('http');
const { getReminders, saveReminder, updateReminderStatus } = require('./database');

// 1. DUMMY HTTP SERVER FOR RENDER.COM
// Render xizmati port talab qiladi (Web Service uchun), shuning uchun oddiy server ochamiz.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Srok Bot is running perfectly!');
}).listen(PORT, () => {
    console.log(`✅ Web server started on port ${PORT} (Render uchun)`);
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = process.env.CHANNEL_ID;
const TIMEZONE = 'Asia/Tashkent';

// Yo'riqnoma
const INSTRUCTION = `📋 *YO‘RIQNOMA*

1️⃣ Tovar rasmini yuboring.
2️⃣ Rasm tagiga quyidagi formatda yozing:

\`25.06.2026\`
\`30\`

Bunda:
📅 *25.06.2026* — mahsulot sroki tugaydigan sana
⏳ *30* — srok tugashidan necha kun oldin eslatish kerakligi

*Misollar:*
\`25.06.2026\`
\`30\`
(30 kun oldin yuboriladi)

\`25-06-2026 15\`
(15 kun oldin yuboriladi)

\`25.06.2026 16:00\`
\`15\`
(15 kun oldin soat 16:00 da yuboriladi)`;

bot.start((ctx) => {
    ctx.replyWithMarkdown(INSTRUCTION);
});

bot.on('photo', async (ctx) => {
    try {
        const caption = ctx.message.caption || '';
        
        if (!caption.trim()) {
            return ctx.reply('❌ Siz rasmga hech qanday izoh yozmadingiz.\n\nIltimos, rasm ostiga sana va kunni yozing:\nMisol uchun:\n05.05.2027\n30');
        }

        // Regex parser: 
        // 1-guruh: Sana (DD.MM.YYYY yoki DD-MM-YYYY)
        // 2-guruh: Vaqt (HH:mm) - ixtiyoriy
        // 3-guruh: Kun soni
        // Bular orasida probel yoki yangi qator bo'lishi mumkin
        const regex = /^(\d{2}[.-]\d{2}[.-]\d{4})(?:\s+(\d{2}:\d{2}))?(?:\s+|\n+)(\d+)$/i;
        const match = caption.trim().match(regex);

        if (!match) {
            console.log(`Noto'g'ri format qabul qilindi: ${caption}`);
            return ctx.reply('❌ Noto‘g‘ri format\n\nTo‘g‘ri misollar:\n\n05.05.2027\n30\n\nyoki\n\n05.05.2027 16:00\n15\n\nyoki\n\n05-05-2027 7');
        }

        let dateStr = match[1].replace(/-/g, '.'); // 05-05-2027 ni 05.05.2027 ga o'tkazamiz
        const timeStr = match[2]; // '16:00' yoki undefined
        const daysStr = match[3];

        let expiryMoment;
        if (timeStr) {
            expiryMoment = moment.tz(`${dateStr} ${timeStr}`, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
        } else {
            // Standart vaqt: 10:30
            expiryMoment = moment.tz(`${dateStr} 10:30`, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
        }

        const reminderDays = parseInt(daysStr, 10);

        if (!expiryMoment.isValid()) {
            return ctx.reply('❌ Kiritilgan sana mavjud emas yoki noto‘g‘ri.\nIltimos, DD.MM.YYYY formatida to‘g‘ri sana kiriting (masalan, 31.12.2026).');
        }
        if (isNaN(reminderDays) || reminderDays < 0) {
            return ctx.reply('❌ Kun soni noto‘g‘ri. Iltimos, musbat butun son kiriting.');
        }

        // Hisoblash
        const sendDatetime = expiryMoment.clone().subtract(reminderDays, 'days');

        const reminder = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            user_id: ctx.from.id,
            username: ctx.from.username || null,
            file_id: ctx.message.photo[ctx.message.photo.length - 1].file_id,
            original_caption: caption,
            expiry_date: dateStr,
            reminder_days: reminderDays,
            send_datetime: sendDatetime.toISOString(),
            status: 'pending'
        };

        // Bazaga saqlash
        await saveReminder(reminder);

        console.log(`✅ Tovar saqlandi: user_id=${ctx.from.id}, sana=${dateStr}, yuboriladi=${sendDatetime.format('DD.MM.YYYY HH:mm')}`);

        ctx.reply(`✅ Tovar saqlandi\n\n📅 Srok:\n${dateStr}\n\n⏳ Eslatma:\n${reminderDays} kun oldin\n\n🚀 Yuboriladi:\n${sendDatetime.format('DD.MM.YYYY HH:mm')}`);

    } catch (error) {
        console.error("Rasm qabul qilishda xatolik:", error);
        ctx.reply("❌ Tizimda xatolik yuz berdi, iltimos qaytadan urinib ko'ring.");
    }
});

// Cron job: Har minut tekshiradi
cron.schedule('* * * * *', async () => {
    try {
        const now = moment().tz(TIMEZONE);
        const reminders = await getReminders();
        
        let pendingReminders = reminders.filter(r => r.status === 'pending');
        
        for (const r of pendingReminders) {
            const sendMoment = moment(r.send_datetime).tz(TIMEZONE);
            
            // Vaqti kelgan bo'lsa
            if (now.isSameOrAfter(sendMoment)) {
                console.log(`🚀 Vaqti keldi! Yuborilmoqda: id=${r.id}`);
                
                const channelCaption = `⚠️ *SROKI YAQINLASHAYOTGAN MAHSULOT*\n\n📅 Srok:\n${r.expiry_date}\n\n⏳ ${r.reminder_days} kun oldin eslatildi`;
                
                // 1. Kanalga yuborish
                let channelSuccess = false;
                if (CHANNEL_ID) {
                    try {
                        await bot.telegram.sendPhoto(CHANNEL_ID, r.file_id, {
                            caption: channelCaption,
                            parse_mode: 'Markdown'
                        });
                        channelSuccess = true;
                    } catch (err) {
                        console.error(`❌ Kanalga yuborishda xatolik (CHANNEL_ID=${CHANNEL_ID}):`, err.message);
                    }
                } else {
                    console.error("❌ CHANNEL_ID .env faylida ko'rsatilmagan!");
                }

                // 2. Userga yuborish (original caption)
                let userSuccess = false;
                try {
                    await bot.telegram.sendPhoto(r.user_id, r.file_id, {
                        caption: r.original_caption
                    });
                    userSuccess = true;
                } catch (err) {
                    console.error(`❌ Userga yuborishda xatolik (user_id=${r.user_id}):`, err.message);
                }

                // Statusni yangilash
                if (channelSuccess || userSuccess) {
                    await updateReminderStatus(r.id, 'sent');
                    console.log(`✅ Status 'sent' ga o'zgardi: id=${r.id}`);
                } else {
                    console.log(`⚠️ Hech kimga yuborilmadi, keyingi safar qayta urinib ko'riladi: id=${r.id}`);
                }
            }
        }
    } catch (error) {
        console.error("Cron job xatoligi:", error);
    }
});

bot.launch().then(() => {
    console.log('🤖 Bot is running...');
}).catch((err) => {
    console.error('❌ Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
