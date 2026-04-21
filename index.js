require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const db = require('./db');
const crypto = require('crypto');
const http = require('http');

const bot = new Telegraf(process.env.BOT_TOKEN);

// 1. User bilan ishlash
bot.start((ctx) => {
    // /start bosilganda
    ctx.reply('Rasm va sana vaqt yuboring');
});

// 2. Post qabul qilish
bot.on('photo', (ctx) => {
    const message = ctx.message;
    const userId = ctx.from.id;
    
    if (message.caption) {
        const caption = message.caption;
        
        // 3. Sana va vaqtni ajratish
        const dateTimeRegex = /(\d{2})[.-](\d{2})[.-](\d{4})\s+(\d{2}):(\d{2})/;
        const match = caption.match(dateTimeRegex);
        
        if (match) {
            console.log("Sana va vaqt topildi");
            
            const day = match[1];
            const month = match[2];
            const year = match[3];
            const hour = match[4];
            const minute = match[5];
            
            // Standartlashtirish: YYYY-MM-DD HH:mm
            const standardDateTime = `${year}-${month}-${day} ${hour}:${minute}`;
            
            // Rasmni olish
            const photoId = message.photo[message.photo.length - 1].file_id;
            
            // 4. Ma'lumotni saqlash
            const newPost = {
                id: crypto.randomUUID(),
                user_id: userId,
                file_id: photoId,
                caption: caption,
                datetime: standardDateTime,
                original_datetime: match[0],
                sent: false
            };
            
            db.addPost(newPost);
            console.log("Yangi post saqlandi");
            
            ctx.reply("Ma'lumot saqlandi. Belgilangan vaqtda yuboriladi.");
        } else {
            // Noto'g'ri format bo'lsa
            ctx.reply("Iltimos sana va vaqtni to‘g‘ri yozing: 25.04.2026 17:00");
        }
    } else {
        // Caption yo'q bo'lsa
        ctx.reply("Iltimos sana va vaqtni to‘g‘ri yozing: 25.04.2026 17:00");
    }
});

// Matn yuborilganda xabar berish
bot.on('text', (ctx) => {
    if (!ctx.message.text.startsWith('/')) {
        ctx.reply("Iltimos, avval rasm yuboring va uni ostiga (caption qismiga) sana va vaqtni yozing: 25.04.2026 17:00");
    }
});

// 5. Scheduler
cron.schedule('* * * * *', async () => {
    // Render.com yoki boshqa serverlar UTC (0-mintaqa) da ishlaydi. 
    // O'zbekiston vaqtini (+5) olish uchun:
    const nowStr = new Date().toLocaleString("en-US", {timeZone: "Asia/Tashkent"});
    const now = new Date(nowStr);
    
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    
    const currentDateTimeStr = `${year}-${month}-${day} ${hour}:${minute}`;
    
    // hozirgi vaqt >= saqlangan datetime
    const pendingPosts = db.getPendingPosts(currentDateTimeStr);
    
    if (pendingPosts.length > 0) {
        for (const post of pendingPosts) {
            try {
                // 6. Yuborish - Faqat o'sha yuborgan userga qaytariladi
                await bot.telegram.sendPhoto(post.user_id, post.file_id, {
                    caption: post.caption
                });
                console.log("Userga yuborildi");
                
                // 7. Duplicate oldini olish
                db.markPostAsSent(post.id);
            } catch (err) {
                console.error(`User ${post.user_id} ga yuborishda xatolik:`, err.message);
                // Agar user bloklagan bo'lsa ham 'sent' qilib belgilaymiz
                db.markPostAsSent(post.id);
            }
        }
    }
});

bot.catch((err, ctx) => {
    console.error(`Xatolik: ${ctx.updateType}`, err);
});

bot.launch().then(() => {
    console.log("Bot ishga tushdi...");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Render.com Web Service qoidalari uchun oddiy server (Port binding)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
}).listen(PORT, () => {
    console.log(`Render uchun Web Server ishga tushdi: ${PORT}-portda`);
});
