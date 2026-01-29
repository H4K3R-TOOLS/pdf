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
let savedMessagesChat = null;
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
    // Process next immediately
    await processNextCard();
    return;
  }

  currentCard = card;
  waitingForResponse = true;

  const remaining = cardQueue.length;
  console.log(`📤 Sending card to @KidCheck_bot: ${card.number.slice(0, 6)}**** (${remaining} remaining)`);

  // Send to @KidCheck_bot
  const command = `/st ${card.formatted}`;
  await client.sendMessage(checkerBotEntity, { message: command });

  await sendToSavedMessages(`🔄 Checking: \`${card.number.slice(0, 6)}****\` (${remaining} remaining)`);

  // Now we wait for the handler to receive response from @KidCheck_bot
  // Set a timeout in case bot doesn't respond
  setTimeout(async () => {
    if (waitingForResponse && currentCard && currentCard.number === card.number) {
      console.log(`⏰ Timeout for card: ${card.number.slice(0, 6)}****`);
      await sendToSavedMessages(`⏰ Timeout: No response for \`${card.number.slice(0, 6)}****\``);
      waitingForResponse = false;
      currentCard = null;
      await delay(2000);
      await processNextCard();
    }
  }, 120000); // 2 minute timeout
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

  // Listen for ALL new messages
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (!message || !message.message) return;

      const text = message.message.trim();
      const chatId = message.chatId?.value || message.chatId;
      const senderId = message.senderId?.value || message.senderId;
      const isFromBot = message.peerId?.className === "PeerUser" &&
        checkerBotEntity &&
        (senderId == checkerBotEntity.id?.value || senderId == checkerBotEntity.id);

      // Check if this is a response from @KidCheck_bot
      if (isFromBot && waitingForResponse && currentCard) {
        console.log(`📥 Got response from @KidCheck_bot`);

        // Check if this response is for our current card
        const cardBin = currentCard.number.slice(0, 6);
        if (text.includes(cardBin) || text.includes(currentCard.number)) {

          // Check if approved
          const isApproved = text.toLowerCase().includes("approved") ||
            text.includes("Charged") ||
            (text.includes("✅") && !text.includes("❌"));

          if (isApproved) {
            approvedCards.push(currentCard.formatted);
            await sendToSavedMessages(`\n🎉 **APPROVED!** 🎉\n\n💳 \`${currentCard.formatted}\`\n\n${text}`);
          } else {
            // Just log declined
            await sendToSavedMessages(`❌ Declined: \`${currentCard.number.slice(0, 6)}****\``);
          }

          // Reset and process next
          waitingForResponse = false;
          currentCard = null;

          // Wait a bit before next card
          await delay(5000);
          await processNextCard();
        }
        return;
      }

      // Handle commands from myself (from saved messages)
      if (senderId == myUserId) {

        // Start checking cards
        if (text.startsWith("/check") || text.startsWith("/chk")) {
          if (isChecking) {
            await sendToSavedMessages("⏳ Already checking cards. Use /stop first.");
            return;
          }

          const cardText = text.replace(/^\/chk|^\/check/, "").trim();
          const cards = cardText.split("\n").map(c => c.trim()).filter(c => c.length > 0 && c.includes("|"));

          if (cards.length === 0) {
            await sendToSavedMessages("❓ **Usage:**\n/check card1\ncard2\ncard3\n\n**Format:** 4111111111111111|MM|YY|CVV");
            return;
          }

          cardQueue = cards;
          approvedCards = [];
          isChecking = true;

          await sendToSavedMessages(`🚀 **Starting Check**\n📊 Total Cards: ${cards.length}\n⏳ Processing...`);

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
