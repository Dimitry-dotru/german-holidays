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

// Function to get upcoming holidays
function getUpcomingHolidays(count: number = 2) {
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
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, count);

  return upcomingHolidays;
}

// Helper function to get days until date
function getDaysUntil(date: Date): number {
  const now = new Date();
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// Helper function to format plural days in Russian
function formatDays(days: number): string {
  if (days === 1 || (days % 10 === 1 && days % 100 !== 11)) {
    return `${days} день`;
  } else if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) {
    return `${days} дня`;
  } else {
    return `${days} дней`;
  }
}

bot.start((ctx) => {
  activeChatIds.add(ctx.chat.id);

  const upcomingHolidays = getUpcomingHolidays(2);

  let message = '🎉 Добро пожаловать в бот напоминаний о праздниках!\n\n';
  message += '📍 Регион: Баден-Вюртемберг, Германия\n\n';

  if (upcomingHolidays.length > 0) {
    message += '🗓 Ближайшие праздники:\n\n';

    upcomingHolidays.forEach((holiday, index) => {
      const holidayDate = new Date(holiday.date);
      const daysUntil = getDaysUntil(holidayDate);
      const dateStr = holidayDate.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      message += `${index + 1}. ${holiday.name}\n`;
      message += `   📅 ${dateStr}\n`;
      message += `   ⏰ Через ${formatDays(daysUntil)}\n\n`;
    });
  } else {
    message += 'К сожалению, не найдено ближайших праздников.\n\n';
  }

  message += '✨ Хорошего дня!';

  ctx.reply(message);
  console.log(`User ${ctx.chat.id} subscribed`);
});

// Health check endpoint for Render
app.get('/health', (_req, res) => {
  console.log("Someone pended health...");
  
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeChats: activeChatIds.size
  });
});

app.get('/', (_req, res) => {
  console.log("Someone pended...");

  res.send('Germany Holiday Reminder Bot is running!');
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
