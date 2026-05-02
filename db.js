const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

// ─── Init ──────────────────────────────────────────────────────────────────────
function initDb() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ posts: [] }, null, 2));
    }
}

// ─── Read / Write ──────────────────────────────────────────────────────────────
function readDb() {
    initDb();
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Post qo'shish
 * @param {{ id, user_id, file_id, caption, end_date, send_datetime, status }} post
 */
function addPost(post) {
    const db = readDb();
    db.posts.push(post);
    writeDb(db);
}

/**
 * Vaqti kelgan pending postlarni qaytaradi
 * @param {number} currentTimestampMs  — hozirgi UTC ms
 */
function getPendingPosts(currentTimestampMs) {
    const db = readDb();
    return db.posts.filter(
        p => p.status === 'pending' && currentTimestampMs >= p.send_datetime
    );
}

/**
 * Postni "sent" qilib belgilash
 * @param {string} postId
 */
function markPostAsSent(postId) {
    const db       = readDb();
    const postIdx  = db.posts.findIndex(p => p.id === postId);
    if (postIdx !== -1) {
        db.posts[postIdx].status = 'sent';
        writeDb(db);
    }
}

module.exports = { addPost, getPendingPosts, markPostAsSent };
