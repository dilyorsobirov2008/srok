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

const INSTRUCTION = `📋 *YO'RIQNOMA*

1️⃣ Tovar rasmini yuboring.
2️⃣ Rasm tagiga quyidagi formatda yozing:

*Ko'p qatorli:*
\`25.06.2026\`
\`30\`
\`meva\`

*Bir qatorli:*
\`25.06.2026 30 meva\`
\`25.06.2026 16:00 30 meva\`

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
\`25.06.2026 30 meva\`
\`25.06.2026 16:00 15 kolbasa\`
\`05.05.2026 7 suv\``;

bot.start((ctx) => {
    ctx.replyWithMarkdown(INSTRUCTION);
});

/**
 * Caption matnidan sana, vaqt (ixtiyoriy), kun soni va kategoriyani ajratib oladi.
 * Qo'llab-quvvatlangan formatlar:
 *
 * Ko'p qatorli:
 *   25.06.2026          25.06.2026 16:00
 *   30                  15
 *   meva                kolbasa
 *
 * Bir qatorli:
 *   25.06.2026 30 meva
 *   25.06.2026 16:00 30 meva
 *   05.05.2026 7 suv
 */
function parseCaption(caption) {
    const lines = caption.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');

    // ── KO'P QATORLI: kamida 3 qator ──────────────────────────────────────────
    if (lines.length >= 3) {
        // 1-qator: sana va ixtiyoriy vaqt
        const dateLineMatch = lines[0].match(/^(\d{2}[.\-]\d{2}[.\-]\d{4})(?:\s+(\d{2}:\d{2}))?$/);
        // 2-qator: kun soni (faqat raqam)
        const daysMatch = lines[1].match(/^(\d+)$/);

        if (dateLineMatch && daysMatch) {
            const dateStr = dateLineMatch[1].replace(/-/g, '.');
            const timeStr = dateLineMatch[2] || null;
            const reminderDays = parseInt(daysMatch[1], 10);
            const categoryName = lines.slice(2).join(' ').toLowerCase().trim();
            return { dateStr, timeStr, reminderDays, categoryName };
        }
    }

    // ── BIR QATORLI: birinchi (va yagona) qator ───────────────────────────────
    // Format A: DD.MM.YYYY <kun> <kategoriya>
    // Format B: DD.MM.YYYY HH:mm <kun> <kategoriya>
    const singleLine = lines[0];

    // Format B: sana + vaqt + kun + kategoriya
    const matchB = singleLine.match(
        /^(\d{2}[.\-]\d{2}[.\-]\d{4})\s+(\d{2}:\d{2})\s+(\d+)\s+(.+)$/
    );
    if (matchB) {
        return {
            dateStr: matchB[1].replace(/-/g, '.'),
            timeStr: matchB[2],
            reminderDays: parseInt(matchB[3], 10),
            categoryName: matchB[4].toLowerCase().trim()
        };
    }

    // Format A: sana + kun + kategoriya
    const matchA = singleLine.match(
        /^(\d{2}[.\-]\d{2}[.\-]\d{4})\s+(\d+)\s+(.+)$/
    );
    if (matchA) {
        return {
            dateStr: matchA[1].replace(/-/g, '.'),
            timeStr: null,
            reminderDays: parseInt(matchA[2], 10),
            categoryName: matchA[3].toLowerCase().trim()
        };
    }

    return null; // format tanilmadi
}

bot.on('photo', async (ctx) => {
    try {
        const caption = ctx.message.caption || '';

        if (!caption.trim()) {
            return ctx.reply(
                '❌ Rasm ostiga izoh yozilmagan!\n\n' +
                'Misollar:\n' +
                '05.05.2026 30 meva\n' +
                '05.05.2026 16:00 15 kolbasa\n\n' +
                'Yoki ko\'p qatorli:\n' +
                '25.06.2026\n30\nmeva'
            );
        }

        const parsed = parseCaption(caption);

        if (!parsed) {
            return ctx.reply(
                '❌ Format noto\'g\'ri\n\n' +
                'To\'g\'ri formatlar:\n\n' +
                '▸ 05.05.2026 30 meva\n' +
                '▸ 05.05.2026 16:00 15 kolbasa\n\n' +
                'Yoki ko\'p qatorli:\n' +
                '25.06.2026\n30\nmeva'
            );
        }

        const { dateStr, timeStr, reminderDays, categoryName } = parsed;

        // Kategoriya tekshiruvi
        let channel_id = CATEGORIES[categoryName];
        if (!channel_id) {
            let errorMsg = `❌ Kategoriya topilmadi: "${categoryName}"\n\nMavjud kategoriyalar:\n\n`;
            for (let cat of Object.keys(CATEGORIES)) {
                errorMsg += `- ${cat}\n`;
            }
            return ctx.reply(errorMsg);
        }

        // Kun soni tekshiruvi
        if (isNaN(reminderDays) || reminderDays < 0) {
            return ctx.reply('❌ Kun soni noto\'g\'ri. Iltimos, musbat butun son kiriting.');
        }

        // Moment yaratish
        let expiryMoment;
        if (timeStr) {
            expiryMoment = moment.tz(`${dateStr} ${timeStr}`, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
        } else {
            expiryMoment = moment.tz(`${dateStr} 10:30`, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
        }

        if (!expiryMoment.isValid()) {
            return ctx.reply(
                '❌ Kiritilgan sana mavjud emas yoki noto\'g\'ri.\n' +
                'Iltimos, DD.MM.YYYY formatida to\'g\'ri sana kiriting (masalan, 31.12.2026).'
            );
        }

        // Yuborish vaqtini hisoblash
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

        ctx.reply(
            `✅ Tovar saqlandi\n\n` +
            `📦 Kategoriya: ${capitalize(categoryName)}\n` +
            `📅 Srok: ${dateStr}${timeStr ? ' ' + timeStr : ''}\n` +
            `⏳ Eslatma: ${reminderDays} kun oldin\n` +
            `🚀 Yuboriladi: ${sendDatetime.format('DD.MM.YYYY HH:mm')}\n` +
            `📢 Kanal: ${capitalize(categoryName)}`
        );

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
