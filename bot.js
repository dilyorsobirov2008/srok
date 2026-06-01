require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const moment = require('moment-timezone');
const { getReminders, saveReminder, updateReminderStatus } = require('./database');

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = process.env.CHANNEL_ID;
const TIMEZONE = 'Asia/Tashkent';

// Instruction message
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
→ 30 kun oldin yuboriladi

\`25.06.2026 16:00\`
\`15\`
→ 15 kun oldin soat 16:00 da yuboriladi

(Agar vaqt yozilmasa, standart vaqt 10:30 ishlatiladi)`;

bot.start((ctx) => {
    ctx.replyWithMarkdown(INSTRUCTION);
});

bot.on('photo', async (ctx) => {
    const caption = ctx.message.caption;
    if (!caption) {
        return ctx.reply('❌ Noto‘g‘ri format\n\n' + INSTRUCTION);
    }

    const lines = caption.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) {
        return ctx.reply('❌ Noto‘g‘ri format\n\nTo‘g‘ri misollar:\n\n25.06.2026\n30\n\nyoki\n\n25.06.2026 16:00\n15');
    }

    const dateStr = lines[0];
    const daysStr = lines[1];
    
    let expiryMoment;
    // Check if time is provided
    if (dateStr.includes(' ')) {
        expiryMoment = moment.tz(dateStr, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
    } else {
        expiryMoment = moment.tz(`${dateStr} 10:30`, 'DD.MM.YYYY HH:mm', true, TIMEZONE);
    }

    const reminderDays = parseInt(daysStr, 10);

    if (!expiryMoment.isValid() || isNaN(reminderDays)) {
        return ctx.reply('❌ Noto‘g‘ri format\n\nTo‘g‘ri misollar:\n\n25.06.2026\n30\n\nyoki\n\n25.06.2026 16:00\n15');
    }

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

    await saveReminder(reminder);

    ctx.reply(`✅ Tovar saqlandi\n\n📅 Srok:\n${dateStr}\n\n⏳ Eslatma:\n${reminderDays} kun oldin\n\n🚀 Yuboriladi:\n${sendDatetime.format('DD.MM.YYYY HH:mm')}`);
});

// Cron job
cron.schedule('* * * * *', async () => {
    const now = moment().tz(TIMEZONE);
    const reminders = await getReminders();
    
    for (const r of reminders) {
        if (r.status === 'pending') {
            const sendMoment = moment(r.send_datetime).tz(TIMEZONE);
            if (now.isSameOrAfter(sendMoment)) {
                
                const channelCaption = `⚠️ *SROKI YAQINLASHAYOTGAN MAHSULOT*\n\n📅 Srok:\n${r.expiry_date}\n\n⏳ ${r.reminder_days} kun oldin eslatildi`;
                
                // Send to Channel
                if (CHANNEL_ID) {
                    try {
                        await bot.telegram.sendPhoto(CHANNEL_ID, r.file_id, {
                            caption: channelCaption,
                            parse_mode: 'Markdown'
                        });
                    } catch (err) {
                        console.error('Error sending to channel:', err);
                    }
                }

                // Send to User (original caption)
                try {
                    await bot.telegram.sendPhoto(r.user_id, r.file_id, {
                        caption: r.original_caption
                    });
                } catch (err) {
                    console.error('Error sending to user:', err);
                }

                await updateReminderStatus(r.id, 'sent');
            }
        }
    }
});

bot.launch().then(() => {
    console.log('Bot is running...');
}).catch((err) => {
    console.error('Failed to start bot:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
