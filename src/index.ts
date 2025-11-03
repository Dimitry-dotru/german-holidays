import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import Holidays from 'date-holidays';
import cron from 'node-cron';
import express from 'express';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);
const hd = new Holidays('DE', 'BW'); // Germany, Baden-Württemberg
const app = express();
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_URL; // Your Render service URL

// Store active chat IDs
const activeChatIds = new Set<number>();

// Function to get the next holiday
function getNextHoliday() {
  const now = new Date();
  const currentYear = now.getFullYear();

  // Get holidays for current and next year
  const holidays = [
    ...hd.getHolidays(currentYear),
    ...hd.getHolidays(currentYear + 1)
  ];

  // Filter and sort holidays that are in the future
  const upcomingHolidays = holidays
    .filter(holiday => new Date(holiday.date) > now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (upcomingHolidays.length > 0) {
    const nextHoliday = upcomingHolidays[0];
    const holidayDate = new Date(nextHoliday.date);
    const daysUntil = Math.ceil((holidayDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return `Ближайший праздник в Баден-Вюртемберге:\n📅 ${nextHoliday.name}\n🗓 Дата: ${holidayDate.toLocaleDateString('ru-RU')}\n⏰ Через ${daysUntil} ${daysUntil === 1 ? 'день' : daysUntil < 5 ? 'дня' : 'дней'}`;
  }

  return 'Не удалось найти ближайший праздник';
}

bot.start((ctx) => {
  activeChatIds.add(ctx.chat.id);
  ctx.reply('Hello world\n\nВы подписались на уведомления о праздниках в Баден-Вюртемберге!');
  console.log(`User ${ctx.chat.id} subscribed`);
});

// Health check endpoint for Render
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeChats: activeChatIds.size
  });
});

app.get('/', (_req, res) => {
  res.send('Germany Holiday Reminder Bot is running!');
});

// Cron job: every 30 seconds
cron.schedule('*/30 * * * * *', () => {
  const message = getNextHoliday();
  console.log(`[${new Date().toLocaleString()}] Sending holiday info to ${activeChatIds.size} chats`);

  activeChatIds.forEach(chatId => {
    bot.telegram.sendMessage(chatId, message).catch(err => {
      console.error(`Failed to send message to ${chatId}:`, err.message);
      // Remove chat ID if bot was blocked
      if (err.message.includes('blocked')) {
        activeChatIds.delete(chatId);
      }
    });
  });
});

// Self-ping to keep Render service alive (every 10 minutes)
if (RENDER_URL) {
  cron.schedule('*/10 * * * *', async () => {
    try {
      const response = await fetch(`${RENDER_URL}/health`);
      console.log(`[${new Date().toLocaleString()}] Self-ping successful: ${response.status}`);
    } catch (error) {
      console.error('Self-ping failed:', error);
    }
  });
  console.log('Self-ping scheduled to keep service alive');
}

// Start Express server
app.listen(PORT, () => {
  console.log(`HTTP server is running on port ${PORT}`);
});

bot.launch();

console.log('Bot is running...');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
