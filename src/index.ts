import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import cron from 'node-cron';
import express from 'express';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN as string);
const app = express();
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_URL; // Your Render service URL
const REGION_CODE = 'DE-BW'; // Baden-Württemberg

// Store active chat IDs
const activeChatIds = new Set<number>();

// Holiday interface from Nager.Date API
interface Holiday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
}

// Cache for holidays
let holidaysCache: Holiday[] = [];
let lastFetchYear: number = 0;

// Fetch holidays from Nager.Date API
async function fetchHolidays(year: number): Promise<Holiday[]> {
  try {
    const response = await fetch(`https://date.nager.at/api/v3/publicholidays/${year}/DE`);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    const holidays = await response.json() as Holiday[];
    return holidays;
  } catch (error) {
    console.error(`Failed to fetch holidays for ${year}:`, error);
    return [];
  }
}

// Get holidays for Baden-Württemberg
async function getHolidaysForRegion(year: number): Promise<Holiday[]> {
  const holidays = await fetchHolidays(year);

  // Filter holidays that apply to Baden-Württemberg
  return holidays.filter(holiday =>
    holiday.global ||
    (holiday.counties && holiday.counties.includes(REGION_CODE))
  );
}

// Function to get upcoming holidays
async function getUpcomingHolidays(count: number = 2): Promise<Holiday[]> {
  const now = new Date();
  const currentYear = now.getFullYear();

  // Fetch holidays if not cached or year changed
  if (lastFetchYear !== currentYear || holidaysCache.length === 0) {
    const currentYearHolidays = await getHolidaysForRegion(currentYear);
    const nextYearHolidays = await getHolidaysForRegion(currentYear + 1);
    holidaysCache = [...currentYearHolidays, ...nextYearHolidays];
    lastFetchYear = currentYear;
  }

  // Filter and sort holidays that are in the future
  const upcomingHolidays = holidaysCache
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

// Check if current time is night (22:00 - 08:00)
function isNightTime(): boolean {
  const now = new Date();
  const hour = now.getHours();
  return hour >= 22 || hour < 8;
}

// Check if today is a holiday
async function isTodayHoliday(): Promise<boolean> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const today = now.toISOString().split('T')[0];

  // Use cached holidays or fetch
  if (lastFetchYear !== currentYear || holidaysCache.length === 0) {
    const currentYearHolidays = await getHolidaysForRegion(currentYear);
    holidaysCache = [...currentYearHolidays];
    lastFetchYear = currentYear;
  }

  return holidaysCache.some((holiday: Holiday) => holiday.date === today);
}

bot.start(async (ctx) => {
  activeChatIds.add(ctx.chat.id);

  const upcomingHolidays = await getUpcomingHolidays(2);

  let message = '🎉 Добро пожаловать в бот напоминаний о праздниках!\n\n';
  message += '📍 Регион: Баден-Вюртемберг, Германия\n\n';

  if (upcomingHolidays.length > 0) {
    message += '🗓 Ближайшие праздники:\n\n';

    upcomingHolidays.forEach((holiday: Holiday, index: number) => {
      const holidayDate = new Date(holiday.date);
      const daysUntil = getDaysUntil(holidayDate);
      const dateStr = holidayDate.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      const weekDay = holidayDate.toLocaleDateString('ru-RU', {
        weekday: 'long'
      });

      message += `${index + 1}. ${holiday.localName}\n`;
      message += `   📅 ${dateStr} (${weekDay})\n`;
      message += `   ⏰ Через ${formatDays(daysUntil)}\n\n`;
    });
  } else {
    message += 'К сожалению, не найдено ближайших праздников.\n\n';
  }

  message += '📬 Через некоторое время может прийти тестовое сообщение, для проверки работоспособности систем\n\n';

  ctx.reply(message);
  console.log(`User ${ctx.chat.id} subscribed`);

  // Schedule test message after 6 hours
  const chatId = ctx.chat.id;
  setTimeout(async () => {
    // Check if it's not night time and not a holiday
    if (!isNightTime() && !(await isTodayHoliday())) {
      bot.telegram.sendMessage(
        chatId,
        '✅ Тестовое сообщение!\n\n' +
        'Бот работает исправно. Вы будете получать напоминания о праздниках в Баден-Вюртемберге.\n\n' +
        '💚 Все системы в норме!'
      ).catch(err => {
        console.error(`Failed to send test message to ${chatId}:`, err.message);
        if (err.message.includes('blocked')) {
          activeChatIds.delete(chatId);
        }
      });
      console.log(`Test message sent to ${chatId}`);
    } else {
      console.log(`Test message skipped for ${chatId} (night time or holiday)`);
    }
  }, 6 * 60 * 60 * 1000); // 6 hours in milliseconds
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
