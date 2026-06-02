require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const moment = require('moment-timezone');
const http = require('http');
const { getReminders, saveReminder, updateReminderStatus } = require('./database');

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Srok Bot is running perfectly!');
}).listen(PORT, () => {
    console.log(`✅ Web server started on port ${PORT} (Render uchun)`);
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const TIMEZONE = 'Asia/Tashkent';

const CATEGORIES = {
    "ximka mahsulotlari": "-1003935760505",
    "bolalar tovarlari": "-1004298573905",
    "meva": "-1003784443278",
    "snek choy kofe shokolad": "-1003453819256",
    "suv": "-1003739895204",
    "qandolat kg": "-1003912163997",
    "konserva yog": "-1003990413251",
    "kolbasa": "-1003797680744"
};

function capitalize(s) {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

const INSTRUCTION = `📋 *YO‘RIQNOMA*

1️⃣ Tovar rasmini yuboring.
2️⃣ Rasm tagiga quyidagi formatda yozing:

\`25.06.2026\`
\`30\`
\`meva\`

Bunda:
📅 *25.06.2026* — mahsulot sroki tugaydigan sana
⏳ *30* — srok tugashidan necha kun oldin eslatish kerakligi
📦 *meva* — kategoriya nomi

*Mavjud kategoriyalar:*
- ximka mahsulotlari
- bolalar tovarlari
- meva
- snek choy kofe shokolad
- suv
- qandolat kg
- konserva yog
- kolbasa

*Misollar:*
\`25.06.2026\`
\`30\`
\`meva\`
(30 kun oldin yuboriladi)

\`25.06.2026 16:00\`
\`15\`
\`kolbasa\`
(15 kun oldin soat 16:00 da yuboriladi)`;

bot.start((ctx) => {
    ctx.replyWithMarkdown(INSTRUCTION);
});

bot.on('photo', async (ctx) => {
    try {
        const caption = ctx.message.caption || '';
        
        if (!caption.trim()) {
            return ctx.reply('❌ Siz rasmga hech qanday izoh yozmadingiz.\n\nIltimos, rasm ostiga sana, kun va kategoriyani yozing:\nMisol uchun:\n25.06.2026\n30\nmeva');
        }

        const lines = caption.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
        if (lines.length < 3) {
            return ctx.reply('❌ Noto‘g‘ri format\n\nTo‘g‘ri misollar:\n\n25.06.2026\n30\nmeva\n\nyoki\n\n25.06.2026 16:00\n15\nkolbasa');
        }

        const dateLine = lines[0];
        const daysStr = lines[1];
        const categoryName = lines.slice(2).join(' ').toLowerCase();

        const dateMatch = dateLine.match(/^(\d{2}[.-]\d{2}[.-]\d{4})(?:\s+(\d{2}:\d{2}))?$/);
        if (!dateMatch) {
            return ctx.reply('❌ Sana noto‘g‘ri formatda!\nTo‘g‘ri misollar: 25.06.2026 yoki 25.06.2026 16:00');
        }

        let dateStr = dateMatch[1].replace(/-/g, '.');
        const timeStr = dateMatch[2];
        const reminderDays = parseInt(daysStr, 10);

        let channel_id = CATEGORIES[categoryName];
        if (!channel_id) {
            let errorMsg = `❌ Kategoriya topilmadi\n\nMavjud kategoriyalar:\n\n`;
            for (let cat of Object.keys(CATEGORIES)) {
                errorMsg += `- ${cat}\n`;
            }
            return ctx.reply(errorMsg);
        }

        let expiryMoment;
        if (timeStr) {
            expiryMoment = moment.tz(`${dateStr} ${timeStr}`, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
        } else {
            // Standart vaqt: 10:30
            expiryMoment = moment.tz(`${dateStr} 10:30`, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
        }

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
            category: categoryName,
            channel_id: channel_id,
            send_datetime: sendDatetime.toISOString(),
            status: 'pending'
        };

        // Bazaga saqlash
        await saveReminder(reminder);

        console.log(`✅ Tovar saqlandi: user_id=${ctx.from.id}, sana=${dateStr}, kategoriya=${categoryName}, yuboriladi=${sendDatetime.format('DD.MM.YYYY HH:mm')}`);

        ctx.reply(`✅ Tovar saqlandi\n\n📦 Kategoriya:\n${capitalize(categoryName)}\n\n📅 Srok:\n${dateStr}\n\n⏳ Eslatma:\n${reminderDays} kun oldin\n\n🚀 Yuboriladi:\n${sendDatetime.format('DD.MM.YYYY HH:mm')}\n\n📢 Kanal:\n${capitalize(categoryName)}`);

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
                
                const channelCaption = `⚠️ SROKI YAQINLASHAYOTGAN MAHSULOT\n\n📦 Kategoriya:\n${capitalize(r.category)}\n\n📅 Srok:\n${r.expiry_date}\n\n⏳ ${r.reminder_days} kun oldin eslatildi`;
                
                // 1. Kanalga yuborish
                let channelSuccess = false;
                if (r.channel_id) {
                    try {
                        await bot.telegram.sendPhoto(r.channel_id, r.file_id, {
                            caption: channelCaption
                        });
                        channelSuccess = true;
                    } catch (err) {
                        console.error(`❌ Kanalga yuborishda xatolik (channel_id=${r.channel_id}):`, err.message);
                    }
                } else {
                    console.error("❌ Kategoriya uchun kanal ID topilmadi!");
                }

                // 2. Userga yuborish
                let userSuccess = false;
                try {
                    await bot.telegram.sendPhoto(r.user_id, r.file_id, {
                        caption: channelCaption
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
