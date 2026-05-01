const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

function initDb() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ posts: [] }, null, 2));
    }
}

function readDb() {
    initDb();
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeDb(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function addPost(post) {
    const db = readDb();
    db.posts.push(post);
    writeDb(db);
}

function getPendingPosts(currentTimestamp) {
    const db = readDb();
    return db.posts.filter(p => p.status === 'pending' && currentTimestamp >= p.send_datetime);
}

function markPostAsSent(postId) {
    const db = readDb();
    const postIndex = db.posts.findIndex(p => p.id === postId);
    if (postIndex !== -1) {
        db.posts[postIndex].status = 'sent';
        writeDb(db);
    }
}

module.exports = {
    addPost,
    getPendingPosts,
    markPostAsSent
};
