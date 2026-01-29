const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const express = require("express");

// Configuration
const PORT = process.env.PORT || 3000;
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION_STRING = process.env.TELEGRAM_SESSION;

// KidCheck Bot username
const CHECKER_BOT = "@KidCheck_bot";

// Express app for health check
const app = express();
app.get("/", (req, res) => res.send("Card Checker Bot Running! ✅"));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

let client;
let isChecking = false;
let cardQueue = [];
let approvedCards = [];
let currentUserId = null;

// Delay function
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse card format: 4019732000862606|02|27|733
function parseCard(cardLine) {
  const parts = cardLine.trim().split("|");
  if (parts.length >= 4) {
    let month = parts[1].padStart(2, "0");
    let year = parts[2];
    // Convert 2-digit year to 4-digit if needed
    if (year.length === 2) {
      year = "20" + year;
    }
    let cvv = parts[3];
    return {
      number: parts[0],
      month: month,
      year: year,
      cvv: cvv,
      original: cardLine.trim(),
      formatted: `${parts[0]}|${month}|${year}|${cvv}`,
    };
  }
  return null;
}

// Check single card
async function checkCard(card) {
  try {
    // Get the checker bot entity
    const bot = await client.getEntity(CHECKER_BOT);

    // Send the check command
    const command = `/st ${card.formatted}`;
    await client.sendMessage(bot, { message: command });

    console.log(`📤 Sent: ${command}`);

    // Wait for response (up to 60 seconds)
    let response = null;
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds

    while (Date.now() - startTime < timeout) {
      await delay(2000); // Check every 2 seconds

      // Get recent messages from the bot
      const messages = await client.getMessages(bot, { limit: 5 });

      for (const msg of messages) {
        if (msg.message && msg.message.includes(card.number.slice(0, 6))) {
          response = msg.message;
          break;
        }
      }

      if (response) break;
    }

    if (!response) {
      return { card, status: "TIMEOUT", response: "No response received" };
    }

    // Check if approved or declined
    const isApproved =
      response.toLowerCase().includes("approved") ||
      response.toLowerCase().includes("charged") ||
      response.includes("✅");
    const isDeclined =
      response.toLowerCase().includes("declined") ||
      response.toLowerCase().includes("❌");

    return {
      card,
      status: isApproved ? "APPROVED ✅" : isDeclined ? "DECLINED ❌" : "UNKNOWN",
      response: response,
      isApproved: isApproved,
    };
  } catch (error) {
    console.error(`Error checking card: ${error.message}`);
    return { card, status: "ERROR", response: error.message };
  }
}

// Process card queue
async function processQueue(userId) {
  if (isChecking || cardQueue.length === 0) return;

  isChecking = true;
  approvedCards = [];

  const totalCards = cardQueue.length;
  let checked = 0;

  await client.sendMessage(userId, {
    message: `🚀 **Starting Card Check**\n📊 Total Cards: ${totalCards}\n⏳ Please wait...`,
  });

  while (cardQueue.length > 0) {
    const cardLine = cardQueue.shift();
    const card = parseCard(cardLine);

    if (!card) {
      checked++;
      await client.sendMessage(userId, {
        message: `⚠️ Invalid format: ${cardLine}`,
      });
      continue;
    }

    checked++;
    await client.sendMessage(userId, {
      message: `🔄 Checking [${checked}/${totalCards}]: \`${card.number.slice(0, 6)}****\``,
    });

    const result = await checkCard(card);

    if (result.isApproved) {
      approvedCards.push(result);
      await client.sendMessage(userId, {
        message: `\n🎉 **APPROVED CARD FOUND!** 🎉\n\n💳 CC: \`${card.formatted}\`\n\n📝 Response:\n${result.response}`,
      });
    } else {
      // Just log declined, dont spam
      console.log(`❌ Declined: ${card.number.slice(0, 6)}****`);
    }

    // Wait before next card to avoid rate limiting
    if (cardQueue.length > 0) {
      await delay(5000); // 5 second delay between cards
    }
  }

  // Summary
  let summary = `\n✅ **Check Complete!**\n\n📊 Total Checked: ${totalCards}\n✅ Approved: ${approvedCards.length}\n❌ Declined: ${totalCards - approvedCards.length}`;

  if (approvedCards.length > 0) {
    summary += `\n\n🎉 **Approved Cards:**\n`;
    approvedCards.forEach((r, i) => {
      summary += `${i + 1}. \`${r.card.formatted}\`\n`;
    });
  }

  await client.sendMessage(userId, { message: summary });
  isChecking = false;
}

// Start the client
async function startBot() {
  console.log("🚀 Starting Card Checker Bot...");

  const session = new StringSession(SESSION_STRING);

  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    onError: (err) => console.error("Connection error:", err),
  });

  console.log("✅ Connected to Telegram!");
  console.log("📱 Listening for messages...");

  // Listen for messages from yourself (saved messages or any chat)
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (!message || !message.message) return;

      const text = message.message.trim();
      const senderId = message.senderId?.toString();
      const me = await client.getMe();
      const myId = me.id.toString();

      // Only respond to your own messages
      if (senderId !== myId) return;

      // Command: /check or /chk followed by card list
      if (text.startsWith("/check") || text.startsWith("/chk")) {
        const cardText = text.replace(/^\/chk|^\/check/, "").trim();
        const cards = cardText
          .split("\n")
          .map((c) => c.trim())
          .filter((c) => c.length > 0);

        if (cards.length === 0) {
          await client.sendMessage(message.chatId, {
            message:
              "❓ **Usage:**\n/check card1\ncard2\ncard3\n\n**Format:** 4111111111111111|MM|YY|CVV",
          });
          return;
        }

        if (isChecking) {
          await client.sendMessage(message.chatId, {
            message: "⏳ Already checking cards. Please wait...",
          });
          return;
        }

        cardQueue = cards;
        currentUserId = message.chatId;
        processQueue(message.chatId);
      }

      // Stop command
      if (text === "/stop") {
        cardQueue = [];
        isChecking = false;
        await client.sendMessage(message.chatId, {
          message: "🛑 Stopped card checking.",
        });
      }

      // Status command
      if (text === "/status") {
        await client.sendMessage(message.chatId, {
          message: `📊 **Status**\n🔄 Checking: ${isChecking}\n📋 Queue: ${cardQueue.length} cards\n✅ Approved: ${approvedCards.length}`,
        });
      }
    } catch (err) {
      console.error("Handler error:", err);
    }
  });
}

// Start everything
(async () => {
  try {
    await startBot();
    app.listen(PORT, () => {
      console.log(`🌐 Health server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start:", error);
    process.exit(1);
  }
})();
