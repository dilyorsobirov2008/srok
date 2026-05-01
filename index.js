require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./db');
const crypto = require('crypto');
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);
const CHANNEL_ID = process.env.CHANNEL_ID;

bot.start((ctx) => {
    ctx.reply("Iltimos rasm yuboring va srok yozing\nMasalan: 25.06.2026");
});

bot.on('photo', (ctx) => {
    const message = ctx.message;
    const userId = ctx.from.id;
    
    if (!message.caption) {
        return ctx.reply("❌ Sana noto‘g‘ri! To‘g‘ri yozing: 25.06.2026");
    }

    const caption = message.caption.trim();
    const dateRegex = /(\d{2})[\.\-](\d{2})[\.\-](\d{4})/;
    const match = caption.match(dateRegex);
    
    if (!match) {
        return ctx.reply("❌ Sana noto‘g‘ri! To‘g‘ri yozing: 25.06.2026");
    }

    // 4. Vaqt olish:
    // ctx.message.date dan olinadi
    // Soat va minut saqlanadi
    const date = new Date(message.date * 1000);
    const uzTime = new Date(
        date.toLocaleString("en-US", {
            timeZone: "Asia/Tashkent"
        })
    );
    const hours = String(uzTime.getHours()).padStart(2, '0');
    const minutes = String(uzTime.getMinutes()).padStart(2, '0');

    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1; // Oylarni 0 dan boshlanishi uchun
    const year = parseInt(match[3]);

    // 5. Hisoblash:
    // end_date = captiondagi sana, vaqt esa rasm yuborilgan vaqt
    const endDate = new Date(year, month, day, hours, minutes, 0, 0);
    
    // send_date = end_date - 30 kun
    const sendDate = new Date(endDate);
    sendDate.setDate(sendDate.getDate() - 30);
    
    console.log("30 kun oldingi sana hisoblandi");

    const photoId = message.photo[message.photo.length - 1].file_id;

    // 7. Saqlash:
    const newPost = {
        id: crypto.randomUUID(),
        user_id: userId,
        file_id: photoId,
        caption: caption,
        end_date: `${String(day).padStart(2, '0')}.${String(month+1).padStart(2, '0')}.${year}`,
        send_datetime: sendDate.getTime(),
        status: 'pending'
    };

    db.addPost(newPost);
    console.log("Post saqlandi");

    const formattedEndDate = newPost.end_date;
    const sendDay = String(sendDate.getDate()).padStart(2, '0');
    const sendMonth = String(sendDate.getMonth() + 1).padStart(2, '0');
    const sendYear = sendDate.getFullYear();
    const sendHours = String(sendDate.getHours()).padStart(2, '0');
    const sendMinutes = String(sendDate.getMinutes()).padStart(2, '0');
    const formattedSendDate = `${sendDay}.${sendMonth}.${sendYear} ${sendHours}:${sendMinutes}`;

    ctx.reply(`✅ Saqlandi!\n\n📅 Srok tugash sanasi: ${formattedEndDate}\n⏰ Sizga yuboriladi:\n${formattedSendDate}`);
});

bot.on('text', (ctx) => {
    if (!ctx.message.text.startsWith('/')) {
        ctx.reply("Iltimos rasm yuboring va srok yozing\nMasalan: 25.06.2026");
    }
});

// 8. Scheduler: Har 1 minut tekshiradi
cron.schedule('* * * * *', async () => {
    const now = Date.now();
    const pendingPosts = db.getPendingPosts(now);
    
    if (pendingPosts.length > 0) {
        for (const post of pendingPosts) {
            try {
                // 1) Userga yuborish
                await bot.telegram.sendPhoto(post.user_id, post.file_id, {
                    caption: post.caption
                });
                console.log("Userga yuborildi");
                
                // 2) Kanalga yuborish
                if (CHANNEL_ID) {
                    try {
                        await bot.telegram.sendPhoto(CHANNEL_ID, post.file_id, {
                            caption: post.caption + "\n⚠️ Srok yaqinlashmoqda!"
                        });
                        console.log("Kanalga yuborildi");
                    } catch (channelErr) {
                        console.error(`Kanalga yuborishda xatolik:`, channelErr.message);
                    }
                }
                
                // 3) status = sent
                db.markPostAsSent(post.id);
            } catch (err) {
                console.error(`Xatolik yuz berdi (Post ID: ${post.id}):`, err.message);
                // Agar user bloklagan bo'lsa ham 'sent' qilib belgilaymiz, qayta urinmaslik uchun
                db.markPostAsSent(post.id);
            }
        }
    }
});

bot.catch((err, ctx) => {
    console.error(`Global xatolik: ${ctx.updateType}`, err);
});

bot.launch().then(() => {
    console.log("Bot ishga tushdi...");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(PORT, () => {
    console.log(`Render uchun Web Server ishga tushdi: ${PORT}-portda`);
});
