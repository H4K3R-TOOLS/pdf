const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const API_ID = 24509063;
const API_HASH = "980c8b2d466c6cf6b5059ae8cf91f5cb";

(async () => {
    console.log("🔐 Telegram Session Generator\n");

    const stringSession = new StringSession("");

    const client = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text("📱 Enter your phone number (with country code, e.g., +923001234567): "),
        password: async () => await input.text("🔑 Enter your 2FA password (if enabled, else press Enter): "),
        phoneCode: async () => await input.text("📨 Enter the code you received: "),
        onError: (err) => console.log(err),
    });

    console.log("\n✅ Successfully logged in!");
    console.log("\n🔑 Your NEW session string (copy this):\n");
    console.log("═".repeat(60));
    console.log(client.session.save());
    console.log("═".repeat(60));
    console.log("\n⚠️ Use this new session string in your docker-compose.yml or docker run command!");

    await client.disconnect();
    process.exit(0);
})();
