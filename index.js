require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let interval = null;

async function log(channel, msg) {
    console.log("[LOG]", msg);
    if (channel) channel.send("📡 " + msg).catch(() => {});
}

// =======================
// RESTART SERVER
// =======================
async function restartServer(channel) {
    try {

        await log(channel, "🔄 Envoi de la commande restart...");

        const serverId = (process.env.SERVER_URL || "").split("/").filter(Boolean).pop();

        const res = await fetch(`https://mine.sttr.io/server/${serverId}/poweraction`, {
            method: "PUT",
            headers: {
                "Authorization": `Bearer ${process.env.MINESTRATOR_TOKEN}`,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Origin": "https://minestrator.com",
                "Referer": "https://minestrator.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"
            },
            body: JSON.stringify({ poweraction: "restart" })
        });

        console.log("[RESTART] Status:", res.status);

        if (res.status === 200 || res.status === 201 || res.status === 204) {
            await log(channel, "🎉 RESTART LANCÉ AVEC SUCCÈS !");
        } else {
            const body = await res.text().catch(() => "");
            await log(channel, `❌ Échec restart (HTTP ${res.status}) — ${body.slice(0, 100)}`);
        }

    } catch (err) {
        console.error("[ERREUR]", err);
        await log(channel, "❌ ERREUR: " + err.message);
    }
}

// =======================
// STOP SYSTEM
// =======================
async function stopSystem(channel) {
    clearInterval(interval);
    interval = null;
    await log(channel, "🛑 Système arrêté proprement.");
}

// =======================
// DISCORD BOT
// =======================
client.once("ready", () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const channel = message.channel;

    // !start
    if (message.content === "!start") {
        if (interval) return message.reply("⚠️ Le système est déjà actif !");
        await message.reply("🚀 Système activé ! Premier restart en cours...");
        await restartServer(channel);
        interval = setInterval(async () => {
            await log(channel, "⏱️ Restart automatique toutes les 3h...");
            await restartServer(channel);
        }, 3 * 60 * 60 * 1000);
    }

    // !stop
    if (message.content === "!stop") {
        await stopSystem(channel);
        await message.reply("🛑 Système arrêté.");
    }

    // !restart
    if (message.content === "!restart") {
        await message.reply("🔄 Restart manuel en cours...");
        await restartServer(channel);
    }

    // !status
    if (message.content === "!status") {
        if (interval) {
            await message.reply("✅ Système **actif** — restart auto toutes les 3h.");
        } else {
            await message.reply("🔴 Système **inactif** — tape `!start` pour démarrer.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
