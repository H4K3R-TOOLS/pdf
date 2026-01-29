const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const express = require("express");

// Configuration
const PORT = process.env.PORT || 3000;
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const SESSION_STRING = process.env.TELEGRAM_SESSION;

// KidCheck Bot username
const CHECKER_BOT = "KidCheck_bot";

// Express app for health check
const app = express();
app.get("/", (req, res) => res.send("Card Checker Bot Running! ✅"));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

let client;
let isChecking = false;
let cardQueue = [];
let approvedCards = [];
let myUserId = null;
let checkerBotEntity = null;
let waitingForResponse = false;
let currentCard = null;

// Delay function
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse card format: 4019732000862606|02|27|733
function parseCard(cardLine) {
  const parts = cardLine.trim().split("|");
  if (parts.length >= 4) {
    let month = parts[1].padStart(2, "0");
    let year = parts[2];
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

// Send message to saved messages
async function sendToSavedMessages(text) {
  try {
    await client.sendMessage("me", { message: text });
  } catch (err) {
    console.error("Error sending to saved messages:", err.message);
  }
}

// Check if message has FINAL result (not just "Checking...")
function isFinalResponse(text) {
  // If it says "Checking..." without a final status, it's not final
  if (text.includes("Checking...") && !text.includes("Declined") && !text.includes("Approved") && !text.includes("Charged")) {
    return false;
  }
  // Must have a final status
  return text.includes("Declined") ||
    text.includes("Approved") ||
    text.includes("Charged") ||
    text.includes("CVV") ||
    text.includes("T/t :");  // This appears in final response
}

// Check if approved
function isApproved(text) {
  const lowerText = text.toLowerCase();
  return lowerText.includes("approved") ||
    lowerText.includes("charged") ||
    (text.includes("✅") && !text.includes("❌") && !text.includes("Declined"));
}

// Wait for final response from @KidCheck_bot
async function waitForBotResponse(card) {
  console.log(`⏳ Waiting for @KidCheck_bot response for: ${card.number.slice(0, 6)}****`);

  const startTime = Date.now();
  const timeout = 120000; // 2 minutes
  const cardBin = card.number.slice(0, 6);

  while (Date.now() - startTime < timeout) {
    await delay(3000); // Check every 3 seconds

    try {
      // Get recent messages from @KidCheck_bot
      const messages = await client.getMessages(checkerBotEntity, { limit: 5 });

      for (const msg of messages) {
        if (!msg.message) continue;

        const text = msg.message;

        // Check if this message is about our card
        if (text.includes(cardBin) || text.includes(card.number)) {
          // Check if it's the FINAL response (not "Checking...")
          if (isFinalResponse(text)) {
            console.log(`📥 Got FINAL response for: ${cardBin}****`);
            return { success: true, text: text, isApproved: isApproved(text) };
          } else {
            console.log(`⏳ Still checking... waiting for final response`);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching messages:", err.message);
    }
  }

  return { success: false, text: "Timeout - no response", isApproved: false };
}

// Process next card in queue
async function processNextCard() {
  if (cardQueue.length === 0) {
    // All done!
    let summary = `\n✅ **Check Complete!**\n\n📊 Total Approved: ${approvedCards.length}`;
    if (approvedCards.length > 0) {
      summary += `\n\n🎉 **Approved Cards:**\n`;
      approvedCards.forEach((card, i) => {
        summary += `${i + 1}. \`${card}\`\n`;
      });
    } else {
      summary += `\n\n😔 No approved cards found.`;
    }
    await sendToSavedMessages(summary);
    isChecking = false;
    waitingForResponse = false;
    currentCard = null;
    console.log("✅ All cards checked!");
    return;
  }

  const cardLine = cardQueue.shift();
  const card = parseCard(cardLine);

  if (!card) {
    await sendToSavedMessages(`⚠️ Invalid format: ${cardLine}`);
    await processNextCard();
    return;
  }

  currentCard = card;
  waitingForResponse = true;

  const remaining = cardQueue.length;
  console.log(`📤 Sending card: ${card.number.slice(0, 6)}**** (${remaining} remaining)`);

  await sendToSavedMessages(`🔄 Checking: \`${card.number.slice(0, 6)}****\` (${remaining} left)`);

  // Send to @KidCheck_bot
  const command = `/st ${card.formatted}`;
  await client.sendMessage(checkerBotEntity, { message: command });

  // Wait for FINAL response (not "Checking...")
  const result = await waitForBotResponse(card);

  if (result.success) {
    if (result.isApproved) {
      approvedCards.push(card.formatted);
      await sendToSavedMessages(`\n🎉 **APPROVED!** 🎉\n\n💳 \`${card.formatted}\`\n\n${result.text}`);
    } else {
      await sendToSavedMessages(`❌ Declined: \`${card.number.slice(0, 6)}****\``);
    }
  } else {
    await sendToSavedMessages(`⏰ Timeout: \`${card.number.slice(0, 6)}****\``);
  }

  // Reset
  waitingForResponse = false;
  currentCard = null;

  // Wait before next card
  await delay(5000);

  // Process next
  await processNextCard();
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

  // Get my user ID
  const me = await client.getMe();
  myUserId = me.id.value || me.id;
  console.log(`👤 Logged in as: ${me.firstName} (ID: ${myUserId})`);

  // Get checker bot entity
  try {
    checkerBotEntity = await client.getEntity(CHECKER_BOT);
    console.log(`🤖 Found @KidCheck_bot`);
  } catch (err) {
    console.error("❌ Could not find @KidCheck_bot:", err.message);
  }

  // Listen for my commands
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (!message || !message.message) return;

      const text = message.message.trim();
      const senderId = message.senderId?.value || message.senderId;

      // Only handle my own messages
      if (senderId != myUserId) return;

      // Start checking cards
      if (text.startsWith("/check") || text.startsWith("/chk")) {
        if (isChecking) {
          await sendToSavedMessages("⏳ Already checking. Use /stop first.");
          return;
        }

        const cardText = text.replace(/^\/chk|^\/check/, "").trim();
        const cards = cardText.split("\n").map(c => c.trim()).filter(c => c.length > 0 && c.includes("|"));

        if (cards.length === 0) {
          await sendToSavedMessages("❓ **Usage:**\n/check card1\ncard2\ncard3\n\n**Format:** NUMBER|MM|YY|CVV");
          return;
        }

        cardQueue = cards;
        approvedCards = [];
        isChecking = true;

        await sendToSavedMessages(`🚀 **Starting Check**\n📊 Total: ${cards.length} cards\n⏳ Processing one by one...`);

        // Start processing
        await processNextCard();
      }

      // Stop command
      if (text === "/stop") {
        cardQueue = [];
        isChecking = false;
        waitingForResponse = false;
        currentCard = null;
        await sendToSavedMessages("🛑 Stopped.");
      }

      // Status command
      if (text === "/status") {
        await sendToSavedMessages(`📊 **Status**\n🔄 Active: ${isChecking}\n📋 Queue: ${cardQueue.length}\n✅ Approved: ${approvedCards.length}`);
      }

    } catch (err) {
      console.error("Handler error:", err);
    }
  }, new NewMessage({}));

  console.log("📱 Listening for messages...");
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
