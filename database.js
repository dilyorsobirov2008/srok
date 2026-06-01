const fs = require('fs').promises;
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

async function initDB() {
    try {
        await fs.access(DB_FILE);
    } catch {
        await fs.writeFile(DB_FILE, JSON.stringify([]));
    }
}

async function getReminders() {
    await initDB();
    const data = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
}

async function saveReminder(reminder) {
    const reminders = await getReminders();
    reminders.push(reminder);
    await fs.writeFile(DB_FILE, JSON.stringify(reminders, null, 2));
}

async function updateReminderStatus(id, status) {
    const reminders = await getReminders();
    const index = reminders.findIndex(r => r.id === id);
    if (index !== -1) {
        reminders[index].status = status;
        await fs.writeFile(DB_FILE, JSON.stringify(reminders, null, 2));
    }
}

module.exports = {
    getReminders,
    saveReminder,
    updateReminderStatus
};
