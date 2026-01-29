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
let checkerBotId = null;

// Delay function
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Parse card format
function parseCard(cardLine) {
  const parts = cardLine.trim().split("|");
  if (parts.length >= 4) {
    let month = parts[1].padStart(2, "0");
    let year = parts[2];
    if (year.length === 2) year = "20" + year;
    let cvv = parts[3];
    return {
      number: parts[0],
      month, year, cvv,
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
    console.error("Error sending to saved:", err.message);
  }
}

// Check if message has FINAL result
function isFinalResponse(text) {
  // Final response contains "T/t :" or has Declined/Approved with full details
  const hasTimeInfo = text.includes("T/t :") || text.includes("T/t:");
  const hasStatus = text.includes("Declined") || text.includes("Approved") || text.includes("Charged");
  const isStillChecking = text.includes("Checking...");

  // If it has time info, it's definitely final
  if (hasTimeInfo) return true;

  // If has status but still says checking, not final yet
  if (isStillChecking && !hasTimeInfo) return false;

  // If has status with bin info, it's final
  if (hasStatus && text.includes("𝗕𝗶𝗻")) return true;

  return false;
}

// Check if approved
function isApproved(text) {
  return text.toLowerCase().includes("approved") || text.toLowerCase().includes("charged");
}

// Check single card - sends and waits for response
async function checkCard(card) {
  const cardBin = card.number.slice(0, 6);
  console.log(`\n📤 Sending: ${cardBin}****`);

  // Get last message ID from bot BEFORE sending
  let lastMsgId = 0;
  try {
    const oldMsgs = await client.getMessages(checkerBotEntity, { limit: 1 });
    if (oldMsgs.length > 0) {
      lastMsgId = oldMsgs[0].id;
    }
  } catch (e) { }

  console.log(`📌 Last message ID before send: ${lastMsgId}`);

  // Send card to checker bot
  const command = `/st ${card.formatted}`;
  await client.sendMessage(checkerBotEntity, { message: command });
  console.log(`📨 Command sent: ${command}`);

  // Now poll for NEW messages (ID > lastMsgId) until we get final response
  const startTime = Date.now();
  const timeout = 180000; // 3 minutes max

  while (Date.now() - startTime < timeout) {
    await delay(2000); // Wait 2 seconds between checks

    try {
      // Get latest messages
      const messages = await client.getMessages(checkerBotEntity, { limit: 10 });

      for (const msg of messages) {
        // Only look at NEW messages (after our send)
        if (msg.id <= lastMsgId) continue;
        if (!msg.message) continue;

        const text = msg.message;

        // Check if this is about our card
        if (!text.includes(cardBin) && !text.includes(card.number)) continue;

        console.log(`📥 Found message for our card (ID: ${msg.id})`);

        // Check if it's FINAL response
        if (isFinalResponse(text)) {
          console.log(`✅ Got FINAL response!`);
          return {
            success: true,
            text: text,
            isApproved: isApproved(text)
          };
        } else {
          console.log(`⏳ Message is still "Checking...", waiting...`);
        }
      }
    } catch (err) {
      console.error("Poll error:", err.message);
    }

    console.log(`⏳ Still waiting for final response... (${Math.round((Date.now() - startTime) / 1000)}s)`);
  }

  return { success: false, text: "Timeout", isApproved: false };
}

// Process all cards one by one
async function processCards() {
  const totalCards = cardQueue.length;
  let processed = 0;

  while (cardQueue.length > 0) {
    const cardLine = cardQueue.shift();
    const card = parseCard(cardLine);
    processed++;

    if (!card) {
      await sendToSavedMessages(`⚠️ Invalid: ${cardLine}`);
      continue;
    }

    await sendToSavedMessages(`🔄 [${processed}/${totalCards}] Checking: \`${card.number.slice(0, 6)}****\``);

    // Check card and WAIT for response
    const result = await checkCard(card);

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

    // Wait before next card
    if (cardQueue.length > 0) {
      console.log(`⏳ Waiting 5 seconds before next card...`);
      await delay(5000);
    }
  }

  // Done!
  let summary = `\n✅ **All Done!**\n📊 Checked: ${totalCards}\n✅ Approved: ${approvedCards.length}`;
  if (approvedCards.length > 0) {
    summary += `\n\n🎉 **Live Cards:**\n`;
    approvedCards.forEach((c, i) => summary += `${i + 1}. \`${c}\`\n`);
  }
  await sendToSavedMessages(summary);

  isChecking = false;
  console.log(`\n✅ Finished checking all ${totalCards} cards!`);
}

// Start bot
async function startBot() {
  console.log("🚀 Starting Card Checker Bot...");

  const session = new StringSession(SESSION_STRING);
  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    onError: (err) => console.error("Error:", err),
  });

  console.log("✅ Connected to Telegram!");

  const me = await client.getMe();
  myUserId = me.id.value || me.id;
  console.log(`👤 Logged in as: ${me.firstName} (ID: ${myUserId})`);

  // Get checker bot
  try {
    checkerBotEntity = await client.getEntity(CHECKER_BOT);
    checkerBotId = checkerBotEntity.id?.value || checkerBotEntity.id;
    console.log(`🤖 Found @KidCheck_bot (ID: ${checkerBotId})`);
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

      if (senderId != myUserId) return;

      // /check command
      if (text.startsWith("/check") || text.startsWith("/chk")) {
        if (isChecking) {
          await sendToSavedMessages("⏳ Already checking. /stop first.");
          return;
        }

        const cardText = text.replace(/^\/chk|^\/check/, "").trim();
        const cards = cardText.split("\n").map(c => c.trim()).filter(c => c.includes("|"));

        if (cards.length === 0) {
          await sendToSavedMessages("❓ Usage:\n/check card1\ncard2\n\nFormat: NUMBER|MM|YY|CVV");
          return;
        }

        cardQueue = cards;
        approvedCards = [];
        isChecking = true;

        await sendToSavedMessages(`🚀 Starting!\n📊 Total: ${cards.length} cards`);

        // Start processing (async, don't await here)
        processCards();
      }

      // /stop
      if (text === "/stop") {
        cardQueue = [];
        isChecking = false;
        await sendToSavedMessages("🛑 Stopped.");
      }

      // /status
      if (text === "/status") {
        await sendToSavedMessages(`📊 Active: ${isChecking}\n📋 Queue: ${cardQueue.length}\n✅ Approved: ${approvedCards.length}`);
      }

    } catch (err) {
      console.error("Handler error:", err);
    }
  }, new NewMessage({}));

  console.log("📱 Ready! Send /check with cards in Saved Messages.");
}

// Start
(async () => {
  try {
    await startBot();
    app.listen(PORT, () => console.log(`🌐 Health server on port ${PORT}`));
  } catch (error) {
    console.error("Failed:", error);
    process.exit(1);
  }
})();
